import { test, expect } from "vitest";
import { readFileSync } from "node:fs";
test("portable delivery has no installer target", () => {
  const manifest = JSON.parse(readFileSync("package.json", "utf8"));
  expect(manifest.build.win.target).toEqual([
    { target: "portable", arch: ["x64"] },
  ]);
  const icon = readFileSync(manifest.build.win.icon);
  expect(icon.readUInt16LE(2)).toBe(1);
  expect(icon.readUInt16LE(4)).toBe(9);
  expect(Array.from({ length: 9 }, (_, i) => icon[6 + i * 16] || 256)).toEqual([
    16, 20, 24, 32, 40, 48, 64, 128, 256,
  ]);
});
