import { describe, expect, test } from "vitest";
import { findOpenCardPlacement } from "../apps/web/src/features/workspace/card-placement";

describe("automatic card placement", () => {
  test("a new note clears the full bounds of an excerpt already in view", () => {
    const excerpt = { x: 70, y: 70, width: 320, height: 240 };
    const note = findOpenCardPlacement({ x: 60, y: 120, width: 340, height: 220 }, [excerpt]);
    expect(note.y).toBeGreaterThanOrEqual(excerpt.y + excerpt.height + 16);
  });

  test("skips successive occupied slots and leaves the requested horizontal position", () => {
    const note = findOpenCardPlacement({ x: 60, y: 120, width: 340, height: 220 }, [
      { x: 70, y: 70, width: 320, height: 240 },
      { x: 40, y: 330, width: 340, height: 220 },
    ]);
    expect(note).toEqual({ x: 60, y: 566, width: 340, height: 220 });
  });
});
