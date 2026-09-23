import { test, expect } from "vitest";
import { readFileSync } from "node:fs";
test("Windows delivery keeps a portable EXE and adds a current-user installer", () => {
  const manifest = JSON.parse(readFileSync("package.json", "utf8"));
  expect(manifest.build.win.target).toEqual([
    { target: "portable", arch: ["x64"] },
    { target: "nsis", arch: ["x64"] },
  ]);
  expect(manifest.build.nsis).toMatchObject({
    oneClick: false,
    perMachine: false,
    allowElevation: false,
  });
  const icon = readFileSync(manifest.build.win.icon);
  expect(icon.readUInt16LE(2)).toBe(1);
  expect(icon.readUInt16LE(4)).toBe(9);
  expect(Array.from({ length: 9 }, (_, i) => icon[6 + i * 16] || 256)).toEqual([
    16, 20, 24, 32, 40, 48, 64, 128, 256,
  ]);
});
