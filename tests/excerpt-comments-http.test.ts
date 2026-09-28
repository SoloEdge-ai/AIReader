import { test, expect } from "vitest";
import { createHash, randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PDFDocument } from "pdf-lib";
import { strFromU8, unzipSync } from "fflate";
import { createCore } from "../apps/core/src/server";

test("an excerpt keeps its immutable source while its comment becomes a shared Note", async () => {
  const directory = await mkdtemp(join(tmpdir(), "aireader-excerpt-comment-"));
  const core = createCore(directory, "dist/web");
  await new Promise<void>((done) => core.server.listen(0, "127.0.0.1", done));
  const origin = `http://127.0.0.1:${(core.server.address() as { port: number }).port}`;
  const session = await fetch(origin + "/api/session", { method: "POST", headers: { Origin: origin } });
  const headers = { Origin: origin, Cookie: session.headers.get("set-cookie")!.split(";")[0], "Content-Type": "application/json" };
  const request = (path: string, value?: unknown, method = value === undefined ? "GET" : "POST") => fetch(`${origin}/api/${path}`, { method,
    headers, body: value === undefined ? undefined : JSON.stringify(value) });
  try {
    const pdf = await PDFDocument.create(); pdf.addPage([500, 700]).drawText("Source paragraph");
    const book = await (await fetch(`${origin}/api/books`, { method: "POST", headers, body: Buffer.from(await pdf.save()) })).json();
    await core.library.waitForBook(book.id);
    const root = `books/${book.id}`;
    const workspace = () => request(`${root}/workspace`).then((response) => response.json());
    const excerpt = { id: "excerpt", kind: "excerpt", title: "Source", text: "Source paragraph", comment: "My initial thought",
      x: 20, y: 30, width: 300, height: 240,
      source: { fingerprint: book.fingerprint, anchors: [{ page: 1, rects: [[20, 30, 130, 60]] }] } };
    const current = await workspace();
    const payload = { bookId: book.id, expectedContentVersion: current.revision,
      changes: [{ type: "upsert-card", card: excerpt }] };
    const canonical = JSON.stringify(payload, (_key, value) => value && typeof value === "object" && !Array.isArray(value)
      ? Object.fromEntries(Object.keys(value).sort().map((key) => [key, value[key]])) : value);
    expect((await request(`v2/${root}/workspace/commands`, { ...payload, commandId: randomUUID(),
      payloadHash: createHash("sha256").update(canonical).digest("hex") })).status).toBe(200);

    const created = await request(`${root}/workspace/cards/${excerpt.id}/note`, {});
    expect(created.status).toBe(201);
    const note = await created.json();
    expect(note.document.content[0].content[0].text).toBe("My initial thought");
    expect((await workspace()).cards[0]).toMatchObject({ ...excerpt, comment: "", noteId: note.id });
    expect((await request(`${root}/workspace/cards/${excerpt.id}/note`, {})).status).toBe(200);
    expect((await (await request(`${root}/notes`)).json())).toHaveLength(1);
    expect((await request(`${root}/notes/${note.id}`, { revision: note.revision, title: "Reconsidered",
      document: { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "New interpretation" }] }] } })).status).toBe(200);
    expect((await workspace()).cards[0]).toMatchObject({ text: "Source paragraph", comment: "", noteId: note.id });
    expect((await request(`${root}/notes/${note.id}`, undefined, "DELETE")).status).toBe(200);
    expect((await workspace()).cards[0]).toMatchObject({ id: excerpt.id, text: "Source paragraph" });
    expect((await workspace()).cards[0].noteId).toBeUndefined();
    expect((await request(`${root}/notes/${note.id}/restore`, {})).status).toBe(200);
    expect((await workspace()).cards[0].noteId).toBe(note.id);
    const activeNote = (await (await request(`${root}/notes`)).json())[0];
    const conversation = await (await request(`${root}/sessions`, {})).json();
    const material = await request(`${root}/question-materials`, { bookId: book.id, sessionId: conversation.id,
      requestId: "excerpt-comment", workspaceRevision: (await workspace()).revision,
      targets: [{ kind: "card", id: excerpt.id, revision: activeNote.revision }], previews: [] });
    expect(material.status).toBe(201);
    expect((await material.json()).sections.map((section: { kind: string; text: string }) => [section.kind, section.text])).toEqual([
      ["book-excerpt", "Source paragraph"], ["user-note", "New interpretation\n"],
    ]);
    const exported = await request(`${root}/workspace/archive`);
    expect(exported.status).toBe(200);
    const archive = new Uint8Array(await exported.arrayBuffer());
    const copied = await fetch(`${origin}/api/workspace-archives`, { method: "POST", headers, body: Buffer.from(archive) });
    expect(copied.status).toBe(201);
    const copy = await copied.json();
    const copyNote = (await (await request(`books/${copy.id}/notes`)).json())[0];
    const copyCard = (await (await request(`books/${copy.id}/workspace`)).json()).cards[0];
    expect(copyCard.noteId).toBe(copyNote.id);
    expect(copyNote.id).not.toBe(activeNote.id);
    expect(copyNote.sourceCard.cardId).toBe(copyCard.id);
    expect(copyNote.sourceCard.text).toBe("Source paragraph");
    // Associating a Note with an excerpt must not consume its one independent card.
    const noteCard = { id: "comment-note-card", kind: "note", noteId: note.id,
      title: "", text: "", comment: "", x: 360, y: 30, width: 340, height: 220 };
    const withPlacement = { bookId: book.id, expectedContentVersion: (await workspace()).revision,
      changes: [{ type: "upsert-card", card: noteCard }] };
    const hash = (payload: unknown) => createHash("sha256").update(JSON.stringify(payload,
      (_key, value) => value && typeof value === "object" && !Array.isArray(value)
        ? Object.fromEntries(Object.keys(value).sort().map((key) => [key, value[key]])) : value)).digest("hex");
    expect((await request(`v2/${root}/workspace/commands`, { ...withPlacement, commandId: randomUUID(),
      payloadHash: hash(withPlacement) })).status).toBe(200);
    expect((await workspace()).cards).toHaveLength(2);
    const bothArchive = await request(`${root}/workspace/archive`);
    expect(bothArchive.status).toBe(200);
    const bothCopy = await fetch(`${origin}/api/workspace-archives`, { method: "POST", headers,
      body: Buffer.from(await bothArchive.arrayBuffer()) });
    expect(bothCopy.status).toBe(201);
    const bothBook = await bothCopy.json();
    const bothCards = (await (await request(`books/${bothBook.id}/workspace`)).json()).cards;
    expect(bothCards).toHaveLength(2);
    expect(bothCards[0].noteId).toBe(bothCards[1].noteId);
    const withoutPlacement = { bookId: book.id, expectedContentVersion: (await workspace()).revision,
      changes: [{ type: "delete-card", id: noteCard.id }] };
    expect((await request(`v2/${root}/workspace/commands`, { ...withoutPlacement, commandId: randomUUID(),
      payloadHash: hash(withoutPlacement) })).status).toBe(200);
    const exportedNote = await request(`${root}/notes/${note.id}/export`);
    expect(exportedNote.status).toBe(200);
    const files = unzipSync(new Uint8Array(await exportedNote.arrayBuffer()));
    expect(strFromU8(files["note.md"])).toContain("Source paragraph");
    expect(strFromU8(files["note.md"])).toContain("笔记正文是个人内容");
    const beforeRemoval = await workspace();
    const removal = { bookId: book.id, expectedContentVersion: beforeRemoval.revision,
      changes: [{ type: "delete-card", id: excerpt.id }] };
    const removalCanonical = JSON.stringify(removal, (_key, value) => value && typeof value === "object" && !Array.isArray(value)
      ? Object.fromEntries(Object.keys(value).sort().map((key) => [key, value[key]])) : value);
    expect((await request(`v2/${root}/workspace/commands`, { ...removal, commandId: randomUUID(),
      payloadHash: createHash("sha256").update(removalCanonical).digest("hex") })).status).toBe(200);
    expect((await workspace()).cards).toHaveLength(0);
    const orphanArchive = await request(`${root}/workspace/archive`);
    expect(orphanArchive.status).toBe(200);
    const orphanCopy = await fetch(`${origin}/api/workspace-archives`, { method: "POST", headers,
      body: Buffer.from(await orphanArchive.arrayBuffer()) });
    expect(orphanCopy.status).toBe(201);
    const orphanBook = await orphanCopy.json();
    expect((await (await request(`books/${orphanBook.id}/workspace`)).json()).cards).toHaveLength(0);
    const orphanNote = (await (await request(`books/${orphanBook.id}/notes`)).json())[0];
    expect(orphanNote.sourceCard.text).toBe("Source paragraph");
    expect(orphanNote.sourceCard.cardId).not.toBe(excerpt.id);
    const legacy = { id: "old-personal", kind: "note", title: "Idea", text: "A personal idea", comment: "",
      x: 20, y: 30, width: 300, height: 240 };
    const currentPersonal = await workspace();
    const personalPayload = { bookId: book.id, expectedContentVersion: currentPersonal.revision,
      changes: [{ type: "upsert-card", card: legacy }] };
    const personalCanonical = JSON.stringify(personalPayload, (_key, value) => value && typeof value === "object" && !Array.isArray(value)
      ? Object.fromEntries(Object.keys(value).sort().map((key) => [key, value[key]])) : value);
    expect((await request(`v2/${root}/workspace/commands`, { ...personalPayload, commandId: randomUUID(),
      payloadHash: createHash("sha256").update(personalCanonical).digest("hex") })).status).toBe(200);
    const promoted = await request(`${root}/workspace/cards/${legacy.id}/note`, {});
    expect(promoted.status).toBe(201);
    const personalNote = await promoted.json();
    expect(personalNote.document.content[0].content[0].text).toBe("A personal idea");
    expect((await workspace()).cards[0]).toMatchObject({ ...legacy, title: "", text: "", noteId: personalNote.id });
    expect((await request(`${root}/workspace/cards/${legacy.id}/note`, {})).status).toBe(200);
    expect((await request(`${root}/notes/${personalNote.id}`, undefined, "DELETE")).status).toBe(200);
    expect((await workspace()).cards).toHaveLength(0);
    expect((await request(`${root}/notes/${personalNote.id}/restore`, {})).status).toBe(200);
    expect((await workspace()).cards[0].noteId).toBe(personalNote.id);
    const longText = "x\n".repeat(2000);
    const multiline = { ...legacy, id: "multiline-personal", text: longText, y: 300 };
    const beforeMultiline = await workspace();
    const multilinePayload = { bookId: book.id, expectedContentVersion: beforeMultiline.revision,
      changes: [{ type: "upsert-card", card: multiline }] };
    const multilineCanonical = JSON.stringify(multilinePayload, (_key, value) => value && typeof value === "object" && !Array.isArray(value)
      ? Object.fromEntries(Object.keys(value).sort().map((key) => [key, value[key]])) : value);
    expect((await request(`v2/${root}/workspace/commands`, { ...multilinePayload, commandId: randomUUID(),
      payloadHash: createHash("sha256").update(multilineCanonical).digest("hex") })).status).toBe(200);
    const longPromoted = await request(`${root}/workspace/cards/${multiline.id}/note`, {});
    expect(longPromoted.status).toBe(201);
    const longNote = await longPromoted.json();
    expect((await request(`${root}/notes/${longNote.id}/export`)).status).toBe(200);
    expect((await request(`${root}/workspace/archive`)).status).toBe(200);
    const unrepresentable = { ...legacy, id: "control-heavy", text: "\u0001".repeat(18000), y: 560 };
    const beforeControl = await workspace();
    const controlPayload = { bookId: book.id, expectedContentVersion: beforeControl.revision,
      changes: [{ type: "upsert-card", card: unrepresentable }] };
    const controlCanonical = JSON.stringify(controlPayload, (_key, value) => value && typeof value === "object" && !Array.isArray(value)
      ? Object.fromEntries(Object.keys(value).sort().map((key) => [key, value[key]])) : value);
    expect((await request(`v2/${root}/workspace/commands`, { ...controlPayload, commandId: randomUUID(),
      payloadHash: createHash("sha256").update(controlCanonical).digest("hex") })).status).toBe(200);
    const noteCount = (await (await request(`${root}/notes`)).json()).length;
    expect((await request(`${root}/workspace/cards/${unrepresentable.id}/note`, {})).status).toBe(400);
    expect((await workspace()).cards.find((card: { id: string }) => card.id === unrepresentable.id)).toMatchObject(unrepresentable);
    expect((await (await request(`${root}/notes`)).json())).toHaveLength(noteCount);
    const pdf2 = await PDFDocument.create(); pdf2.addPage([500, 700]).drawText("Another book");
    const another = await (await fetch(`${origin}/api/books`, { method: "POST", headers,
      body: Buffer.from(await pdf2.save()) })).json();
    expect((await request(`books/${another.id}/workspace/cards/${excerpt.id}/note`, {})).status).toBe(400);
  } finally {
    core.close();
    await rm(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }
});
