import { describe, expect, test } from "vitest";
import { WorkspaceSchema } from "../packages/protocol/src/workspace";
import { arrangeGroup, assignCardGroup, groupSelection, moveGroup } from "../apps/web/src/features/workspace/groups";

const fingerprint = "a".repeat(64);
const excerpt = (id: string, page: number, x: number, y: number) => ({
  id, kind: "excerpt" as const, title: `摘录 ${page}`, text: "来源文字", comment: "",
  x, y, width: 320, height: 200,
  source: { fingerprint, anchors: [{ page, rects: [[10, 20, 80, 40] as [number, number, number, number]] }] },
});
const workspace = () => WorkspaceSchema.parse({ bookId: "book1", revision: 0,
  cards: [excerpt("late", 8, 300, 400), excerpt("early", 2, 700, 400),
    { id: "note1", kind: "note", noteId: "savednote", title: "", text: "", comment: "",
      x: 700, y: 700, width: 340, height: 250 }],
  objects: [
    { id: "boardInk", kind: "ink", brush: "pen", color: "#333333", width: 2, opacity: 1,
      segments: [{ surface: { kind: "board" }, points: [[320, 680], [400, 700]] }] },
    { id: "pdfShape", kind: "shape", shape: "rectangle", surface: { kind: "pdf", fingerprint, page: 2 },
      x: 20, y: 30, width: 80, height: 80, color: "#333333", strokeWidth: 2 },
  ], groups: [], links: [] });

describe("theme group canvas behavior", () => {
  test("groups only cards and board-only objects, then moves members as one snapshot", () => {
    const initial = workspace();
    const grouped = groupSelection(initial, ["late", "boardInk", "pdfShape"], "group1", "主题", "#5d83b0");
    expect(grouped.groups[0].memberIds).toEqual(["late", "boardInk"]);
    const moved = moveGroup(grouped, "group1", 60, 30);
    expect(moved.cards.find((card) => card.id === "late")?.x).toBe(360);
    const ink = moved.objects.find((object) => object.id === "boardInk");
    expect(ink?.kind).toBe("ink");
    if (ink?.kind !== "ink") throw new Error("expected board ink");
    expect(ink.segments[0].points[0]).toEqual([380, 710]);
    expect(moved.objects.find((object) => object.id === "pdfShape")).toEqual(initial.objects[1]);
    expect(moved.groups[0].x).toBe(grouped.groups[0].x + 60);
  });

  test("arranges excerpts by source page before notes and keeps one membership per card", () => {
    const grouped = groupSelection(workspace(), ["late", "early", "note1"], "group1", "主题", "#5d83b0");
    const arranged = arrangeGroup(grouped, "group1");
    const early = arranged.cards.find((card) => card.id === "early")!;
    const late = arranged.cards.find((card) => card.id === "late")!;
    const note = arranged.cards.find((card) => card.id === "note1")!;
    expect(early.x).toBeLessThan(late.x);
    expect(note.y).toBeGreaterThan(early.y);
    const outside = assignCardGroup(arranged, { ...early, x: 10, y: 10 });
    expect(outside.groups[0].memberIds).not.toContain("early");
    expect(outside.groups[0].memberIds).toContain("late");
  });
});
