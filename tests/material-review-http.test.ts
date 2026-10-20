import { createHash, randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { PDFDocument } from "pdf-lib";
import { PNG } from "pngjs";
import { expect, test } from "vitest";
import { createCore } from "../apps/core/src/server";
import { bookCommandPayload, type BookChange, type BookCommandReceipt } from "../packages/protocol/src/book-commands";
import type { BookWorkspace, WorkspaceCard } from "../packages/protocol/src/workspace";
import type { ChatTurn, MaterialReview, MaterialReviewPlan, Note, QuestionMaterialSnapshot, QuestionSummary } from "../packages/protocol/src";

test("material reviews freeze real differences and navigation stays durable and book isolated", async () => {
  const directory = await mkdtemp(join(tmpdir(), "aireader-material-review-"));
  const config = { path: process.execPath, version: "fixture", args: [resolve("tests/fixtures/fake-codex.mjs")] };
  let core = createCore(directory, "dist/web", config), origin = "", cookie = "";
  const connect = async () => {
    await new Promise<void>((done) => core.server.listen(0, "127.0.0.1", done));
    origin = `http://127.0.0.1:${(core.server.address() as { port: number }).port}`;
    cookie = (await fetch(origin + "/api/session", { method: "POST", headers: { Origin: origin } })).headers.get("set-cookie")!.split(";")[0];
  };
  const request = (path: string, body?: unknown, method?: string) => fetch(origin + "/api/" + path, {
    method: method ?? (body === undefined ? "GET" : "POST"), headers: { Origin: origin, Cookie: cookie },
    body: body instanceof Uint8Array ? Buffer.from(body) : body === undefined ? undefined : JSON.stringify(body),
  });
  const ok = async <T,>(path: string, body?: unknown): Promise<T> => {
    const response = await request(path, body);
    expect(response.ok, await response.clone().text()).toBe(true); return response.json();
  };
  try {
    await connect();
    const pdf = await PDFDocument.create(); pdf.addPage([500, 700]).drawText("Original frozen evidence.", { x: 30, y: 600 });
    const book = await ok<{ id: string; fingerprint: string }>("books", await pdf.save());
    await core.library.waitForBook(book.id);
    const path = `books/${book.id}`;
    const workspace = () => ok<BookWorkspace>(`${path}/workspace`);
    const notes = () => ok<Note[]>(`${path}/notes`);
    const execute = async (changes: BookChange[], bookId = book.id) => {
      const payload = { bookId, expectedContentVersion: (await ok<BookWorkspace>(`books/${bookId}/workspace`)).revision, changes };
      return ok<BookCommandReceipt>(`v2/books/${bookId}/commands`, { ...payload, commandId: randomUUID(),
        payloadHash: createHash("sha256").update(bookCommandPayload(payload)).digest("hex") });
    };
    const placement = (id: string) => ({ id, x: 40, y: 50, width: 340, height: 240 });
    const document = (text: string) => ({ type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text }] }] });
    let question = (await execute([{ type: "create-question", title: "Research question", placement: placement("q") }])).noteChanges[0].after;
    const sessionId = question.question!.sessionId!;
    const personal = (await execute([{ type: "create-note", title: "Personal material", document: document("BEFORE_PERSONAL"), placement: placement("personal") }])).noteChanges[0].after;
    const excerpt = (id: string): WorkspaceCard => ({ id, kind: "excerpt", title: id, text: "Original frozen evidence.", comment: "",
      x: 50, y: 50, width: 260, height: 160, source: { fingerprint: book.fingerprint, anchors: [{ page: 1, rects: [[25, 590, 450, 630]] }] } });
    await execute([{ type: "workspace", changes: [
      ...["original", "missing", "removed"].map((id) => ({ type: "upsert-card" as const, card: excerpt(id) })),
      { type: "upsert-object", object: { id: "drawing", kind: "shape", shape: "rectangle", surface: { kind: "board" },
        x: 10, y: 10, width: 50, height: 50, color: "#345d84", strokeWidth: 2 } },
      { type: "upsert-link", link: { id: "relation", from: "personal", to: "original", label: "Compare", directed: false } },
    ] }]);
    const preview = (color: number) => {
      const png = new PNG({ width: 2, height: 2 }); png.data.fill(color);
      return { objectIds: ["drawing"], surface: "board" as const, includesPdfBackground: false,
        image: `data:image/png;base64,${PNG.sync.write(png).toString("base64")}` };
    };
    const frozen = await ok<QuestionMaterialSnapshot>(`${path}/question-materials`, { bookId: book.id, sessionId,
      requestId: "baseline", workspaceRevision: (await workspace()).revision,
      targets: [{ kind: "card", id: "personal", revision: personal.revision }, ...["original", "missing", "removed"].map((id) => ({ kind: "card", id })),
        { kind: "object", id: "drawing" }], previews: [preview(255)] });
    const start = async (material: QuestionMaterialSnapshot, questionId = question.id, prompt = "NOTES_NO_SOURCE") => {
      const turn = await ok<ChatTurn>(`${path}/turns`, { reading: { bookId: book.id, page: 1, scope: "materials" },
        question: prompt, sessionId, questionId, materialIds: [material.id], model: "fixture-a", effort: "medium" });
      await expect.poll(() => core.library.chat.turn(book.id, turn.id)?.status).toBe("complete");
      return core.library.chat.turn(book.id, turn.id)!;
    };
    const first = await start(frozen);
    const saved = await execute([{ type: "save-answer", turnId: first.id, questionId: question.id, placement: placement("answer") }]);
    question = saved.noteChanges.find((item) => item.after.id === question.id)!.after;
    const conclusion = saved.noteChanges.find((item) => item.after.origin)!.after;
    question = (await execute([{ type: "update-question", noteId: question.id, expectedRevision: question.revision,
      status: "concluded", currentConclusionId: conclusion.id }])).noteChanges[0].after;
    await execute([{ type: "update-note", noteId: personal.id, expectedRevision: personal.revision,
      title: personal.title, document: document("LATEST_PERSONAL") }, { type: "workspace", changes: [
        { type: "upsert-card", card: { ...excerpt("original"), x: 800 } }, { type: "delete-card", id: "missing" },
        { type: "upsert-card", card: excerpt("added") },
    ] }]);
    const planPath = `${path}/questions/${question.id}/material-plan`;
    const plan = await ok<MaterialReviewPlan>(planPath, { additionalIds: ["added", "answer"] });
    expect(plan.baselineTurnId).toBe(first.id);
    expect(plan.targets.find((entry) => entry.target.id === "missing")?.available).toBe(false);
    const input = { requestId: randomUUID(), questionRevision: plan.questionRevision, baselineTurnId: plan.baselineTurnId,
      workspaceRevision: plan.workspaceRevision, targets: plan.targets.filter((entry) => entry.available && entry.target.id !== "removed").map((entry) => entry.target),
      previews: [preview(240)] };
    const reviewPath = `${path}/questions/${question.id}/material-review`;
    const reviewed = await ok<MaterialReview>(reviewPath, input);
    expect(Object.fromEntries(reviewed.entries.map((entry) => [entry.targetId, entry.status]))).toEqual({
      personal: "updated", original: "unchanged", missing: "missing", removed: "removed", drawing: "updated", relation: "unchanged", added: "added", answer: "added",
    });
    expect(reviewed.latest.sections.find((section) => section.targetId === "answer")?.provenance).toMatchObject({ kind: "ai", turnId: first.id });
    expect(reviewed.latest.sections.find((section) => section.targetId === "personal")?.text).toContain("LATEST_PERSONAL");
    const changedPersonal = (await notes()).find((note) => note.id === personal.id)!;
    await execute([{ type: "update-note", noteId: personal.id, expectedRevision: changedPersonal.revision,
      title: personal.title, document: document("AFTER_REVIEW") }]);
    expect(await ok<MaterialReview>(reviewPath, input)).toEqual(reviewed);
    expect((await request(reviewPath, { ...input, previews: [preview(200)] })).status).toBe(400);
    expect((await request(reviewPath, { ...input, requestId: randomUUID() })).status).toBe(409);
    expect((await request(planPath, { additionalIds: ["foreign-id"] })).status).toBe(400);
    expect((await request(planPath, { additionalIds: Array.from({ length: 21 }, (_, i) => `extra-${i}`) })).status).toBe(400);
    const second = await start(reviewed.latest, question.id, "CHECK_MATERIAL");
    const actualPrompt = Buffer.from(JSON.parse(second.answer.split("Materials received: ")[1]).promptBase64, "base64").toString();
    expect(actualPrompt).toContain("LATEST_PERSONAL");
    expect(actualPrompt).not.toContain("BEFORE_PERSONAL");
    expect(actualPrompt).not.toContain("AFTER_REVIEW");
    expect(second.questionId).toBe(question.id);
    expect(second.context.materials![0].sections.find((section) => section.targetId === "personal")?.text).toContain("LATEST_PERSONAL");
    expect(JSON.stringify(second.context)).not.toContain("AFTER_REVIEW");
    expect((await request(reviewPath, input)).status).toBe(400);
    expect(core.library.chat.turn(book.id, first.id)?.context).toEqual(first.context);
    expect((await notes()).find((note) => note.id === conclusion.id)).toEqual(conclusion);
    expect((await notes()).find((note) => note.id === question.id)).toEqual(question);
    // Questions made from one existing session still own separate future turns.
    const child = (await execute([{ type: "create-question", title: "Shared-session question", sourceTurnId: first.id, placement: placement("child") }])).noteChanges[0].after;
    const reused = await ok<QuestionMaterialSnapshot[]>(`${path}/question-materials/reuse-turn`, { turnId: first.id, sessionId, requestId: randomUUID() });
    const childTurn = await start(reused[0], child.id);
    // A newer conclusion collected from this shared session is a B1 fallback,
    // not the baseline when this question already owns a turn.
    const collected = await execute([{ type: "save-answer", turnId: childTurn.id, questionId: question.id, placement: placement("collected") }]);
    question = collected.noteChanges.find((item) => item.after.id === question.id)!.after;
    expect((await ok<MaterialReviewPlan>(planPath, {})).baselineTurnId).toBe(second.id);
    // Visits change navigation only, and hidden cards remain globally reachable.
    pdf.addPage([500, 700]).drawText("A separate book.");
    const foreign = await ok<{ id: string }>("books", await pdf.save()); await core.library.waitForBook(foreign.id);
    const other = (await execute([{ type: "create-question", title: "Other book question", placement: placement("other-q") }], foreign.id)).noteChanges[0].after;
    const beforeRejectedTurn = core.library.chat.turns(book.id).length;
    for (const [questionId, invalidSession] of [[other.id, sessionId], [question.id, other.question!.sessionId!]]) {
      expect((await request(`${path}/turns`, { reading: { bookId: book.id, page: 1, scope: "auto" }, question: "Must reject",
        questionId, sessionId: invalidSession, model: "fixture-a", effort: "medium" })).status).toBe(400);
    }
    expect(core.library.chat.turns(book.id)).toHaveLength(beforeRejectedTurn);
    await execute([{ type: "workspace", changes: [{ type: "upsert-card", card: { ...(await workspace()).cards.find((card) => card.id === "q")!, placed: false } }] }]);
    expect((await request(`books/${foreign.id}/questions/${question.id}/visit`, {})).status).toBe(400);
    await ok(`books/${foreign.id}/questions/${other.id}/visit`, {});
    await new Promise((done) => setTimeout(done, 5));
    await ok(`${path}/questions/${question.id}/visit`, {});
    let directoryItems = await ok<QuestionSummary[]>("questions");
    expect(directoryItems[0]).toMatchObject({ id: question.id, status: "concluded", placed: false, cardId: "q", conclusionTitle: conclusion.title });
    expect(directoryItems.some((item) => item.id === other.id && item.bookId === foreign.id)).toBe(true);
    const archive = new Uint8Array(await (await request(`${path}/workspace/archive`)).arrayBuffer());
    const restored = await ok<{ id: string }>("workspace-archives", archive);
    const restoredQuestion = (await ok<Note[]>(`books/${restored.id}/notes`)).find((note) => note.title === question.title)!;
    expect((await request(`books/${restored.id}/questions/${restoredQuestion.id}/material-plan`, {})).status).toBe(400);
    await execute([{ type: "open-question", noteId: restoredQuestion.id, expectedRevision: restoredQuestion.revision }], restored.id);
    expect((await ok<MaterialReviewPlan>(`books/${restored.id}/questions/${restoredQuestion.id}/material-plan`, {})).baseline).toEqual([]);
    await core.close(); core = createCore(directory, "dist/web", config); await connect();
    directoryItems = await ok<QuestionSummary[]>("questions");
    expect(directoryItems[0].id).toBe(question.id);
    expect(directoryItems[0].lastOpenedAt).toBeTruthy();
    await execute([{ type: "delete-note", noteId: child.id, expectedRevision: child.revision }]);
    expect((await ok<QuestionSummary[]>("questions")).some((item) => item.id === child.id)).toBe(false);
    await execute([{ type: "delete-note", noteId: other.id, expectedRevision: other.revision }], foreign.id);
    expect((await ok<QuestionSummary[]>("questions")).some((item) => item.bookId === foreign.id)).toBe(false);
    expect((await notes()).find((note) => note.id === question.id)).toEqual(question);
    await execute([{ type: "delete-note", noteId: conclusion.id, expectedRevision: conclusion.revision }]);
    expect((await ok<QuestionSummary[]>("questions")).find((item) => item.id === question.id))
      .toMatchObject({ currentConclusionId: conclusion.id });
    expect((await ok<QuestionSummary[]>("questions")).find((item) => item.id === question.id)?.conclusionTitle).toBeUndefined();
  } finally { await core.close(); await rm(directory, { recursive: true, force: true }); }
}, 40000);
