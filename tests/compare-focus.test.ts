import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, test } from "vitest";
import type { PdfAnchor } from "../packages/protocol/src/anchors";
import type { WorkspaceCard } from "../packages/protocol/src/workspace";
import { CompareView, comparisonAnchors, comparisonItems } from "../apps/web/src/features/compare-focus/CompareView";
import { FocusReadingView } from "../apps/web/src/features/compare-focus/FocusReadingView";
import { projectNativeRegion } from "../apps/web/src/features/compare-focus/native-projection";
import { buildFocusPlan, focusSourceKey } from "../apps/web/src/features/compare-focus/focus-model";

const fingerprint = "a".repeat(64);
const box = (page: number, rect: [number, number, number, number] = [0, 0, 400, 600]) => ({ page, rect });
const source = (page: number, rect: [number, number, number, number]): PdfAnchor => ({ page, rects: [rect] });

describe("original PDF focus windows", () => {
  test("expands 72 PDF points and clips against a negative-origin CropBox", () => {
    const plan = buildFocusPlan([source(2, [-30, -70, 25, -40])], [box(2, [-50, -100, 450, 500])]);
    expect(plan.regions).toHaveLength(1);
    expect(plan.regions[0]).toMatchObject({ page: 2, pdfRect: [-50, -100, 450, 32], sourceKeys: ["0:0"] });
  });

  test("merges overlapping windows on one page, preserves page order and marks omitted content", () => {
    const anchors = [source(3, [10, 160, 20, 180]), source(1, [10, 300, 20, 320]),
      source(3, [50, 240, 70, 260]), source(3, [10, 520, 20, 530])];
    const plan = buildFocusPlan(anchors, [box(1), box(3)]);
    expect(plan.regions.map((region) => [region.page, region.pdfRect[1], region.pdfRect[3]])).toEqual([
      [1, 228, 392], [3, 448, 600], [3, 88, 332],
    ]);
    expect(plan.regions[2].sourceKeys).toEqual(["0:0", "2:0"]);
    expect(plan.entries.map((entry) => entry.kind)).toEqual([
      "region", "omission", "region", "omission", "region",
    ]);
    expect(plan.entries[1]).toMatchObject({ kind: "omission", omittedPages: 1, samePage: false });
    expect(plan.entries[3]).toMatchObject({ kind: "omission", omittedPages: 0, samePage: true });
  });

  test("loads twenty regions at a time; expansion can merge windows or show a complete page", () => {
    const anchors = Array.from({ length: 22 }, (_, index) => source(index + 1, [20, 270, 40, 280]));
    const pageBoxes = anchors.map((anchor) => box(anchor.page));
    const first = buildFocusPlan(anchors, pageBoxes);
    expect(first.regions).toHaveLength(20);
    expect(first.totalRegions).toBe(22);
    expect(first.hasMore).toBe(true);
    expect(buildFocusPlan(anchors, pageBoxes, { visibleLimit: 40 }).regions).toHaveLength(22);

    const samePage = [source(1, [10, 90, 20, 100]), source(1, [10, 300, 20, 310])];
    expect(buildFocusPlan(samePage, [box(1)]).regions).toHaveLength(2);
    const extraContext = new Map([[focusSourceKey(0, 0), 80]]);
    expect(buildFocusPlan(samePage, [box(1)], { extraContext }).regions).toHaveLength(1);
    const full = buildFocusPlan(samePage, [box(1)], { fullPages: new Set([1]) });
    expect(full.regions).toHaveLength(1);
    expect(full.regions[0]).toMatchObject({ pdfRect: [0, 0, 400, 600], fullPage: true });
  });

  test("renders crop controls and original-page region through the host callback", () => {
    const html = renderToStaticMarkup(createElement(FocusReadingView, {
      anchors: [source(1, [20, 200, 60, 220])], pageBoxes: [box(1)],
      pageLabels: ["xii"], renderPdfRegion: (region) => createElement("div", { "data-native-rect": region.pdfRect.join(",") }, "PDF canvas"),
      onGoToOriginal: () => {}, onClose: () => {},
    }));
    expect(html).toContain("第 xii 页");
    expect(html).toContain('data-native-rect="0,128,400,292"');
    expect(html).toContain("扩大上下文");
    expect(html).toContain("前往原文");
  });

  test("projects native crop through a rotated page viewport", () => {
    const rotated = { convertToViewportRectangle: ([left, bottom, right, top]: number[]) =>
      [500 - bottom, left + 100, 500 - top, right + 100] };
    expect(projectNativeRegion([200, 10, 300, 70], rotated))
      .toEqual({ left: 430, top: 300, width: 60, height: 100 });
  });
});

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
