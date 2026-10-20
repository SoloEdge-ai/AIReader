import { createHash, randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { PDFDocument } from "pdf-lib";
import { PNG } from "pngjs";
import { expect, test } from "vitest";
import { createCore } from "../apps/core/src/server";
import { bookCommandPayload, type BookChange, type BookCommandReceipt } from "../packages/protocol/src/book-commands";
import type { ChatTurn, Note, QuestionMaterialSnapshot } from "../packages/protocol/src";

test("question cards keep conclusions, sessions and frozen continuations isolated and durable", async () => {
  const directory = await mkdtemp(join(tmpdir(), "aireader-questions-"));
  const config = { path: process.execPath, version: "fixture", args: [resolve("tests/fixtures/fake-codex.mjs")] };
  let core = createCore(directory, "dist/web", config), origin = "", cookie = "";
  const connect = async () => {
    await new Promise<void>((done) => core.server.listen(0, "127.0.0.1", done));
    origin = `http://127.0.0.1:${(core.server.address() as { port: number }).port}`;
    cookie = (await fetch(origin + "/api/session", { method: "POST", headers: { Origin: origin } }))
      .headers.get("set-cookie")!.split(";")[0];
  };
  const request = (path: string, value?: unknown) => fetch(origin + "/api/" + path, {
    method: value === undefined ? "GET" : "POST", headers: { Origin: origin, Cookie: cookie },
    body: value instanceof Uint8Array ? Buffer.from(value) : value === undefined ? undefined : JSON.stringify(value),
  });
  try {
    await connect();
    const pdf = await PDFDocument.create();
    pdf.addPage([500, 700]).drawText("Original frozen material.", { x: 30, y: 600 });
    const book = await (await request("books", await pdf.save())).json();
    await core.library.waitForBook(book.id);
    const path = `books/${book.id}`, commands = `v2/${path}/commands`;
    const workspace = () => request(`${path}/workspace`).then((r) => r.json());
    const notes = (): Promise<Note[]> => request(`${path}/notes`).then((r) => r.json());
    const execute = async (changes: BookChange[], commandId = randomUUID()) => {
      const payload = { bookId: book.id, expectedContentVersion: (await workspace()).revision, changes };
      return request(commands, { ...payload, commandId,
        payloadHash: createHash("sha256").update(bookCommandPayload(payload)).digest("hex") });
    };
    const placement = (id: string) => ({ id, x: 40, y: 50, width: 340, height: 240 });
    const created: BookCommandReceipt = await (await execute([{ type: "create-question", title: "Why does this hold?",
      placement: placement("question-card") }])).json();
    let question = created.noteChanges[0].after;
    const sessionId = question.question!.sessionId!;
    expect(question.question?.status).toBe("open");
    expect((await (await request(`${path}/sessions`)).json()).some((s: { id: string }) => s.id === sessionId)).toBe(true);
    const sessionCount = (await (await request(`${path}/sessions`)).json()).length;
    expect((await execute([{ type: "create-question", title: "Must roll back",
      placement: placement("question-card") }])).status).toBe(400);
    expect((await notes()).length).toBe(1);
    expect((await (await request(`${path}/sessions`)).json()).length).toBe(sessionCount);
    await execute([{ type: "workspace", changes: [{ type: "upsert-object", object: { id: "drawing", kind: "shape",
      shape: "rectangle", surface: { kind: "board" }, x: 10, y: 10, width: 50, height: 50,
      color: "#345d84", strokeWidth: 2 } }] }]);
    const png = new PNG({ width: 2, height: 2 }); png.data.fill(255);
    const image = PNG.sync.write(png);
    const frozen: QuestionMaterialSnapshot = await (await request(`${path}/question-materials`, {
      bookId: book.id, sessionId, requestId: "freeze-question", workspaceRevision: (await workspace()).revision,
      targets: [{ kind: "note", id: question.id, revision: question.revision }, { kind: "object", id: "drawing" }],
      previews: [{ objectIds: ["drawing"], surface: "board", includesPdfBackground: false,
        image: `data:image/png;base64,${image.toString("base64")}` }],
    })).json();
    const start = async (material: QuestionMaterialSnapshot) => {
      const response = await request(`${path}/turns`, { reading: { bookId: book.id, page: 1, scope: "materials" },
        question: "NOTES_NO_SOURCE", sessionId, model: "fixture-a", effort: "medium", materialIds: [material.id] });
      expect(response.status, await response.clone().text()).toBe(202);
      const turn: ChatTurn = await response.json();
      await expect.poll(() => core.library.chat.turn(book.id, turn.id)?.status).toBe("complete");
      return core.library.chat.turn(book.id, turn.id)!;
    };
    const first = await start(frozen);
    const saved: BookCommandReceipt = await (await execute([{ type: "save-answer", turnId: first.id,
      questionId: question.id, placement: placement("answer-1") }])).json();
    question = saved.noteChanges.find((delta) => delta.after.id === question.id)!.after;
    const conclusion = saved.noteChanges.find((delta) => delta.after.origin)?.after!;
    expect(question.question).toMatchObject({ status: "open", conclusionNoteIds: [conclusion.id] });
    expect(question.question?.currentConclusionId).toBeUndefined();
    expect(question.document).toEqual(created.noteChanges[0].after.document);
    const undone: BookCommandReceipt = await (await execute([{ type: "undo", targetCommandId: saved.commandId }])).json();
    expect((await notes()).find((note) => note.id === question.id)?.question?.conclusionNoteIds).toEqual([]);
    expect((await notes()).some((note) => note.id === conclusion.id)).toBe(false);
    expect((await execute([{ type: "undo", targetCommandId: undone.commandId }])).status).toBe(200);
    question = (await notes()).find((note) => note.id === question.id)!;
    const selected: BookCommandReceipt = await (await execute([{ type: "update-question", noteId: question.id,
      expectedRevision: question.revision, status: "concluded", currentConclusionId: conclusion.id }])).json();
    question = selected.noteChanges[0].after;
    expect((await execute([{ type: "update-question", noteId: question.id, expectedRevision: 1,
      status: "review" }])).status).toBe(409);
    const reuseInput = { turnId: first.id, sessionId, requestId: randomUUID() };
    await execute([{ type: "workspace", changes: [{ type: "delete-object", id: "drawing" }] }]);
    const reused: QuestionMaterialSnapshot[] = await (await request(`${path}/question-materials/reuse-turn`, reuseInput)).json();
    expect(reused[0].id).not.toBe(frozen.id);
    expect(reused[0].committedTurnId).toBeUndefined();
    expect(reused[0].sections).toEqual(frozen.sections);
    expect(Buffer.from(await (await request(`${path}/question-materials/${reused[0].id}/images/${reused[0].images[0].id}?session=${sessionId}`)).arrayBuffer())).toEqual(image);
    expect(await (await request(`${path}/question-materials/reuse-turn`, reuseInput)).json()).toEqual(reused);
    const second = await start(reused[0]);
    expect((await request(`${path}/turns`, { reading: { bookId: book.id, page: 1, scope: "materials" },
      question: "NOTES_NO_SOURCE", sessionId, materialIds: [reused[0].id] })).status).toBe(400);
    const secondSaved: BookCommandReceipt = await (await execute([{ type: "save-answer", turnId: second.id,
      questionId: question.id, placement: placement("answer-2") }])).json();
    question = secondSaved.noteChanges.find((delta) => delta.after.id === question.id)!.after;
    expect(question.question?.conclusionNoteIds).toHaveLength(2);
    expect(question.question?.currentConclusionId).toBe(conclusion.id);
    expect(question.question?.status).toBe("concluded");
    const branch: BookCommandReceipt = await (await execute([{ type: "create-question", title: "A separate question",
      sourceTurnId: second.id, parentQuestionId: question.id, placement: placement("branch") }])).json();
    const child = branch.noteChanges[0].after;
    expect(child.question?.parentQuestionId).toBe(question.id);
    expect(child.question?.sourceQuestion).toBe(second.question);
    expect(child.question?.sessionId).not.toBe(sessionId);
    const beforeBad = (await notes()).length;
    expect((await execute([{ type: "save-answer", turnId: second.id, questionId: child.id,
      placement: placement("bad") }])).status).toBe(400);
    expect((await notes()).length).toBe(beforeBad);
    const archive = new Uint8Array(await (await request(`${path}/workspace/archive`)).arrayBuffer());
    const restoredResponse = await request("workspace-archives", archive);
    expect(restoredResponse.status, await restoredResponse.clone().text()).toBe(201);
    const restored = await restoredResponse.json();
    const restoredNotes: Note[] = await (await request(`books/${restored.id}/notes`)).json();
    const restoredQuestion = restoredNotes.find((note) => note.title === question.title)!;
    expect(restoredQuestion.question?.sessionId).toBeUndefined();
    expect(restoredQuestion.question?.sourceTurnId).toBeUndefined();
    expect(restoredQuestion.question?.currentConclusionId).not.toBe(conclusion.id);
    expect(restoredNotes.some((note) => note.id === restoredQuestion.question?.currentConclusionId)).toBe(true);
    expect(restoredNotes.find((note) => note.title === child.title)?.question?.parentQuestionId).toBe(restoredQuestion.id);
    expect(restoredNotes.find((note) => note.title === child.title)?.question?.sourceQuestion).toBe(second.question);
    expect((await execute([{ type: "delete-note", noteId: question.id, expectedRevision: question.revision }])).status).toBe(200);
    expect((await notes()).some((note) => note.id === conclusion.id)).toBe(true);
    expect(core.library.chat.turn(book.id, first.id)?.answer).toBe(first.answer);
    const deleted = core.library.store.getForBook<Note>("note", question.id, book.id)!;
    expect((await execute([{ type: "restore-note", noteId: question.id, expectedRevision: deleted.revision }])).status).toBe(200);
    expect((await workspace()).cards.some((card: { id: string }) => card.id === "question-card")).toBe(true);
    await core.close(); core = createCore(directory, "dist/web", config); await connect();
    expect(await (await request(commands, { bookId: book.id, commandId: created.commandId,
      expectedContentVersion: created.previousVersion, payloadHash: created.payloadHash, changes: created.changes })).json()).toEqual(created);
    expect((await notes()).find((note) => note.id === child.id)?.question?.parentQuestionId).toBe(question.id);
    const foreign = await (await request("books", await pdf.save())).json();
    expect((await request(`books/${foreign.id}/question-materials/reuse-turn`, reuseInput)).status).toBe(400);
  } finally { await core.close(); await rm(directory, { recursive: true, force: true }); }
}, 30000);
