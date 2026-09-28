import { expect, test } from "vitest";
import { buildMaterialCatalog, selectMaterialCatalog } from "../apps/web/src/features/materials/catalog-model";
import type { BookWorkspace } from "../packages/protocol/src/workspace";
import type { Note } from "../packages/protocol/src/notes";

const fingerprint = "a".repeat(64);
const catalog: Pick<BookWorkspace, "cards" | "objects" | "links"> = {
  cards: [
    { id: "personal", kind: "note", noteId: "note-1", title: "", text: "", comment: "",
      x: 1800, y: 90, width: 300, height: 200 },
    { id: "excerpt", kind: "excerpt", title: "书中摘录", text: "原文提到缓存", comment: "",
      source: { fingerprint, anchors: [{ page: 4, rects: [[1, 1, 20, 20]] }] },
      x: 1800, y: 200, width: 300, height: 200 },
  ],
  objects: [
    { id: "same-page-shape", kind: "shape", shape: "ellipse",
      surface: { kind: "pdf", fingerprint, page: 4 }, x: 30, y: 250,
      width: 60, height: 50, color: "#345d84", strokeWidth: 2 },
    { id: "later-shape", kind: "shape", shape: "rectangle",
      surface: { kind: "pdf", fingerprint, page: 9 }, x: 30, y: 40,
      width: 60, height: 50, color: "#345d84", strokeWidth: 2 },
    { id: "early-ink", kind: "ink", brush: "pen", color: "#345d84", width: 2, opacity: 1,
      segments: [{ surface: { kind: "pdf", fingerprint, page: 2 }, points: [[15, 20], [50, 60]] }] },
    { id: "board-text", kind: "text", surface: { kind: "board" }, x: 90, y: 20,
      width: 200, height: 40, text: "画布想法", fontSize: 16, color: "#345d84",
      bold: false, align: "left" },
  ],
  links: [{ id: "relation", from: "excerpt", to: "later-shape", label: "支持关系", directed: false }],
};
const notes: Note[] = [{ id: "note-1", bookId: "book-1", title: "缓存假设",
  sourceReferences: [],
  document: { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "待验证的个人解释" }] }] },
  createdAt: "2026-09-25T00:00:00Z", updatedAt: "2026-09-25T00:00:00Z", revision: 1 }];

test("canvas materials share deterministic position and type ordering without changing source records", () => {
  const entries = buildMaterialCatalog(catalog, notes);
  expect(selectMaterialCatalog(entries, { query: "", category: "all", sort: "page" }).map((item) => item.id))
    .toEqual(["early-ink", "excerpt", "same-page-shape", "later-shape", "personal", "board-text", "relation"]);
  expect(selectMaterialCatalog(entries, { query: "", category: "all", sort: "type" }).map((item) => item.id))
    .toEqual(["excerpt", "personal", "early-ink", "same-page-shape", "later-shape", "board-text", "relation"]);
  expect(catalog.cards[0].title).toBe("");
});

test("moving a sourced card does not change page ordering or use PDF-native y as a visual coordinate", () => {
  const before = selectMaterialCatalog(buildMaterialCatalog(catalog, notes),
    { query: "", category: "all", sort: "page" }).map((item) => item.id);
  const moved = { ...catalog, cards: catalog.cards.map((card) => card.id === "excerpt"
    ? { ...card, y: 100000 } : card),
    objects: catalog.objects.map((object) => object.id === "same-page-shape" && object.kind === "shape"
      ? { ...object, y: 1 } : object) };
  expect(selectMaterialCatalog(buildMaterialCatalog(moved, notes),
    { query: "", category: "all", sort: "page" }).map((item) => item.id)).toEqual(before);
});

test("canvas type filter and search include note draft text but do not include unrelated entries", () => {
  const entries = buildMaterialCatalog(catalog, notes);
  expect(selectMaterialCatalog(entries, { query: "个人解释", category: "note", sort: "page" }).map((item) => item.id))
    .toEqual(["personal"]);
  expect(selectMaterialCatalog(entries, { query: "缓存", category: "drawing", sort: "page" })).toEqual([]);
  expect(selectMaterialCatalog(entries, { query: "支持", category: "drawing", sort: "page" }).map((item) => item.id))
    .toEqual(["relation"]);
});

test("unplaced excerpts remain findable while theme filtering only includes placed members", () => {
  const hidden = { ...catalog, cards: catalog.cards.map((card) => card.id === "excerpt"
    ? { ...card, placed: false } : card), groups: [{ id: "topic", title: "Topic", color: "#345d84",
      x: 0, y: 0, width: 400, height: 300, collapsed: false, memberIds: ["personal"] }] };
  const entries = buildMaterialCatalog(hidden, notes);
  expect(entries.find((entry) => entry.id === "excerpt")).toMatchObject({ category: "excerpt", placed: false });
  expect(selectMaterialCatalog(entries, { query: "原文提到缓存", category: "excerpt", sort: "page" })
    .map((entry) => entry.id)).toEqual(["excerpt"]);
  expect(selectMaterialCatalog(entries, { query: "", category: "all", sort: "page", groupId: "topic" })
    .map((entry) => entry.id)).toEqual(["personal"]);
});
