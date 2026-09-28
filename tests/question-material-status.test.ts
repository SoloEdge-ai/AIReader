import { describe, expect, test } from "vitest";
import type { Annotation, Note, QuestionMaterialSnapshot } from "../packages/protocol/src";
import { WorkspaceSchema } from "../packages/protocol/src/workspace";
import { questionMaterialSourceStatus } from "../apps/web/src/features/chat/material-status";

const fingerprint = "a".repeat(64);
const anchor = { page: 3, rects: [[10, 20, 80, 40] as [number, number, number, number]] };
const excerpt = { id: "card1", kind: "excerpt" as const, title: "定义", text: "原文定义", comment: "",
  x: 100, y: 200, width: 320, height: 200, source: { fingerprint, anchors: [anchor] } };
const relation = { id: "link1", from: "card1", to: "card2", label: "对比", directed: true };
const catalog = () => WorkspaceSchema.parse({ bookId: "book1", revision: 2,
  cards: [excerpt], objects: [{ id: "text1", kind: "text", surface: { kind: "board" }, x: 5,
    y: 7, width: 200, height: 80, text: "自己的想法", fontSize: 15, color: "#222222",
    bold: false, align: "left" }], groups: [], links: [relation] });
const note = (): Note => ({ id: "note1", bookId: "book1", title: "我的理解", revision: 1,
  document: { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "旧观点" }] }] },
  sourceReferences: [], createdAt: "2026-01-01", updatedAt: "2026-01-01" });
const annotation = (): Annotation => ({ id: "mark1", bookId: "book1", fingerprint,
  kind: "highlight", color: "yellow", quote: "重要", anchors: [anchor], revision: 1,
  createdAt: "2026-01-01", updatedAt: "2026-01-01" });
const material = (targets: QuestionMaterialSnapshot["targets"],
  sections: QuestionMaterialSnapshot["sections"]): QuestionMaterialSnapshot => ({
  id: "material1", bookId: "book1", sessionId: "session1", createdAt: "2026-01-01",
  title: "选定材料", itemCount: targets.length, targets, sections, images: [],
});

describe("frozen AI material source status", () => {
  test("detects edited Note while retaining the frozen section", () => {
    const frozen = material([{ kind: "note", id: "note1", revision: 1 }],
      [{ kind: "user-note", targetId: "note1", title: "我的理解", text: "旧观点\n" }]);
    const original = structuredClone(frozen);
    const current = note();
    current.revision = 2;
    current.document = { type: "doc", content: [{ type: "paragraph", text: "新观点" }] };
    expect(questionMaterialSourceStatus(frozen, { bookId: "book1", notes: [current] }).kind).toBe("updated");
    expect(frozen).toEqual(original);
  });

  test("detects removed Annotation, without interpreting missing catalog data as deletion", () => {
    const frozen = material([{ kind: "annotation", id: "mark1", revision: 1 }],
      [{ kind: "user-mark", targetId: "mark1", title: "个人批注",
        text: "highlight；颜色：yellow；选中文字：重要", anchors: [anchor] }]);
    expect(questionMaterialSourceStatus(frozen, { bookId: "book1" }).kind).toBe("unavailable");
    expect(questionMaterialSourceStatus(frozen, { bookId: "book1", annotations: [] }).kind).toBe("removed");
    expect(questionMaterialSourceStatus(frozen, { bookId: "book1", annotations: [annotation()] }).kind).toBe("current");
    expect(questionMaterialSourceStatus(frozen, { bookId: "book1",
      annotations: [{ ...annotation(), revision: 2, quote: "改过的标记" }] }).kind).toBe("updated");
  });

  test("card movement leaves frozen text current, while edits and removal are reported", () => {
    const frozen = material([{ kind: "card", id: "card1" }],
      [{ kind: "book-excerpt", targetId: "card1", title: "定义", text: "原文定义", anchors: [anchor] }]);
    const current = catalog();
    expect(questionMaterialSourceStatus(frozen, { bookId: "book1", catalog: current }).kind).toBe("current");
    expect(questionMaterialSourceStatus(frozen, { bookId: "book1", catalog: {
      ...current, cards: current.cards.map((card) => ({ ...card, x: 900 })) } }).kind).toBe("current");
    expect(questionMaterialSourceStatus(frozen, { bookId: "book1", catalog: {
      ...current, cards: current.cards.map((card) => ({ ...card, text: "新定义" })) } }).kind).toBe("updated");
    expect(questionMaterialSourceStatus(frozen, { bookId: "book1", catalog: {
      ...current, cards: [] } }).kind).toBe("removed");
  });

  test("compares relation meaning and explicitly selected board text", () => {
    const frozen = material([{ kind: "relation", id: "link1" }, { kind: "object", id: "text1" }], [
      { kind: "relation", targetId: "link1", title: "对比", text: "关系 card1 → card2：对比" },
      { kind: "user-note", targetId: "text1", title: "画布文字", text: "自己的想法" },
    ]);
    const current = catalog();
    expect(questionMaterialSourceStatus(frozen, { bookId: "book1", catalog: current }).kind).toBe("current");
    expect(questionMaterialSourceStatus(frozen, { bookId: "book1", catalog: {
      ...current, links: [{ ...relation, directed: false }] } }).kind).toBe("updated");
    expect(questionMaterialSourceStatus(frozen, { bookId: "book1", catalog: {
      ...current, objects: current.objects.map((object) => object.kind === "text" ?
        { ...object, text: "修改后的想法" } : object) } }).kind).toBe("updated");
    expect(questionMaterialSourceStatus(frozen, { bookId: "book1", catalog: {
      ...current, links: current.links, objects: [] } }).kind).toBe("removed");
  });

  test("detects Note edits behind its card and refuses cross-book comparison", () => {
    const frozen = material([{ kind: "card", id: "noteCard", revision: 1 }],
      [{ kind: "user-note", targetId: "noteCard", title: "我的理解", text: "旧观点\n" }]);
    const current = catalog();
    const noteCard = { id: "noteCard", kind: "note" as const, noteId: "note1", title: "", text: "",
      comment: "", x: 50, y: 50, width: 320, height: 200 };
    const cardCatalog = { ...current, cards: [...current.cards, noteCard] };
    expect(questionMaterialSourceStatus(frozen, { bookId: "book1", catalog: cardCatalog,
      notes: [note()] }).kind).toBe("current");
    expect(questionMaterialSourceStatus(frozen, { bookId: "book1", catalog: cardCatalog,
      notes: [{ ...note(), revision: 2 }] }).kind).toBe("updated");
    expect(questionMaterialSourceStatus(frozen, { bookId: "other", catalog: cardCatalog,
      notes: [note()] }).kind).toBe("unavailable");
  });
});
