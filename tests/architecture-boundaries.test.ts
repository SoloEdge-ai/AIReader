import { test, expect } from "vitest";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { execFileSync } from "node:child_process";
import { pathToFileURL } from "node:url";

test("architecture gate rejects privileged engine imports, protocol barrel cycles and broken current docs", async () => {
  const root = await mkdtemp(join(tmpdir(), "aireader-boundaries-"));
  const run = () => execFileSync(process.execPath,
    ["--import", pathToFileURL(resolve("node_modules/tsx/dist/loader.mjs")).href, resolve("scripts/check-boundaries.ts")],
    { cwd: root, encoding: "utf8", stdio: "pipe" });
  try {
    for (const path of ["packages/protocol/src", "packages/workspace-engine/src", "docs/archive"])
      await mkdir(join(root, path), { recursive: true });
    const engine = join(root, "packages/workspace-engine/src/ink.ts");
    const protocol = join(root, "packages/protocol/src/reading.ts");
    await writeFile(engine, 'import type { Stroke } from "../../protocol/src/reading";');
    await writeFile(protocol, 'import { z } from "zod";');
    await writeFile(join(root, "docs/README.md"), "Current documentation");
    await writeFile(join(root, "docs/archive/old.md"), "[Historical reference](missing.md)");
    expect(run()).toContain("passed");
    await writeFile(engine, 'import { readFile } from "node:fs";');
    expect(() => run()).toThrow(/forbidden dependency node:fs/);
    await writeFile(engine, 'type Window = import("../../../apps/web/src/PdfReader").Window;');
    expect(() => run()).toThrow(/forbidden dependency/);
    await writeFile(engine, "export const zoom = 1;");
    await writeFile(protocol, 'export * from "./index";');
    expect(() => run()).toThrow(/must not import their barrel/);
    await writeFile(protocol, "export type Stroke = {};");
    await writeFile(join(root, "docs/README.md"), "[Current contract](missing.md)");
    expect(() => run()).toThrow(/missing documentation target/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
