import { test, expect } from "vitest";
import { createHash, randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PDFDocument } from "pdf-lib";
import { createCore } from "../apps/core/src/server";
import WebSocket from "ws";
import { once } from "node:events";
import type { CoreEvent } from "../packages/protocol/src/events";

test("a note placement shares content and removing the card preserves its note", async () => {
  const directory = await mkdtemp(join(tmpdir(), "aireader-placement-"));
  const core = createCore(directory, "dist/web");
  await new Promise<void>((done) => core.server.listen(0, "127.0.0.1", done));
  const origin = `http://127.0.0.1:${(core.server.address() as { port: number }).port}`;
  const session = await fetch(origin + "/api/session", { method: "POST", headers: { Origin: origin } });
  const headers = { Origin: origin, Cookie: session.headers.get("set-cookie")!.split(";")[0], "Content-Type": "application/json" };
  const request = (path: string, value?: unknown, method = value === undefined ? "GET" : "POST") =>
    fetch(origin + "/api/" + path, { method, headers, ...(value === undefined ? {} : { body: JSON.stringify(value) }) });
  try {
    const pdf = await PDFDocument.create(); pdf.addPage([500, 700]);
    const book = await (await fetch(origin + "/api/books", { method: "POST", headers, body: Buffer.from(await pdf.save()) })).json();
    await core.library.waitForBook(book.id);
    const path = `books/${book.id}`;
    const note = await (await request(`${path}/notes`, {})).json();
    const snapshot = async () => (await request(`${path}/workspace`)).json();
    const command = async (changes: unknown[]) => {
      const payload = { bookId: book.id, expectedContentVersion: (await snapshot()).revision, changes };
      const canonical = JSON.stringify(payload, (_key, v) => v && typeof v === "object" && !Array.isArray(v)
        ? Object.fromEntries(Object.keys(v).sort().map((key) => [key, v[key]])) : v);
      return request(`v2/${path}/workspace/commands`, { ...payload, commandId: randomUUID(),
        payloadHash: createHash("sha256").update(canonical).digest("hex") });
    };
    const placement = { id: "placement", kind: "note", noteId: note.id, title: "", text: "", comment: "",
      x: 30, y: 50, width: 320, height: 260 };
    expect((await command([{ type: "upsert-card", card: placement }])).status).toBe(200);
    expect((await snapshot()).cards).toEqual([placement]);
    const edited = await request(`${path}/notes/${note.id}`, { revision: note.revision, title: "Shared title",
      document: { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "Only one body" }] }] } });
    expect(edited.status).toBe(200);
    expect((await snapshot()).cards[0].text).toBe("");
    expect((await command([{ type: "upsert-card", card: { ...placement, id: "duplicate" } }])).status).toBe(400);
    expect((await command([{ type: "upsert-card", card: { ...placement, text: "Second truth" } }])).status).toBe(400);
    expect((await command([{ type: "delete-card", id: placement.id }])).status).toBe(200);
    expect((await (await request(`${path}/notes`)).json())[0].title).toBe("Shared title");
    expect((await command([{ type: "upsert-card", card: placement },
      { type: "upsert-card", card: { ...placement, id: "other", noteId: undefined, title: "Other" } },
      { type: "upsert-link", link: { id: "edge", from: "placement", to: "other", label: "Related" } }])).status).toBe(200);
    expect((await request(`${path}/notes/${note.id}`, undefined, "DELETE")).status).toBe(200);
    expect((await snapshot()).cards.map((card: { id: string }) => card.id)).toEqual(["other"]);
    expect((await snapshot()).links).toEqual([]);
    expect((await request(`${path}/notes/${note.id}/restore`, {})).status).toBe(200);
    expect((await snapshot()).cards.find((card: { id: string }) => card.id === "placement")).toEqual(placement);
    expect((await snapshot()).links).toEqual([{ id: "edge", from: "placement", to: "other", label: "Related" }]);
    expect((await command([{ type: "upsert-card", card: { ...placement, id: "foreign", noteId: "missing-note" } }])).status).toBe(400);
    const conversation = await (await request(`${path}/sessions`, {})).json();
    const materialInput = { bookId: book.id, sessionId: conversation.id, requestId: "linked-note",
      workspaceRevision: (await snapshot()).revision, targets: [{ kind: "card", id: placement.id, revision: 4 }], previews: [] };
    const currentNote = (await (await request(`${path}/notes`)).json())[0];
    materialInput.targets[0].revision = currentNote.revision;
    const materialResponse = await request(`${path}/question-materials`, materialInput);
    expect(materialResponse.status).toBe(201);
    const material = await materialResponse.json();
    expect(material.sections).toEqual([{ kind: "user-note", targetId: "placement", title: "Shared title", text: "Only one body\n" }]);
    expect((await request(`${path}/notes/${note.id}`, { ...currentNote, title: "Updated after freezing" })).status).toBe(200);
    expect((await request(`${path}/question-materials`, { ...materialInput, requestId: "stale-note" })).status).toBe(400);
    expect((await (await request(`${path}/question-materials/${material.id}?session=${conversation.id}`)).json()).sections).toEqual(material.sections);
    const archive = new Uint8Array(await (await request(`${path}/workspace/archive`)).arrayBuffer());
    const restoredResponse = await fetch(origin + "/api/workspace-archives", { method: "POST", headers, body: Buffer.from(archive) });
    expect(restoredResponse.status).toBe(201);
    const restored = await restoredResponse.json();
    const restoredNotes = await (await request(`books/${restored.id}/notes`)).json();
    const restoredWorkspace = await (await request(`books/${restored.id}/workspace`)).json();
    expect(restoredWorkspace.cards.find((card: { noteId?: string }) => card.noteId)?.noteId).toBe(restoredNotes[0].id);
    expect(restoredNotes[0].id).not.toBe(note.id);
    expect(restoredNotes[0].title).toBe("Updated after freezing");
    expect((await command([{ type: "upsert-card", card: { ...placement, id: "foreign", noteId: restoredNotes[0].id } }])).status).toBe(400);
    await request(`${path}/notes/${note.id}`, undefined, "DELETE");
    await command([{ type: "delete-card", id: "other" }]);
    const beforeFailedUndo = await snapshot();
    const socket = new WebSocket(origin.replace("http:", "ws:") + "/events", { headers });
    const events: CoreEvent[] = [];
    socket.on("message", (data) => events.push(JSON.parse(data.toString())));
    try {
      await once(socket, "open");
      expect((await request(`${path}/notes/${note.id}/restore`, {})).status).toBe(400);
      // Pong is an ordered transport barrier, not an arbitrary delay for absent events.
      const pong = once(socket, "pong"); socket.ping(); await pong;
      expect(events.filter((event) => event.type === "note" || event.type === "workspace")).toEqual([]);
      expect(await snapshot()).toEqual(beforeFailedUndo);
      expect(await (await request(`${path}/notes`)).json()).toEqual([]);
      expect((await command([{ type: "upsert-card", card: { ...placement, id: "other", noteId: undefined, title: "Other" } }])).status).toBe(200);
      events.length = 0;
      expect((await request(`${path}/notes/${note.id}/restore`, {})).status).toBe(200);
      const restoredPong = once(socket, "pong"); socket.ping(); await restoredPong;
      expect(events.map((event) => event.type)).toEqual(["note", "workspace"]);
      expect((await snapshot()).cards.map((card: { id: string }) => card.id)).toContain("placement");
    } finally { socket.terminate(); }
  } finally {
    core.close();
    await rm(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }
});
