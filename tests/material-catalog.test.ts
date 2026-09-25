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
  document: { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "待验证的个人解释" }] }] },
  createdAt: "2026-09-25T00:00:00Z", updatedAt: "2026-09-25T00:00:00Z", revision: 1 }];

test("canvas materials share deterministic position and type ordering without changing source records", () => {
  const entries = buildMaterialCatalog(catalog, notes);
  expect(selectMaterialCatalog(entries, { query: "", category: "all", sort: "page" }).map((item) => item.id))
    .toEqual(["early-ink", "excerpt", "later-shape", "personal", "board-text", "relation"]);
  expect(selectMaterialCatalog(entries, { query: "", category: "all", sort: "type" }).map((item) => item.id))
    .toEqual(["excerpt", "personal", "early-ink", "board-text", "later-shape", "relation"]);
  expect(catalog.cards[0].title).toBe("");
});

test("canvas type filter and search include note draft text but do not include unrelated entries", () => {
  const entries = buildMaterialCatalog(catalog, notes);
  expect(selectMaterialCatalog(entries, { query: "个人解释", category: "card", sort: "page" }).map((item) => item.id))
    .toEqual(["personal"]);
  expect(selectMaterialCatalog(entries, { query: "缓存", category: "shape", sort: "page" })).toEqual([]);
  expect(selectMaterialCatalog(entries, { query: "支持", category: "link", sort: "page" }).map((item) => item.id))
    .toEqual(["relation"]);
});
