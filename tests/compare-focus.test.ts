import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, test } from "vitest";
import type { PdfAnchor } from "../packages/protocol/src/anchors";
import type { WorkspaceCard } from "../packages/protocol/src/workspace";
import { CompareView, comparisonAnchors, comparisonItems } from "../apps/web/src/features/compare-focus/CompareView";

const fingerprint = "a".repeat(64);
const source = (page: number, rect: [number, number, number, number]): PdfAnchor => ({ page, rects: [rect] });

describe("temporary excerpt comparison", () => {
  const common = { x: 0, y: 0, width: 320, height: 220, comment: "" };
  const excerpt: WorkspaceCard = { ...common, id: "excerpt-1", kind: "excerpt", title: "Definition",
    text: "Original sentence", source: { fingerprint, anchors: [source(4, [10, 20, 60, 40])] } };
  const region: WorkspaceCard = { ...common, id: "region-1", kind: "region", title: "Figure",
    text: "", region: { fingerprint, page: 5, rect: [10, 20, 100, 140], assetId: "figure-1", includePersonalMarks: true } };
  const note: WorkspaceCard = { ...common, id: "note-1", kind: "note", title: "", text: "", noteId: "note-1" };

  test("accepts only distinct source cards and projects region source without copying content", () => {
    expect(comparisonItems([note, excerpt, excerpt, region]).map((card) => card.id)).toEqual(["excerpt-1", "region-1"]);
    expect(comparisonAnchors(region as ReturnType<typeof comparisonItems>[number])).toEqual([source(5, [10, 20, 100, 140])]);
  });

  test("shows two original materials, source pages and associated notes", () => {
    const html = renderToStaticMarkup(createElement(CompareView, {
      cards: [excerpt, region], pageLabels: ["1", "2", "3", "iv", "v"],
      imageUrl: (id) => `/assets/${id}`,
      notesForCard: () => [{ id: "note-one", title: "Note one" }, { id: "note-two", title: "Note two" }],
      onOpenNote: () => {}, onSource: () => {}, onClose: () => {},
    }));
    expect(html).toContain("Original sentence");
    expect(html).toContain("/assets/figure-1");
    expect(html).toContain("第 iv 页");
    expect(html).toContain("第 v 页");
    expect(html).toContain("关联笔记 · 2");
    expect(html).toContain("Note one");
    expect(html).toContain("Note two");
    expect(html).toContain("图中包含个人标记");
  });
});
