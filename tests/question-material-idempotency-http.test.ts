import { test, expect } from "vitest";
import { mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PDFDocument } from "pdf-lib";
import { PNG } from "pngjs";
import { createCore } from "../apps/core/src/server";

test("concurrent retries freeze one book material and leave no orphan image directory", async () => {
  const directory = await mkdtemp(join(tmpdir(), "aireader-material-retry-"));
  const core = createCore(directory, "dist/web");
  try {
    await new Promise<void>((done) => core.server.listen(0, "127.0.0.1", done));
    const origin = `http://127.0.0.1:${(core.server.address() as { port: number }).port}`;
    const cookie = (await fetch(origin + "/api/session", { method: "POST", headers: { Origin: origin } }))
      .headers.get("set-cookie")!.split(";")[0];
    const request = (path: string, value?: unknown) => fetch(`${origin}/api/${path}`, {
      method: value === undefined ? "GET" : "POST",
      headers: { Origin: origin, Cookie: cookie, "Content-Type": "application/json" },
      body: value === undefined ? undefined : JSON.stringify(value),
    });
    const pdf = await PDFDocument.create();
    pdf.addPage([400, 320]).drawText("A region with original PDF pixels", { x: 20, y: 260 });
    const imported = await fetch(`${origin}/api/books`, {
      method: "POST", headers: { Origin: origin, Cookie: cookie }, body: Buffer.from(await pdf.save()),
    });
    const book = await imported.json();
    await core.library.waitForBook(book.id);
    const session = await (await request(`books/${book.id}/sessions`, {})).json();
    const png = PNG.sync.write(new PNG({ width: 8, height: 6 }));
    const region = await request(`books/${book.id}/workspace/region-excerpts`, {
      bookId: book.id, commandId: "source-region", expectedVersion: 0,
      fingerprint: book.fingerprint, page: 1, rect: [20, 30, 120, 100],
      image: `data:image/png;base64,${png.toString("base64")}`,
      includePersonalMarks: false, title: "图示", x: 2300, y: 100,
    });
    expect(region.status).toBe(201);
    const workspace = (await region.json()).workspace;
    const input = {
      bookId: book.id, sessionId: session.id, requestId: "same-request",
      workspaceRevision: workspace.revision,
      targets: [{ kind: "card", id: "source-region" }], previews: [],
    };
    const [first, second] = await Promise.all([
      request(`books/${book.id}/question-materials`, input),
      request(`books/${book.id}/question-materials`, input),
    ]);
    expect(first.status).toBe(201);
    expect(second.status).toBe(201);
    const snapshots = await Promise.all([first.json(), second.json()]);
    expect(snapshots[0].id).toBe(snapshots[1].id);
    expect(core.library.store.list("question-material", book.id)).toHaveLength(1);
    expect(await readdir(join(directory, "question-materials", book.id))).toEqual([snapshots[0].id]);
    const reused = await request(`books/${book.id}/question-materials`, input);
    expect((await reused.json()).id).toBe(snapshots[0].id);
    const changed = await request(`books/${book.id}/question-materials`, { ...input, targets: [] });
    expect(changed.status).toBe(400);
  } finally {
    core.close();
    await rm(directory, { recursive: true, force: true });
  }
}, 30_000);
