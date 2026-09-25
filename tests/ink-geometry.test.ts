import { test, expect } from "vitest";
import { hitStroke, projectStroke, simplifyInk, splitStroke, type InkPage } from "../packages/workspace-engine/src/ink";

const pages: InkPage[] = [1, 2].map((page) => {
  const y = page === 1 ? 40 : 164;
  return { page, x: 100, y, width: 100, height: 100,
    toPdf: ([x, at]: [number, number]) => [x - 100, at - y],
    toWorld: ([x, at]: [number, number]) => [x + 100, at + y],
  };
});
const fingerprint = "a".repeat(64);

test("a fast stroke is one logical object with ordered board, page and gap pieces", () => {
  const segments = splitStroke([[150, 20], [150, 284]], pages, fingerprint);
  expect(segments.map((segment) => segment.surface.kind === "pdf" ? segment.surface.page : "board"))
    .toEqual(["board", 1, "board", 2, "board"]);
  const projected = projectStroke({ id: "one", kind: "ink", brush: "pen", color: "#345d84",
    width: 2, opacity: 1, segments }, pages);
  expect(projected.paths[1].points[0]).toEqual([150, 40]);
  expect(projected.paths[3].points.at(-1)).toEqual([150, 264]);
  expect(hitStroke(projected, [150, 190], 8)).toBe(true);
  expect(hitStroke(projected, [190, 190], 8)).toBe(false);
});

test("a single sample jump across a whole page retains both crossings", () => {
  const segments = splitStroke([[50, 90], [250, 90]], pages, fingerprint);
  expect(segments.map((segment) => segment.surface.kind)).toEqual(["board", "pdf", "board"]);
  expect(segments[1].points).toEqual([[0, 50], [100, 50]]);
});

test("native PDF transform and fixed-unit simplification preserve a corner", () => {
  const rotated: InkPage = { page: 1, x: 100, y: 40, width: 100, height: 100,
    toPdf: ([x, y]) => [y - 40, 200 - x],
    toWorld: ([x, y]) => [200 - y, x + 40],
  };
  const segments = splitStroke([[120, 60], [150, 60], [150, 100]], [rotated], fingerprint);
  const stroke = { id: "rotated", kind: "ink" as const, brush: "highlighter" as const,
    color: "#e6b72d", width: 12, opacity: .3, segments };
  expect(projectStroke(stroke, [rotated]).paths[0].points.at(-1)).toEqual([150, 100]);
  expect(simplifyInk([[0, 0], [1, .1], [2, 0], [2, 2]], .35)).toEqual([[0, 0], [2, 0], [2, 2]]);
});
