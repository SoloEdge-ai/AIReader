import { test, expect } from "vitest";
import { zoomWorkspaceAtPointer } from "../packages/workspace-engine/src/viewport";
test("Ctrl-wheel zoom preserves the document point under the cursor in both directions", () => {
  const input = {
    zoom: 1,
    left: 500,
    top: 800,
    x: 250,
    y: 200,
    deltaY: -100,
    deltaMode: 0,
    viewportHeight: 700,
  };
  const enlarged = zoomWorkspaceAtPointer(input);
  expect(enlarged.zoom).toBeGreaterThan(1);
  expect((enlarged.left + 250) / enlarged.zoom).toBeCloseTo(750);
  expect((enlarged.top + 200) / enlarged.zoom).toBeCloseTo(1000);
  const restored = zoomWorkspaceAtPointer({
    ...input,
    ...enlarged,
    deltaY: 100,
  });
  expect(restored.zoom).toBeCloseTo(1);
  expect(restored.left).toBeCloseTo(500);
  expect(restored.top).toBeCloseTo(800);
});
test("wheel units normalize and zoom stops at reader limits without drifting", () => {
  const input = {
    zoom: 3,
    left: 500,
    top: 800,
    x: 250,
    y: 200,
    deltaY: -100,
    deltaMode: 0,
    viewportHeight: 700,
  };
  expect(zoomWorkspaceAtPointer(input)).toEqual({
    zoom: 3,
    left: 500,
    top: 800,
  });
  expect(zoomWorkspaceAtPointer({ ...input, zoom: 0.4, deltaY: 100 })).toEqual({
    zoom: 0.4,
    left: 500,
    top: 800,
  });
  expect(
    zoomWorkspaceAtPointer({ ...input, zoom: 1, deltaY: -1, deltaMode: 1 }),
  ).toEqual(zoomWorkspaceAtPointer({ ...input, zoom: 1, deltaY: -16 }));
});


test("document wheel zoom respects intrinsic limits under a scaled desk", () => {
  for (const scale of [.4, 3]) {
    const limits = { min: .4 * scale, max: 3 * scale };
    for (const [zoom, deltaY] of [[limits.min, 999], [limits.max, -999]]) {
      const result = zoomWorkspaceAtPointer({ zoom, limits, left: 120, top: 80, x: 20, y: 40,
        deltaY, deltaMode: 0, viewportHeight: 700 });
      expect(result.zoom).toBeGreaterThanOrEqual(limits.min);
      expect(result.zoom).toBeLessThanOrEqual(limits.max);
      expect(result.left).toBeCloseTo(120);
    }
  }
});
