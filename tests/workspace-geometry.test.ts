import { describe, expect, test } from "vitest";
import { lassoHitsPath, lassoHitsRect, newShape, objectRect, resizeObject,
  shapeEndpoints, translateObject } from "../packages/workspace-engine/src/objects";
import type { WorkspacePage } from "../packages/workspace-engine/src/surfaces";

const fingerprint = "a".repeat(64);
const page: WorkspacePage = {
  page: 1, x: 120, y: 40, width: 300, height: 200,
  locate: () => ({ x: 120, y: 40 }),
  // A 90-degree viewport with a negative PDF-native origin.
  toPdf: ([x, y]) => [y - 140, 420 - x],
  toWorld: ([x, y]) => [420 - y, x + 140],
};

describe("workspace object geometry", () => {
  test("shape creation stays on its source page and survives rotation projection", () => {
    const shape = newShape("test-arrow", "arrow", [160, 70], [600, 130], [page], fingerprint);
    expect(shape.surface).toEqual({ kind: "pdf", fingerprint, page: 1 });
    const rect = objectRect(shape, [page])!;
    expect(rect.x).toBeCloseTo(160);
    expect(rect.y).toBeCloseTo(70);
    expect(rect.x + rect.width).toBeCloseTo(420);
    const [a, b] = shapeEndpoints(shape, [page]);
    expect(a).toEqual([160, 70]);
    expect(b).toEqual([420, 130]);
  });
  test("moving and resizing PDF objects use native coordinates, board objects remain nonnegative", () => {
    const original = newShape("test-rectangle", "rectangle", [160, 70], [260, 130], [page], fingerprint);
    const moved = translateObject(original, 20, 15, [page], fingerprint);
    expect(objectRect(moved as typeof original, [page])).toMatchObject({ x: 180, y: 85 });
    const resized = resizeObject(original, 25, 35, [page]);
    const rect = objectRect(resized as typeof original, [page])!;
    expect(rect.width).toBeCloseTo(125);
    expect(rect.height).toBeCloseTo(95);
    const board = { ...original, surface: { kind: "board" as const }, x: 2, y: 3 };
    expect(translateObject(board, -20, -10, [page], fingerprint)).toMatchObject({ x: 0, y: 0 });
  });
  test("lasso intersects paths or actual rectangles, not disjoint collinear extensions", () => {
    const polygon: [number, number][] = [[0, 0], [40, 0], [40, 40], [0, 40]];
    expect(lassoHitsPath(polygon, [[-10, 20], [50, 20]])).toBe(true);
    expect(lassoHitsPath(polygon, [[50, 0], [80, 0]])).toBe(false);
    expect(lassoHitsRect(polygon, { x: 30, y: 30, width: 20, height: 20 })).toBe(true);
    expect(lassoHitsRect(polygon, { x: 80, y: 80, width: 20, height: 20 })).toBe(false);
  });
});
