import { test, expect } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PDFDocument } from "pdf-lib";
import { PNG } from "pngjs";
import { createCore } from "../apps/core/src/server";

test("region cards own immutable book-scoped PNG assets and retry without duplication", async () => {
  const directory = await mkdtemp(join(tmpdir(), "aireader-region-card-"));
  let core = createCore(directory, "dist/web");
  let origin = "", cookie = "";
  async function connect() {
    await new Promise<void>((done) => core.server.listen(0, "127.0.0.1", done));
    origin = `http://127.0.0.1:${(core.server.address() as { port: number }).port}`;
    cookie = (await fetch(origin + "/api/session", { method: "POST", headers: { Origin: origin } }))
      .headers.get("set-cookie")!.split(";")[0];
  }
  function request(path: string, value?: unknown) {
    return fetch(origin + "/api/" + path, {
      method: value === undefined ? "GET" : "POST",
      headers: { Origin: origin, Cookie: cookie, "Content-Type": "application/json" },
      body: value === undefined ? undefined : JSON.stringify(value),
    });
  }
  async function book(width: number) {
    const pdf = await PDFDocument.create();
    pdf.addPage([width, 500]).drawText("Figure with caption");
    const response = await fetch(origin + "/api/books", {
      method: "POST", headers: { Origin: origin, Cookie: cookie }, body: Buffer.from(await pdf.save()),
    });
    const value = await response.json();
    await core.library.waitForBook(value.id);
    return value;
  }
  try {
    await connect();
    const first = await book(400), second = await book(420);
    const png = PNG.sync.write(new PNG({ width: 8, height: 6 }));
    const input = {
      bookId: first.id, commandId: "region-first", expectedVersion: 0,
      fingerprint: first.fingerprint, page: 1, rect: [20, 30, 120, 100],
      image: `data:image/png;base64,${png.toString("base64")}`,
      includePersonalMarks: false, title: "Figure", x: 2300, y: 100,
    };
    const endpoint = `books/${first.id}/workspace/region-excerpts`;
    const created = await request(endpoint, input);
    expect(created.status, JSON.stringify(await created.clone().json())).toBe(201);
    const result = await created.json();
    const card = result.workspace.cards[0];
    expect(card).toMatchObject({ id: input.commandId, kind: "region", title: "Figure",
      region: { fingerprint: first.fingerprint, page: 1, rect: input.rect, includePersonalMarks: false } });
    const asset = await request(`books/${first.id}/workspace-assets/${card.region.assetId}`);
    expect(asset.status).toBe(200);
    expect(Buffer.from(await asset.arrayBuffer()).subarray(0, 8).toString("hex")).toBe("89504e470d0a1a0a");
    expect((await request(`books/${second.id}/workspace-assets/${card.region.assetId}`)).status).toBe(400);
    const duplicate = await request(endpoint, input);
    expect(duplicate.status).toBe(201);
    expect((await duplicate.json()).workspace.cards).toHaveLength(1);
    expect((await request(endpoint, { ...input, commandId: "wrong-book", bookId: second.id })).status).toBe(400);
    expect((await request(endpoint, { ...input, commandId: "wrong-page", expectedVersion: 1, page: 2 })).status).toBe(400);
    expect((await request(endpoint, { ...input, commandId: "outside-page", expectedVersion: 1,
      rect: [20, 30, 405, 100] })).status).toBe(400);
    expect((await request(`books/${first.id}/workspace/commands`, {
      bookId: first.id, commandId: "forged-region", expectedVersion: 1,
      changes: [{ type: "upsert-card", card: { ...card, id: "forged-card" } }],
    })).status).toBe(400);
    expect((await request(endpoint, { ...input, commandId: "stale", expectedVersion: 0 })).status).toBe(409);
    expect(core.library.store.list("workspace-asset", first.id)).toHaveLength(1);
    core.close();
    core = createCore(directory, "dist/web");
    await connect();
    expect((await (await request(`books/${first.id}/workspace`)).json()).cards[0]).toMatchObject(card);
    expect((await request(`books/${first.id}/workspace-assets/${card.region.assetId}`)).status).toBe(200);
    const converted = await request(`books/${first.id}/workspace/cards/${card.id}/note`, {});
    expect(converted.status).toBe(201);
    const note = await converted.json();
    expect(note.sourceCard.region.assetId).toBe(card.region.assetId);
    const current = await (await request(`books/${first.id}/workspace`)).json();
    expect((await request(`books/${first.id}/workspace/commands`, {
      bookId: first.id, commandId: "remove-commented-region", expectedVersion: current.revision,
      changes: [{ type: "delete-card", id: card.id }],
    })).status).toBe(200);
    const exported = await request(`books/${first.id}/workspace/archive`);
    expect(exported.status).toBe(200);
    const restored = await fetch(origin + "/api/workspace-archives", {
      method: "POST", headers: { Origin: origin, Cookie: cookie, "Content-Type": "application/octet-stream" },
      body: Buffer.from(await exported.arrayBuffer()),
    });
    expect(restored.status).toBe(201);
    const copy = await restored.json();
    const copyNote = (await (await request(`books/${copy.id}/notes`)).json())[0];
    expect(copyNote.sourceCard.region.assetId).not.toBe(card.region.assetId);
    expect((await request(`books/${copy.id}/workspace-assets/${copyNote.sourceCard.region.assetId}`)).status).toBe(200);
  } finally {
    core.close();
    await rm(directory, { recursive: true, force: true });
  }
});
