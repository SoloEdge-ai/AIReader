import { createHash } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { PDFDocument } from "pdf-lib";
import { PNG } from "pngjs";
import { expect, test } from "vitest";
import { createCore } from "../apps/core/src/server";
import { bookCommandPayload, type BookChange, type BookCommandReceipt } from "../packages/protocol/src/book-commands";
import type { ChatTurn, Note, QuestionMaterialSnapshot } from "../packages/protocol/src";
import type { BookWorkspace } from "../packages/protocol/src/workspace";

test("canvas inquiry freezes a strict scope, preserves provenance and atomically saves beside its sources", async () => {
  const directory = await mkdtemp(join(tmpdir(), "aireader-inquiry-"));
  const config = { path: process.execPath, version: "fixture", args: [resolve("tests/fixtures/fake-codex.mjs")] };
  let core = createCore(directory, "dist/web", config);
  let origin = "", cookie = "";
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
  const command = (bookId: string, commandId: string, expectedContentVersion: number, changes: BookChange[]) => {
    const payload = { bookId, expectedContentVersion, changes };
    return { ...payload, commandId, payloadHash: createHash("sha256").update(bookCommandPayload(payload)).digest("hex") };
  };
  try {
    await connect();
    const pdf = await PDFDocument.create();
    const page = pdf.addPage([600, 400]);
    page.drawText("SELECTED_EVIDENCE applies in ideal conditions.", { x: 20, y: 330, size: 12 });
    page.drawText("UNSELECTED_SECRET applies under resource limits.", { x: 20, y: 100, size: 12 });
    const book = await (await request("books", await pdf.save())).json();
    await core.library.waitForBook(book.id);
    const path = `books/${book.id}`;
    const commands = `v2/${path}/commands`;
    const session = await (await request(`${path}/sessions`, {})).json();
    const source = { id: "excerpt-a", kind: "excerpt" as const, title: "Selected", text: "SELECTED_EVIDENCE applies in ideal conditions.",
      comment: "", x: 400, y: 100, width: 250, height: 160, source: { fingerprint: book.fingerprint,
        anchors: [{ page: 1, rects: [[15, 320, 450, 350] as [number, number, number, number]] }] } };
    const idea = { id: "idea-b", kind: "note" as const, title: "Hypothesis", text: "MY_HYPOTHESIS", comment: "",
      x: 400, y: 300, width: 250, height: 160 };
    const link = { id: "comparison", from: source.id, to: idea.id, label: "对比", directed: false };
    const ws = await (await request(`${path}/workspace`)).json();
    expect((await request(commands, command(book.id, "seed", ws.revision, [{ type: "workspace", changes: [
      { type: "upsert-card", card: source }, { type: "upsert-card", card: idea }, { type: "upsert-link", link },
    ] }]))).status).toBe(200);
    const current = await (await request(`${path}/workspace`)).json();
    const freeze = (requestId: string, targets = [{ kind: "card", id: source.id }, { kind: "card", id: idea.id }]) =>
      request(`${path}/question-materials`, { bookId: book.id, sessionId: session.id, requestId,
        workspaceRevision: current.revision, targets, previews: [] });
    expect((await freeze("dangling-link", [{ kind: "relation", id: link.id }])).status).toBe(400);
    const material: QuestionMaterialSnapshot = await (await freeze("selected")).json();
    expect(material.sections[0].citation?.bookId).toBe(book.id);
    expect(material.sections.find((section) => section.kind === "relation")?.relation)
      .toMatchObject({ from: source.id, to: idea.id });
    core.library.chat.saveMemory(book.id, session.id, { goal: "OLD_GOAL_SECRET", text: "OLD_MEMORY_SECRET" });
    const empty = await request(`${path}/turns`, { reading: { bookId: book.id, page: 1, scope: "materials" },
      question: "CHECK_MATERIAL", sessionId: session.id, model: "fixture-a", effort: "medium" });
    expect(empty.status).toBe(400);
    const started = await request(`${path}/turns`, { reading: { bookId: book.id, page: 1, scope: "materials" },
      question: "CHECK_MATERIAL", sessionId: session.id, model: "fixture-a", effort: "medium", materialIds: [material.id],
      inquiry: { action: "compare", targetIds: [source.id, idea.id], bounds: { x: 400, y: 100, width: 250, height: 360 } } });
    expect(started.status).toBe(202);
    const turn: ChatTurn = await started.json();
    await expect.poll(async () => (await (await request(`${path}/turns`)).json())[0].status).toBe("complete");
    const completed: ChatTurn = (await (await request(`${path}/turns`)).json())[0];
    const observation = JSON.parse(completed.answer.slice("Materials received: ".length));
    expect(observation.materialPrompt).toContain("SELECTED_EVIDENCE");
    expect(observation.materialPrompt).not.toContain("UNSELECTED_SECRET");
    expect(observation.materialPrompt).not.toContain("OLD_MEMORY_SECRET");
    expect(Buffer.from(observation.promptBase64, "base64").toString("utf8")).not.toMatch(/UNSELECTED_SECRET|OLD_MEMORY_SECRET|OLD_GOAL_SECRET/);
    expect(observation.thread.ephemeral).toBe(true);
    expect(observation.thread.config["mcp_servers.untrusted.enabled"]).toBe(false);
    const toolResponse = await request(`${path}/tools/run`, { turnId: turn.id, script: "Get-Content evidence.txt" });
    expect(toolResponse.status).toBe(400);
    expect(await toolResponse.text()).toContain("仅所选材料");
    expect(completed.context.evidence.map((item) => item.text)).toEqual([source.text]);
    expect(completed.context.memory + completed.context.navigation + completed.context.recent).toBe("");
    expect(completed.inquiry?.targetIds).toEqual([source.id, idea.id]);
    const removable: QuestionMaterialSnapshot = await (await freeze("removable")).json();
    const filteredResponse = await request(`${path}/turns`, { reading: { bookId: book.id, page: 1, scope: "materials" },
      question: "CHECK_MATERIAL", sessionId: session.id, model: "fixture-a", effort: "medium",
      materialIds: [removable.id], materialExclusions: [{ materialId: removable.id, targetIds: [idea.id] }] });
    expect(filteredResponse.status).toBe(202);
    const filteredStart: ChatTurn = await filteredResponse.json();
    await expect.poll(async () => (await (await request(`${path}/turns`)).json())
      .find((item: ChatTurn) => item.id === filteredStart.id).status).toBe("complete");
    const filteredTurn: ChatTurn = (await (await request(`${path}/turns`)).json())
      .find((item: ChatTurn) => item.id === filteredStart.id);
    expect(filteredTurn.context.materials?.[0].sections).toHaveLength(1);
    expect(Buffer.from(JSON.parse(filteredTurn.answer.slice("Materials received: ".length)).promptBase64, "base64")
      .toString("utf8")).not.toContain("MY_HYPOTHESIS");
    const stillFrozen = await (await request(`${path}/question-materials/${removable.id}?session=${session.id}`)).json();
    expect(stillFrozen.sections[1].text).toBe("MY_HYPOTHESIS");
    const save = command(book.id, "save-answer", current.revision, [{ type: "save-answer", turnId: turn.id,
      placement: { id: "answer-card", x: 700, y: 100, width: 320, height: 160 } }]);
    // A late invalid change must roll back Note and placement together.
    const invalid = { ...save, commandId: "collision", changes: [{ ...save.changes[0], placement: {
      id: source.id, x: 700, y: 100, width: 320, height: 160,
    } }] as BookChange[] };
    invalid.payloadHash = createHash("sha256").update(bookCommandPayload(invalid)).digest("hex");
    expect((await request(commands, invalid)).status).toBe(400);
    expect(await (await request(`${path}/notes`)).json()).toEqual([]);
    const saved = await request(commands, save);
    expect(saved.status).toBe(200);
    const receipt: BookCommandReceipt = await saved.json();
    const note = receipt.noteChanges[0].after;
    expect(note.origin?.scope).toBe("materials");
    expect(note.origin?.materials?.[0].sections[0].targetId).toBe(source.id);
    expect(await (await request(commands, save)).json()).toEqual(receipt);
    let board: BookWorkspace = await (await request(`${path}/workspace`)).json();
    expect(board.cards.filter((card) => card.noteId === note.id)).toHaveLength(1);
    expect(board.cards.find((card) => card.noteId === note.id)!.x).toBeGreaterThan(source.x + source.width);
    expect(board.links).toEqual([link]); // Usage is not a semantic assertion.
    const revision = board.revision;
    const undo = await request(commands, command(book.id, "undo-save", revision,
      [{ type: "undo", targetCommandId: save.commandId }]));
    expect(undo.status, await undo.text()).toBe(200);
    expect((await (await request(`${path}/notes`)).json()).some((item: Note) => item.id === note.id)).toBe(false);
    board = await (await request(`${path}/workspace`)).json();
    expect((await request(commands, command(book.id, "redo-save", board.revision,
      [{ type: "undo", targetCommandId: "undo-save" }]))).status).toBe(200);
    const latest: BookWorkspace = await (await request(`${path}/workspace`)).json();
    const aiMaterialResponse = await request(`${path}/question-materials`, { bookId: book.id, sessionId: session.id,
      requestId: "ai-note", workspaceRevision: latest.revision,
      targets: [{ kind: "note", id: note.id, revision: (await (await request(`${path}/notes`)).json())[0].revision }], previews: [] });
    expect(aiMaterialResponse.status).toBe(201);
    expect((await aiMaterialResponse.json()).sections[0].provenance).toMatchObject({ kind: "ai", turnId: turn.id });
    const archive = new Uint8Array(await (await request(`${path}/workspace/archive`)).arrayBuffer());
    const copyResponse = await request("workspace-archives", archive);
    expect(copyResponse.status).toBe(201);
    const copy = await copyResponse.json();
    const copyNote: Note = (await (await request(`books/${copy.id}/notes`)).json())[0];
    const copyBoard: BookWorkspace = await (await request(`books/${copy.id}/workspace`)).json();
    expect(copyNote.origin?.materials?.[0].sections[0].targetId).not.toBe(source.id);
    expect(copyBoard.cards.some((card) => card.id === copyNote.origin?.materials?.[0].sections[0].targetId)).toBe(true);
    expect(copyNote.origin?.materials?.[0].sections[0].citation?.bookId).toBe(copy.id);
    const copySession = await (await request(`books/${copy.id}/sessions`, {})).json();
    const restoredMaterial = await request(`books/${copy.id}/question-materials`, { bookId: copy.id,
      sessionId: copySession.id, requestId: "restored-ai", workspaceRevision: copyBoard.revision,
      targets: [{ kind: "note", id: copyNote.id, revision: copyNote.revision }], previews: [] });
    expect(restoredMaterial.status).toBe(201);
    expect((await restoredMaterial.json()).sections[0].provenance).toMatchObject({ kind: "ai", edited: true });
    const shapes = ["drawing-a", "drawing-b"].map((id) => ({ id, kind: "shape" as const, shape: "rectangle" as const,
      surface: { kind: "board" as const }, x: 10, y: 10, width: 50, height: 50, color: "#345d84", strokeWidth: 2 }));
    const shapeReceipt: BookCommandReceipt = await (await request(commands, command(book.id, "drawings", latest.revision,
      [{ type: "workspace", changes: shapes.map((object) => ({ type: "upsert-object", object })) }]))).json();
    const png = new PNG({ width: 2, height: 2 });
    png.data.fill(255);
    const shared: QuestionMaterialSnapshot = await (await request(`${path}/question-materials`, { bookId: book.id,
      sessionId: session.id, requestId: "shared-image", workspaceRevision: shapeReceipt.contentVersion,
      targets: shapes.map((shape) => ({ kind: "object", id: shape.id })), previews: [{ objectIds: shapes.map((shape) => shape.id),
        surface: "board", includesPdfBackground: false, image: `data:image/png;base64,${PNG.sync.write(png).toString("base64")}` }] })).json();
    const sharedResponse = await request(`${path}/turns`, { reading: { bookId: book.id, page: 1, scope: "materials" },
      question: "CHECK_MATERIAL", sessionId: session.id, model: "fixture-a", effort: "medium", materialIds: [shared.id],
      materialExclusions: [{ materialId: shared.id, targetIds: [shapes[0].id] }] });
    expect(sharedResponse.status).toBe(400);
    expect(await sharedResponse.text()).toContain("共享图像");
    const manyCards = Array.from({ length: 20 }, (_, index) => ({ ...source, id: `many-${index}`,
      title: `Excerpt ${index}`, comment: "Personal observation", y: 1000 + index * 180 }));
    const beforeMany: BookWorkspace = await (await request(`${path}/workspace`)).json();
    const manyReceipt: BookCommandReceipt = await (await request(commands, command(book.id, "many-excerpts", beforeMany.revision,
      [{ type: "workspace", changes: manyCards.map((card) => ({ type: "upsert-card", card })) }]))).json();
    const manyMaterial: QuestionMaterialSnapshot = await (await request(`${path}/question-materials`, { bookId: book.id,
      sessionId: session.id, requestId: "many-sections", workspaceRevision: manyReceipt.contentVersion,
      targets: manyCards.map((card) => ({ kind: "card", id: card.id })), previews: [] })).json();
    expect(manyMaterial.sections).toHaveLength(40);
    const manyStarted = await request(`${path}/turns`, { reading: { bookId: book.id, page: 1, scope: "materials" },
      question: "NOTES_NO_SOURCE", sessionId: session.id, model: "fixture-a", effort: "medium", materialIds: [manyMaterial.id] });
    expect(manyStarted.status).toBe(202);
    const manyTurn: ChatTurn = await manyStarted.json();
    await expect.poll(async () => (await (await request(`${path}/turns`)).json())
      .find((item: ChatTurn) => item.id === manyTurn.id).status).toBe("complete");
    expect((await request(`${path}/turns/${manyTurn.id}/note`, {})).status).toBe(201);
    const manyArchive = new Uint8Array(await (await request(`${path}/workspace/archive`)).arrayBuffer());
    const manyCopyResponse = await request("workspace-archives", manyArchive);
    expect(manyCopyResponse.status, await manyCopyResponse.clone().text()).toBe(201);
    const manyCopy = await manyCopyResponse.json();
    const manyCopyNotes: Note[] = await (await request(`books/${manyCopy.id}/notes`)).json();
    expect(manyCopyNotes.some((note) => note.origin?.materials?.[0].sections.length === 40)).toBe(true);
    await core.close();
    core = createCore(directory, "dist/web", config);
    await connect();
    expect(await (await request(commands, save)).json()).toEqual(receipt);
  } finally {
    await core.close();
    await rm(directory, { recursive: true, force: true });
  }
}, 30000);
