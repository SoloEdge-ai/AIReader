import { test, expect } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { PDFDocument } from "pdf-lib";
import { PNG } from "pngjs";
import { unzipSync, strFromU8 } from "fflate";
import { createCore } from "../apps/core/src/server";
import type { ChatTurn, QuestionMaterialSnapshot } from "../packages/protocol/src";

test("selected canvas materials are frozen, book/session scoped and actually sent with visible pixels", async () => {
  const directory = await mkdtemp(join(tmpdir(), "aireader-question-materials-"));
  const core = createCore(directory, "dist/web", {
    path: process.execPath, version: "fixture", args: [resolve("tests/fixtures/fake-codex.mjs")],
  });
  try {
    await new Promise<void>((done) => core.server.listen(0, "127.0.0.1", done));
    const origin = `http://127.0.0.1:${(core.server.address() as { port: number }).port}`;
    const cookie = (await fetch(origin + "/api/session", { method: "POST", headers: { Origin: origin } }))
      .headers.get("set-cookie")!.split(";")[0];
    const request = (path: string, value?: unknown, method = value === undefined ? "GET" : "POST") =>
      fetch(`${origin}/api/${path}`, { method, headers: { Origin: origin, Cookie: cookie },
        body: value instanceof Uint8Array ? Buffer.from(value) :
          value === undefined ? undefined : JSON.stringify(value) });
    const pdf = await PDFDocument.create();
    pdf.addPage([400, 320]).drawText("Source book text", { x: 20, y: 260 });
    pdf.addPage([400, 320]).drawText("Distinct second page evidence about batching", { x: 20, y: 260 });
    const book = await (await request("books", await pdf.save())).json();
    await core.library.waitForBook(book.id);
    const session = await (await request(`books/${book.id}/sessions`, {})).json();
    const otherSession = await (await request(`books/${book.id}/sessions`, {})).json();
    const workspace = await (await request(`books/${book.id}/workspace`)).json();
    const card = { id: "personal-card", kind: "note", title: "个人笔记", text: "我认为这里要比较吞吐量",
      comment: "待验证的想法", x: 900, y: 80, width: 250, height: 170 };
    const shape = { id: "personal-shape", kind: "shape", shape: "arrow", surface: { kind: "pdf",
      fingerprint: book.fingerprint, page: 1 }, x: 30, y: 100, width: 120, height: 60,
      color: "#d35e45", strokeWidth: 2 };
    const relation = { id: "support-link", from: card.id, to: shape.id, label: "对照", directed: true };
    const hidden = { ...card, id: "hidden-card", title: "未选择的笔记", text: "PRIVATE_UNSELECTED_NOTE",
      comment: "", x: 900, y: 300 };
    const hiddenRelation = { id: "hidden-link", from: card.id, to: hidden.id, label: "未选关系", directed: false };
    const added = await request(`books/${book.id}/workspace/commands`, {
      bookId: book.id, commandId: "make-material-objects", expectedVersion: workspace.revision,
      changes: [{ type: "upsert-card", card }, { type: "upsert-card", card: hidden },
        { type: "upsert-object", object: shape }, { type: "upsert-link", link: relation },
        { type: "upsert-link", link: hiddenRelation }],
    });
    expect(added.status).toBe(200);
    const png = new PNG({ width: 3, height: 2 });
    for (let i = 0; i < png.data.length; i += 4) png.data.set([30, 90, 180, 255], i);
    const image = "data:image/png;base64," + PNG.sync.write(png).toString("base64");
    const input = { bookId: book.id, sessionId: session.id, requestId: "snapshot-one",
      workspaceRevision: (await added.json()).revision,
      targets: [{ kind: "card", id: card.id }, { kind: "object", id: shape.id }],
      previews: [{ objectIds: [shape.id], surface: "pdf", page: 1,
        includesPdfBackground: true, image }],
    };
    const response = await request(`books/${book.id}/question-materials`, input);
    expect(response.status).toBe(201);
    const material: QuestionMaterialSnapshot = await response.json();
    const otherPdf = await PDFDocument.create();
    otherPdf.addPage([401, 321]).drawText("Other book source", { x: 20, y: 260 });
    const otherBook = await (await request("books", await otherPdf.save())).json();
    await core.library.waitForBook(otherBook.id);
    const otherBookSession = await (await request(`books/${otherBook.id}/sessions`, {})).json();
    expect((await request(`books/${otherBook.id}/question-materials/${material.id}?session=${otherBookSession.id}`)).status)
      .toBe(400);
    expect((await request(`books/${otherBook.id}/turns`, { reading: { bookId: otherBook.id, page: 1 },
      sessionId: otherBookSession.id, question: "CHECK_MATERIAL", model: "fixture-a", effort: "medium",
      materialIds: [material.id] })).status).toBe(400);
    expect(material).toMatchObject({ bookId: book.id, sessionId: session.id,
      itemCount: 3, images: [{ width: 3, height: 2, userRendered: true }] });
    expect(material.sections.map((section) => section.kind)).toEqual([
      "user-note", "user-note", "user-mark", "relation",
    ]);
    expect(material.sections[0].text).toBe(card.text);
    expect(material.sections[2].imageIds).toEqual([material.images[0].id]);
    expect((await request(`books/${book.id}/question-materials`, { ...input,
      requestId: "preview-forgery", previews: [{ ...input.previews[0], objectIds: ["not-selected"] }] })).status)
      .toBe(400);
    expect((await request(`books/${book.id}/question-materials`, { ...input,
      requestId: "missing-preview", previews: [] })).status).toBe(400);
    const cardOnly = await request(`books/${book.id}/question-materials`, { ...input,
      requestId: "card-only", targets: [input.targets[0]], previews: [] });
    expect(cardOnly.status).toBe(201);
    expect((await cardOnly.json()).sections.some((section: { kind: string }) => section.kind === "relation"))
      .toBe(false);
    const createdNote = await (await request(`books/${book.id}/notes`, {})).json();
    const noteDocument = (value: string) => ({ type: "doc", content: [{ type: "paragraph",
      content: [{ type: "text", text: value }] }] });
    const note = await (await request(`books/${book.id}/notes/${createdNote.id}`, {
      revision: createdNote.revision, title: "独立笔记", document: noteDocument("冻结前想法"),
    })).json();
    const noteMaterialResponse = await request(`books/${book.id}/question-materials`, {
      ...input, requestId: "note-snapshot", targets: [{ kind: "note", id: note.id,
        revision: note.revision }], previews: [],
    });
    expect(noteMaterialResponse.status).toBe(201);
    const noteMaterial = await noteMaterialResponse.json();
    await request(`books/${book.id}/notes/${note.id}`, { revision: note.revision,
      title: "独立笔记", document: noteDocument("冻结后想法") });
    expect((await (await request(`books/${book.id}/question-materials/${noteMaterial.id}?session=${session.id}`))
      .json()).sections[0].text).toContain("冻结前想法");
    const repeated = await request(`books/${book.id}/question-materials`, input);
    expect((await repeated.json()).id).toBe(material.id);
    expect((await request(`books/${book.id}/question-materials`, { ...input, targets: [input.targets[0]] })).status)
      .toBe(400);
    expect((await request(`books/${book.id}/question-materials/${material.id}?session=${otherSession.id}`)).status)
      .toBe(400);
    const resource = await request(`books/${book.id}/question-materials/${material.id}/images/${material.images[0].id}?session=${session.id}`);
    expect(resource.status).toBe(200);
    expect([...PNG.sync.read(Buffer.from(await resource.arrayBuffer())).data.subarray(0, 4)])
      .toEqual([30, 90, 180, 255]);
    const changed = await request(`books/${book.id}/workspace/commands`, {
      bookId: book.id, commandId: "change-originals", expectedVersion: input.workspaceRevision,
      changes: [{ type: "upsert-card", card: { ...card, text: "新版本想法" } },
        { type: "delete-object", id: shape.id }],
    });
    expect(changed.status).toBe(200);
    const frozen = await (await request(`books/${book.id}/question-materials/${material.id}?session=${session.id}`)).json();
    expect(frozen.sections[0].text).toBe(card.text);
    expect(frozen.sections.find((section: { kind: string }) => section.kind === "relation")).toBeDefined();
    expect((await request(`books/${book.id}/turns`, { reading: { bookId: book.id, page: 1 },
      sessionId: otherSession.id, question: "CHECK_MATERIAL", model: "fixture-a", effort: "medium",
      materialIds: [material.id] })).status).toBe(400);
    expect((await request(`books/${book.id}/turns`, { reading: { bookId: book.id, page: 1 },
      sessionId: session.id, question: "CHECK_MATERIAL", model: "fixture-a", effort: "medium",
      images: Array.from({ length: 4 }, (_, index) => ({ name: `extra-${index}.png`, dataUrl: image })),
      materialIds: [material.id] })).status).toBe(400);
    const turnResponse = await request(`books/${book.id}/turns`, { reading: { bookId: book.id, page: 1 },
      sessionId: session.id, question: "CHECK_MATERIAL", model: "fixture-a", effort: "medium",
      materialIds: [material.id] });
    expect(turnResponse.status).toBe(202);
    const turn: ChatTurn = await turnResponse.json();
    const turns = async (): Promise<ChatTurn[]> => (await request(`books/${book.id}/turns`)).json();
    await expect.poll(async () => (await turns())[0].status, { timeout: 10000 }).toBe("complete");
    const completed = (await turns())[0];
    expect(completed.context.materials?.[0].id).toBe(material.id);
    expect(completed.context.materials?.[0].sections[0].text).toBe(card.text);
    expect(completed.citations).toEqual([]);
    const observation = JSON.parse(completed.answer.slice("Materials received: ".length));
    expect(observation.pictures).toEqual(["3x2:30,90,180,255"]);
    expect(observation.materialPrompt).toContain(card.text);
    expect(observation.materialPrompt).toContain("用户材料");
    expect(observation.materialPrompt).not.toContain(hidden.text);
    expect(observation.materialPrompt).not.toContain(hiddenRelation.label);
    const saved = await request(`books/${book.id}/turns/${turn.id}/note`, {});
    expect(saved.status).toBe(201);
    const savedNote = (await saved.json()).note;
    expect(savedNote.origin.materials[0].sections[0].text).toBe(card.text);
    expect(savedNote.origin.materials[0].images).toHaveLength(1);
    expect(savedNote.origin.materials[0].images[0].includesPdfBackground).toBe(true);
    const noteExport = await request(`books/${book.id}/notes/${savedNote.id}/export`);
    expect(noteExport.status).toBe(200);
    const noteFiles = unzipSync(new Uint8Array(await noteExport.arrayBuffer()));
    expect(strFromU8(noteFiles["note.md"])).toContain("本轮选定材料");
    expect(Object.keys(noteFiles)).toContain("assets/question-1.png");
    const archive = await request(`books/${book.id}/workspace/archive`);
    expect(archive.status).toBe(200);
    const restored = await request("workspace-archives", new Uint8Array(await archive.arrayBuffer()));
    expect(restored.status).toBe(201);
    const copy = await restored.json();
    const copyNotes = await (await request(`books/${copy.id}/notes`)).json();
    expect(copyNotes[0].origin.materials[0].sections[0].text).toBe(card.text);
    expect(copyNotes[0].origin.materials[0].images[0].includesPdfBackground).toBe(true);
    const copiedImage = copyNotes[0].origin.materials[0].images[0].id;
    expect((await request(`books/${copy.id}/chat-images/${copiedImage}`)).status).toBe(200);
    expect((await request(`books/${book.id}/turns`, { reading: { bookId: book.id, page: 1 },
      sessionId: session.id, question: "CHECK_MATERIAL", model: "fixture-a", effort: "medium",
      materialIds: [material.id] })).status).toBe(400);
    const next = await request(`books/${book.id}/turns`, { reading: { bookId: book.id, page: 1 },
      sessionId: session.id, question: "CHECK_MATERIAL", model: "fixture-a", effort: "medium" });
    expect(next.status).toBe(202);
    await expect.poll(async () => (await turns())[1].status, { timeout: 10000 }).toBe("complete");
    const secondObservation = JSON.parse((await turns())[1].answer.slice("Materials received: ".length));
    expect(secondObservation.pictures).toEqual([]);
    expect((await turns())[1].context.materials).toEqual([]);
    const latestWorkspace = await (await request(`books/${book.id}/workspace`)).json();
    const excerpt = { id: "distant-excerpt", kind: "excerpt", title: "第二页原文摘录",
      text: "Distinct second page evidence about batching", comment: "", x: 900, y: 500,
      width: 250, height: 170, source: { fingerprint: book.fingerprint,
        anchors: [{ page: 2, rects: [[15, 240, 370, 280]] }] } };
    const distantCreated = await request(`books/${book.id}/workspace/commands`, {
      bookId: book.id, commandId: "make-distant-excerpt", expectedVersion: latestWorkspace.revision,
      changes: [{ type: "upsert-card", card: excerpt }],
    });
    expect(distantCreated.status).toBe(200);
    const distantSnapshot = await request(`books/${book.id}/question-materials`, {
      ...input, requestId: "distant-source", workspaceRevision: (await distantCreated.json()).revision,
      targets: [{ kind: "card", id: excerpt.id }], previews: [],
    });
    expect(distantSnapshot.status).toBe(201);
    const distant = await distantSnapshot.json();
    const distantTurnResponse = await request(`books/${book.id}/turns`, { reading: { bookId: book.id,
      page: 1 }, sessionId: session.id, question: "解释这个", model: "fixture-a", effort: "medium",
      materialIds: [distant.id] });
    expect(distantTurnResponse.status).toBe(202);
    expect((await distantTurnResponse.json()).context.evidence.some((passage: { page: number }) =>
      passage.page === 2)).toBe(true);
    expect(turn.id).toBe(completed.id);
  } finally {
    core.close();
    await rm(directory, { recursive: true, force: true });
  }
}, 30000);
