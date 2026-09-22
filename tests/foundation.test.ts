import { test, expect } from "vitest";
import { readFileSync } from "node:fs";
test("portable delivery has no installer target", () => {
  const manifest = JSON.parse(readFileSync("package.json", "utf8"));
  expect(manifest.build.win.target).toEqual([
    { target: "portable", arch: ["x64"] },
  ]);
});
