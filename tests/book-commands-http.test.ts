import { createHash } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PDFDocument } from "pdf-lib";
import { PNG } from "pngjs";
import { expect, test } from "vitest";
import { createCore } from "../apps/core/src/server";
import { bookCommandPayload } from "../packages/protocol/src/book-commands";
import { commandPayload } from "../packages/protocol/src/workspace-commands";

test("book commands atomically save notes, board placement, frozen sources, and undo receipts", async () => {
  const directory = await mkdtemp(join(tmpdir(), "aireader-book-commands-"));
  let core = createCore(directory, "dist/web");
  let origin = "", cookie = "";
  async function connect() {
    await new Promise<void>((done) => core.server.listen(0, "127.0.0.1", done));
    origin = `http://127.0.0.1:${(core.server.address() as { port: number }).port}`;
    cookie = (await fetch(origin + "/api/session", { method: "POST", headers: { Origin: origin } }))
      .headers.get("set-cookie")!.split(";")[0];
  }
  const request = (path: string, value?: unknown) => fetch(origin + "/api/" + path, {
    method: value === undefined ? "GET" : "POST",
    headers: { Origin: origin, Cookie: cookie, "Content-Type": "application/json" },
    ...(value === undefined ? {} : { body: JSON.stringify(value) }),
  });
  function command(bookId: string, commandId: string, expectedContentVersion: number, changes: any[]) {
    const payload = { bookId, expectedContentVersion, changes };
    return { ...payload, commandId,
      payloadHash: createHash("sha256").update(bookCommandPayload(payload)).digest("hex") };
  }
  try {
    await connect();
    const pdf = await PDFDocument.create(); pdf.addPage([500, 700]);
    const book = await (await fetch(origin + "/api/books", { method: "POST",
      headers: { Origin: origin, Cookie: cookie }, body: Buffer.from(await pdf.save()) })).json();
    await core.library.waitForBook(book.id);
    const path = `books/${book.id}`;
    const commandPath = `v2/${path}/commands`;
    const excerpt = { id: "excerpt", kind: "excerpt", title: "Definition", text: "Frozen original",
      comment: "", x: 400, y: 30, width: 320, height: 220,
      source: { fingerprint: book.fingerprint, anchors: [{ page: 1, rects: [[10, 20, 80, 40]] }] } };
    const create = command(book.id, "create", 0, [
      { type: "create-note", title: "My idea", placement: { id: "note-card", x: 20, y: 30, width: 320, height: 240 } },
      { type: "workspace", changes: [
        { type: "upsert-card", card: excerpt },
        { type: "upsert-link", link: { id: "relation", from: "note-card", to: "excerpt", label: "supports" } },
        { type: "upsert-group", group: { id: "topic", title: "Topic", color: "#56789a", x: 10, y: 20,
          width: 800, height: 400, memberIds: ["note-card", "excerpt"], collapsed: false } },
      ] },
    ]);
    const createdResponse = await request(commandPath, create);
    expect(createdResponse.status, await createdResponse.clone().text()).toBe(200);
    const created = await createdResponse.json();
    expect(created).toMatchObject({ previousVersion: 0, contentVersion: 1,
      noteChanges: [{ after: { title: "My idea", sourceReferences: [], revision: 1 } }] });
    const noteId = created.noteChanges[0].after.id;
    expect((await (await request(`${path}/workspace`)).json()).cards).toHaveLength(2);
    expect(await (await request(commandPath, create)).json()).toEqual(created);
    const reused = await request(commandPath, command(book.id, "create", 0, [{ type: "workspace",
      changes: [{ type: "delete-card", id: "excerpt" }] }]));
    expect(reused.status).toBe(409);
    expect(await reused.json()).toMatchObject({ code: "COMMAND_ID_REUSED" });
    const source = command(book.id, "add-source", 1, [{ type: "add-source", noteId,
      expectedRevision: 1, target: { kind: "card", id: "excerpt" } }]);
    const added = await (await request(commandPath, source)).json();
    expect(added.noteChanges[0].after.sourceReferences).toMatchObject([{ kind: "card", targetId: "excerpt",
      text: "Frozen original", source: excerpt.source }]);
    const referenceId = added.noteChanges[0].after.sourceReferences[0].id;
    const removeExcerpt = command(book.id, "remove-excerpt", 2, [{ type: "workspace",
      changes: [{ type: "delete-card", id: "excerpt" }] }]);
    expect((await request(commandPath, removeExcerpt)).status).toBe(200);
    expect((await (await request(`${path}/notes`)).json())[0].sourceReferences[0].text).toBe("Frozen original");
    const withCitation = { type: "doc", content: [{ type: "paragraph", content: [
      { type: "text", text: "See " }, { type: "sourceReference", attrs: { referenceId } },
    ] }] };
    expect((await request(commandPath, command(book.id, "cite", 3, [{ type: "update-note",
      noteId, expectedRevision: 2, title: "My idea", document: withCitation }]))).status).toBe(200);
    const rejectedRemoval = await request(commandPath, command(book.id, "bad-remove", 4, [
      { type: "remove-source", noteId, expectedRevision: 3, referenceId }]));
    expect(rejectedRemoval.status).toBe(400);
    expect((await (await request(`${path}/workspace`)).json()).revision).toBe(4);
    const emptyDocument = { type: "doc", content: [{ type: "paragraph" }] };
    expect((await request(commandPath, command(book.id, "uncite", 4, [{ type: "update-note",
      noteId, expectedRevision: 3, title: "My idea", document: emptyDocument }]))).status).toBe(200);
    const removed = await (await request(commandPath, command(book.id, "remove-source", 5, [
      { type: "remove-source", noteId, expectedRevision: 4, referenceId }]))).json();
    expect(removed.noteChanges[0].after.sourceReferences).toEqual([]);
    expect((await request(commandPath, command(book.id, "undo-source", 6, [
      { type: "undo", targetCommandId: "remove-source" }]))).status).toBe(200);
    expect((await (await request(`${path}/notes`)).json())[0].sourceReferences).toHaveLength(1);
    const deleted = await (await request(commandPath, command(book.id, "delete-note", 7, [
      { type: "delete-note", noteId, expectedRevision: 6 }]))).json();
    expect(deleted.contentVersion).toBe(8);
    const afterDelete = await (await request(`${path}/workspace`)).json();
    expect(afterDelete.cards).toEqual([]);
    expect(afterDelete.links).toEqual([]);
    expect(afterDelete.groups[0].memberIds).toEqual([]);
    expect((await request(commandPath, command(book.id, "undo-delete", 8, [
      { type: "undo", targetCommandId: "delete-note" }]))).status).toBe(200);
    const afterUndo = await (await request(`${path}/workspace`)).json();
    expect(afterUndo.cards.map((card: { id: string }) => card.id)).toEqual(["note-card"]);
    expect(afterUndo.groups[0].memberIds).toEqual(["note-card"]);
    const beforeInvalid = await (await request(`${path}/notes`)).json();
    const invalid = await request(commandPath, command(book.id, "invalid", 9, [
      { type: "create-note", title: "Must roll back", placement: { id: "invalid-card", x: 10, y: 10,
        width: 320, height: 200 } },
      { type: "workspace", changes: [{ type: "upsert-link", link: { id: "bad", from: "invalid-card",
        to: "missing", label: "" } }] },
    ]));
    expect(invalid.status).toBe(400);
    expect(await (await request(`${path}/notes`)).json()).toEqual(beforeInvalid);
    expect((await (await request(`${path}/workspace`)).json()).revision).toBe(9);
    core.close(); core = createCore(directory, "dist/web"); await connect();
    expect(await (await request(commandPath, create)).json()).toEqual(created);
    const citedAgain = await request(commandPath, command(book.id, "cite-again", 9, [
      { type: "update-note", noteId, expectedRevision: 8, title: "My idea", document: withCitation }]));
    expect(citedAgain.status, await citedAgain.clone().text()).toBe(200);
    const png = new PNG({ width: 2, height: 2 }); png.data.fill(255);
    const mark = await (await request(`${path}/annotations`, { kind: "region", color: "yellow",
      quote: "Marked theorem", anchors: [{ page: 1, rects: [[100, 120, 200, 140]] }],
      image: "data:image/png;base64," + PNG.sync.write(png).toString("base64") })).json();
    const markedSource = await request(commandPath, command(book.id, "add-mark", 10, [
      { type: "add-source", noteId, expectedRevision: 9, target: { kind: "annotation", id: mark.id } }]));
    expect(markedSource.status, await markedSource.clone().text()).toBe(200);
    const archive = Buffer.from(await (await request(`${path}/workspace/archive`)).arrayBuffer());
    const restoredResponse = await fetch(origin + "/api/workspace-archives", {
      method: "POST", headers: { Origin: origin, Cookie: cookie }, body: archive });
    expect(restoredResponse.status, await restoredResponse.clone().text()).toBe(201);
    const restoredBook = await restoredResponse.json();
    const restoredNote = (await (await request(`books/${restoredBook.id}/notes`)).json())[0];
    expect(restoredNote.sourceReferences).toHaveLength(2);
    expect(restoredNote.sourceReferences[0].id).not.toBe(referenceId);
    expect(restoredNote.sourceReferences[0].text).toBe("Frozen original");
    expect(restoredNote.sourceReferences[1]).toMatchObject({ kind: "annotation", text: "Marked theorem",
      source: { fingerprint: book.fingerprint, anchors: mark.anchors }, regionAssetKind: "annotation" });
    expect(restoredNote.sourceReferences[1].region.assetId).not.toBe(mark.assetId);
    const restoredAsset = await request(`books/${restoredBook.id}/annotation-assets/${restoredNote.sourceReferences[1].region.assetId}`);
    expect(restoredAsset.status).toBe(200);
    expect(Buffer.from(await restoredAsset.arrayBuffer()).subarray(0, 8).toString("hex"))
      .toBe("89504e470d0a1a0a");
    expect(restoredNote.document.content[0].content[1].attrs.referenceId)
      .toBe(restoredNote.sourceReferences[0].id);
    const linkedNote = await (await request(`${path}/annotations/${mark.id}/note`, {})).json();
    const deleteLinked = await request(commandPath, command(book.id, "delete-linked", 11, [
      { type: "delete-note", noteId: linkedNote.id, expectedRevision: 1 }]));
    expect(deleteLinked.status, await deleteLinked.clone().text()).toBe(200);
    const unlinkedMark = (await (await request(`${path}/annotations`)).json()).find((a: { id: string }) => a.id === mark.id);
    expect(unlinkedMark.noteId).toBeUndefined();
    expect((await request(commandPath, command(book.id, "restore-linked", 12, [
      { type: "undo", targetCommandId: "delete-linked" }]))).status).toBe(200);
    const relinkedMark = (await (await request(`${path}/annotations`)).json()).find((a: { id: string }) => a.id === mark.id);
    expect(relinkedMark.noteId).toBe(linkedNote.id);
    const collidingWorkspace = { bookId: book.id, commandId: "create", expectedContentVersion: 13,
      changes: [{ type: "delete-card" as const, id: "note-card" }] };
    const workspaceHash = createHash("sha256").update(commandPayload(collidingWorkspace)).digest("hex");
    expect((await request(`v2/${path}/workspace/commands`, {
      ...collidingWorkspace, payloadHash: workspaceHash })).status).toBe(409);
  } finally { core.close(); await rm(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }); }
});
