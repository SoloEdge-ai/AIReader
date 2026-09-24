import { test, expect } from "vitest";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { execFileSync } from "node:child_process";

test("branch packages record their exact source and cannot masquerade as stable", async () => {
  const directory = await mkdtemp(join(tmpdir(), "aireader-build-metadata-"));
  const sha = "a".repeat(40);
  try {
    await writeFile(join(directory, "package.json"), JSON.stringify({ version: "0.1.0", name: "aireader" }));
    const run = (event: string, ref: string) => execFileSync(process.execPath,
      ["--import", "tsx", resolve("scripts/prepare-release.ts"), directory], {
        cwd: process.cwd(), env: { ...process.env, GITHUB_EVENT_NAME: event, GITHUB_REF: ref,
          GITHUB_SHA: sha, GITHUB_RUN_NUMBER: "93", GITHUB_OUTPUT: "" }, encoding: "utf8", stdio: "pipe",
      });
    run("workflow_dispatch", "refs/heads/codex/architecture-refactor");
    expect(JSON.parse(await readFile(join(directory, "package.json"), "utf8")).version).toBe("0.2.93");
    expect(JSON.parse(await readFile(join(directory, "release/build-info.json"), "utf8"))).toMatchObject({
      version: "0.2.93", channel: "preview", commit: sha, databaseVersion: 4, archiveVersion: 2, apiVersion: 2,
    });
    run("pull_request", "refs/pull/24/merge");
    expect(JSON.parse(await readFile(join(directory, "release/build-info.json"), "utf8")).channel).toBe("check");
    run("push", "refs/heads/main");
    expect(JSON.parse(await readFile(join(directory, "release/build-info.json"), "utf8")).channel).toBe("stable");
    expect(() => run("workflow_dispatch", "refs/heads/main")).toThrow();
    expect(() => run("workflow_dispatch", "refs/heads/other")).toThrow();
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
