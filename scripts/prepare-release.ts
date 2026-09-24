import { appendFile, mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve, join } from "node:path";

// Keep prereleases on the ordinary numeric NSIS version path. The channel is
// metadata, not a suffix that Windows version comparison might ignore.
const event = process.env.GITHUB_EVENT_NAME;
const ref = process.env.GITHUB_REF;
const run = process.env.GITHUB_RUN_NUMBER ?? "";
const commit = process.env.GITHUB_SHA ?? "";
const channel = event === "pull_request" ? "check"
  : event === "push" && ref === "refs/heads/main" ? "stable"
  : event === "workflow_dispatch" && ref === "refs/heads/codex/architecture-refactor" ? "preview"
  : undefined;
if (!channel || !/^[1-9]\d*$/.test(run) || !/^[a-f\d]{40}$/.test(commit))
  throw new Error("Unsupported release source or invalid build identity");
const root = resolve(process.argv[2] ?? ".");
const version = `0.2.${run}`;
const manifest = JSON.parse(await readFile(join(root, "package.json"), "utf8"));
const info = {
  version, channel, commit, ref, run: Number(run),
  // These describe the actual current formats, not planned refactor versions.
  databaseVersion: 4, archiveVersion: 2, apiVersion: 1,
};
await writeFile(join(root, "package.json"), JSON.stringify({ ...manifest, version }, null, 2) + "\n");
await mkdir(join(root, "release"), { recursive: true });
await writeFile(join(root, "release/build-info.json"), JSON.stringify(info, null, 2) + "\n");
if (process.env.GITHUB_OUTPUT)
  await appendFile(process.env.GITHUB_OUTPUT, `version=${version}\nchannel=${channel}\n`);
console.log(JSON.stringify(info));
