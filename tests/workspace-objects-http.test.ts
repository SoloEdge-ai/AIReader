import { test, expect } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PDFDocument } from "pdf-lib";
import { createCore } from "../apps/core/src/server";

test("text, shapes and their relations are book-scoped, atomic and reversible", async () => {
  const directory = await mkdtemp(join(tmpdir(), "aireader-objects-http-"));
  const core = createCore(directory, "dist/web");
  try {
    await new Promise<void>((done) => core.server.listen(0, "127.0.0.1", done));
    const origin = `http://127.0.0.1:${(core.server.address() as { port: number }).port}`;
    const cookie = (await fetch(origin + "/api/session", { method: "POST", headers: { Origin: origin } }))
      .headers.get("set-cookie")!.split(";")[0];
    const pdf = await PDFDocument.create();
    pdf.addPage([400, 320]);
    const imported = await fetch(origin + "/api/books", { method: "POST",
      headers: { Origin: origin, Cookie: cookie }, body: Buffer.from(await pdf.save()) });
    const book = await imported.json();
    await core.library.waitForBook(book.id);
    const path = `${origin}/api/books/${book.id}/workspace/commands`;
    async function command(id: string, expectedVersion: number, changes: unknown[]) {
      return fetch(path, { method: "POST", headers: { Origin: origin, Cookie: cookie,
        "Content-Type": "application/json" },
      body: JSON.stringify({ bookId: book.id, commandId: id, expectedVersion, changes }) });
    }
    const text = { id: "text-1", kind: "text", surface: { kind: "pdf", fingerprint: book.fingerprint, page: 1 },
      x: -20, y: 100, width: 180, height: 70, text: "作者原文之外的个人理解",
      fontSize: 16, color: "#345d84", bold: false, align: "left" };
    const shape = { id: "shape-1", kind: "shape", shape: "arrow", surface: { kind: "board" },
      x: 100, y: 150, width: 200, height: 60, color: "#d35e45", strokeWidth: 2,
      startCorner: "bottom-left" };
    const link = { id: "relation-1", from: text.id, to: shape.id, label: "对照", directed: true };
    const changes = [
      { type: "upsert-object", object: text }, { type: "upsert-object", object: shape },
      { type: "upsert-link", link },
    ];
    const added = await command("create-pair", 0, changes);
    expect(added.status).toBe(200);
    expect((await added.json()).links).toEqual([link]);
    expect((await (await command("create-pair", 0, changes)).json()).revision).toBe(1);
    expect((await command("foreign", 1, [{ type: "upsert-object", object: {
      ...text, id: "foreign", surface: { ...text.surface, fingerprint: "b".repeat(64) },
    } }])).status).toBe(400);
    expect((await command("negative-board", 1, [{ type: "upsert-object", object: {
      ...shape, id: "negative", x: -1,
    } }])).status).toBe(400);
    const removed = await command("delete-shape", 1, [{ type: "delete-object", id: shape.id }]);
    expect((await removed.json()).links).toEqual([]);
    const restored = await command("undo-delete", 2, [
      { type: "upsert-object", object: shape }, { type: "upsert-link", link },
    ]);
    expect((await restored.json()).links).toEqual([link]);
  } finally {
    core.close();
    await rm(directory, { recursive: true, force: true });
  }
});
