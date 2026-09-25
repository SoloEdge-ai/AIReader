import { test, expect } from "vitest";
import { createHash } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PDFDocument } from "pdf-lib";
import { PNG } from "pngjs";
import { createCore } from "../apps/core/src/server";

test("versioned commands replay their original receipt, reject changed payloads and undo atomically", async () => {
  const directory = await mkdtemp(join(tmpdir(), "aireader-receipts-"));
  let core = createCore(directory, "dist/web"), origin = "", cookie = "";
  async function connect() {
    await new Promise<void>((done) => core.server.listen(0, "127.0.0.1", done));
    const address = core.server.address();
    if (!address || typeof address === "string") throw new Error("Missing test port");
    origin = `http://127.0.0.1:${address.port}`;
    const response = await fetch(origin + "/api/session", { method: "POST", headers: { Origin: origin } });
    cookie = response.headers.get("set-cookie")!.split(";")[0];
  }
  const request = (path: string, value?: unknown) => fetch(origin + "/api/" + path, {
    method: value === undefined ? "GET" : "POST",
    headers: { Origin: origin, Cookie: cookie, "Content-Type": "application/json" },
    ...(value === undefined ? {} : { body: JSON.stringify(value) }),
  });
  function command(bookId: string, commandId: string, expectedContentVersion: number, changes: unknown[]) {
    const payload = { bookId, expectedContentVersion, changes };
    const canonical = JSON.stringify(payload, (_key, value) => value && typeof value === "object" && !Array.isArray(value)
      ? Object.fromEntries(Object.keys(value).sort().map((key) => [key, value[key]])) : value);
    return { ...payload, commandId, payloadHash: createHash("sha256").update(canonical).digest("hex") };
  }
  try {
    await connect();
    const pdf = await PDFDocument.create(); pdf.addPage([500, 700]);
    const imported = await fetch(origin + "/api/books", { method: "POST", headers: { Origin: origin, Cookie: cookie }, body: Buffer.from(await pdf.save()) });
    const book = await imported.json();
    await core.library.waitForBook(book.id);
    const path = `v2/books/${book.id}/workspace/commands`;
    const card = { id: "one", kind: "note", title: "One", text: "Original", comment: "", x: 20, y: 40, width: 300, height: 240 };
    const batch = command(book.id, "create", 0, [{ type: "upsert-card", card }]);
    const response = await request(path, batch);
    expect(response.status).toBe(200);
    const receipt = await response.json();
    expect(receipt).toMatchObject({ bookId: book.id, commandId: "create", previousVersion: 0, contentVersion: 1,
      changes: [{ type: "upsert-card", card }], inverse: [{ type: "delete-card", id: "one" }] });
    expect(receipt).not.toHaveProperty("cards");
    const update = command(book.id, "update", 1, [{ type: "upsert-card", card: { ...card, text: "Newer" } }]);
    expect((await request(path, update)).status).toBe(200);
    core.close(); core = createCore(directory, "dist/web"); await connect();
    expect(await (await request(path, batch)).json()).toEqual(receipt);
    const changed = await request(path, command(book.id, "create", 0, [{ type: "delete-card", id: "one" }]));
    expect(changed.status).toBe(409);
    expect(await changed.json()).toMatchObject({ code: "COMMAND_ID_REUSED" });
    const forged = await request(path, { ...command(book.id, "forged", 2, [{ type: "delete-card", id: "one" }]), payloadHash: "0".repeat(64) });
    expect(forged.status).toBe(400);
    expect(await forged.json()).toMatchObject({ code: "PAYLOAD_HASH_MISMATCH" });
    const stale = await request(path, command(book.id, "stale", 0, [{ type: "delete-card", id: "one" }]));
    expect(stale.status).toBe(409);
    expect(await stale.json()).toMatchObject({ code: "CONTENT_VERSION_CONFLICT" });
    const linked = command(book.id, "link", 2, [
      { type: "upsert-card", card: { ...card, id: "two" } },
      { type: "upsert-link", link: { id: "edge", from: "one", to: "two", label: "related" } },
    ]);
    expect((await request(path, linked)).status).toBe(200);
    const removed = await (await request(path, command(book.id, "delete", 3, [{ type: "delete-card", id: "one" }]))).json();
    expect(removed.changes).toContainEqual({ type: "delete-link", id: "edge" });
    expect((await request(path, command(book.id, "undo-delete", 4, removed.inverse))).status).toBe(200);
    const restored = await (await request(`books/${book.id}/workspace`)).json();
    expect(restored).toMatchObject({ revision: 5, links: [{ id: "edge" }] });
    expect(restored.cards.find((value: { id: string }) => value.id === "one").text).toBe("Newer");
    const invalid = command(book.id, "atomic", 5, [{ type: "delete-card", id: "two" },
      { type: "upsert-link", link: { id: "invalid", from: "one", to: "missing", label: "" } }]);
    expect((await request(path, invalid)).status).toBe(400);
    expect(await (await request(`books/${book.id}/workspace`)).json()).toEqual(restored);
    const png = new PNG({ width: 2, height: 2 }); png.data.fill(255);
    const regionResponse = await request(`books/${book.id}/workspace/region-excerpts`, {
      bookId: book.id, commandId: "region", expectedVersion: 5, fingerprint: book.fingerprint, page: 1,
      rect: [10, 10, 50, 50], image: "data:image/png;base64," + PNG.sync.write(png).toString("base64"),
      includePersonalMarks: false, title: "Region", x: 20, y: 40,
    });
    expect(regionResponse.status).toBe(201);
    const regionCreated = await regionResponse.json();
    const deletedRegion = await (await request(path, command(book.id, "delete-region", 6, [{ type: "delete-card", id: regionCreated.cardId }]))).json();
    const forgedRestore = deletedRegion.inverse.map((change: { card: { region: unknown } }) => ({ ...change,
      card: { ...change.card, region: { ...(change.card.region as object), rect: [20, 20, 60, 60] } } }));
    expect((await request(path, command(book.id, "forge-restore", 7, forgedRestore))).status).toBe(400);
    const restoreRegion = await request(path, command(book.id, "restore-region", 7, deletedRegion.inverse));
    expect(restoreRegion.status).toBe(200);
    const afterRegion = await (await request(`books/${book.id}/workspace`)).json();
    const otherPdf = await PDFDocument.create(); otherPdf.addPage([400, 700]);
    const other = await (await fetch(origin + "/api/books", { method: "POST", headers: { Origin: origin, Cookie: cookie }, body: Buffer.from(await otherPdf.save()) })).json();
    await core.library.waitForBook(other.id);
    expect((await request(`v2/books/${other.id}/workspace/commands`, batch)).status).toBe(400);
    const invalidObject = { id: "outside", kind: "text", surface: { kind: "pdf", fingerprint: other.fingerprint, page: 1 },
      x: 20, y: 20, width: 100, height: 50, text: "", fontSize: 12, color: "#000000", bold: false, align: "left" };
    expect((await request(path, command(book.id, "foreign-object", 8, [{ type: "upsert-object", object: invalidObject }]))).status).toBe(400);
    expect((await request(path, command(book.id, "outside-object", 8, [{ type: "upsert-object", object: {
      ...invalidObject, surface: { ...invalidObject.surface, fingerprint: book.fingerprint }, x: 1000,
    } }]))).status).toBe(400);
    expect(await (await request(`books/${book.id}/workspace`)).json()).toEqual(afterRegion);
    const objects = Array.from({ length: 2000 }, (_, index) => ({ ...invalidObject, id: `bulk-${index}`, surface: { kind: "board" } }));
    expect((await request(path, command(book.id, "bulk-create", 8, objects.map((object) => ({ type: "upsert-object", object }))))).status).toBe(200);
    const links = Array.from({ length: 999 }, (_, index) => ({ id: `bulk-edge-${index}`, from: "bulk-0", to: `bulk-${index + 1}`, label: "" }));
    expect((await request(path, command(book.id, "bulk-links", 9, links.map((link) => ({ type: "upsert-link", link }))))).status).toBe(200);
    const bulkDeleted = await (await request(path, command(book.id, "bulk-delete", 10, objects.map(({ id }) => ({ type: "delete-object", id }))))).json();
    expect(bulkDeleted.inverse).toHaveLength(2999);
    expect((await request(path, command(book.id, "bulk-undo", 11, bulkDeleted.inverse))).status).toBe(200);
    const bulkRestored = await (await request(`books/${book.id}/workspace`)).json();
    expect(bulkRestored.objects).toHaveLength(2000);
    expect(bulkRestored.links).toHaveLength(1000);
    // A tiny delete request must not create an inverse larger than the HTTP limit.
    for (let group = 0; group < 4; group++) {
      const large = Array.from({ length: 25 }, (_, index) => ({ type: "upsert-card", card: {
        ...card, id: `large-${group * 25 + index}`, text: "文".repeat(20000), comment: "注".repeat(10000),
      } }));
      expect((await request(path, command(book.id, `large-create-${group}`, 12 + group, large))).status).toBe(200);
    }
    const beforeLargeDelete = await (await request(`books/${book.id}/workspace`)).json();
    const tooLarge = await request(path, command(book.id, "large-delete", 16,
      Array.from({ length: 100 }, (_, index) => ({ type: "delete-card", id: `large-${index}` }))));
    expect(tooLarge.status).toBe(400);
    expect((await tooLarge.json()).error).toContain("分批操作");
    expect(await (await request(`books/${book.id}/workspace`)).json()).toEqual(beforeLargeDelete);
  } finally { core.close(); await rm(directory, { recursive: true, force: true }); }
});
