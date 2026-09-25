import { test, expect } from "vitest";
import { existsSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve, join } from "node:path";
import { CodexAdapter } from "../apps/core/src/codex";
test("stdio adapter starts fresh threads, interrupts a turn, and reconnects without logging out", async () => {
  const directory = await mkdtemp(join(tmpdir(), "aireader-codex-"));
  const adapter = new CodexAdapter(directory, undefined, {
    path: process.execPath,
    version: "fixture",
    args: [resolve("tests/fixtures/fake-codex.mjs")],
  });
  try {
    const connecting = adapter.connect();
    await new Promise((r) => setTimeout(r, 20));
    const early = adapter.answer("concurrent initialize");
    await connecting;
    expect((await early).text).toContain("thread-1");
    expect(adapter.info.account).toMatchObject({ type: "chatgpt" });
    const models = await adapter.models();
    expect(models.map((m) => m.model)).toEqual(["fixture-a", "fixture-b"]);
    const configured = await adapter.answer("CONFIG", {
      model: "fixture-b",
      effort: "high",
    });
    expect(configured.text).toContain("fixture-b/high");
    expect(configured.text).toContain("isolated=true");
    expect((await adapter.answer("first")).text).toContain("thread-3");
    expect((await adapter.answer("second")).text).toContain("thread-4");
    const summaries: string[] = [];
    const explained = await adapter.answer("summary", {
      onReasoning: (text) => summaries.push(text),
    });
    expect(summaries).toContain("核对原文。\n\n区分事实与解释。");
    expect(explained.reasoning).toBe(
      "已核对原文。\n\n补充说明与书中观点分开。\n\n保留可核验引用。",
    );
    expect(JSON.stringify({ summaries, explained })).not.toMatch(
      /PRIVATE_TRACE|FOREIGN_/,
    );
    expect(
      (await adapter.answer("NO_SUMMARY", { onReasoning: () => {} })).reasoning,
    ).toBe("");
    const signal = new AbortController();
    const pending = adapter.answer("WAIT", { signal: signal.signal });
    setTimeout(() => signal.abort(), 100);
    await expect(pending).rejects.toThrow("已取消");
    adapter.disconnect();
    await adapter.connect();
    expect((await adapter.answer("again")).text).toContain("thread-1");
  } finally {
    await adapter.disconnect();
    await rm(directory, {
      recursive: true,
      force: true,
      maxRetries: 5,
      retryDelay: 100,
    });
  }
});

test("terminal shutdown cancels a pending Codex startup and forbids late reconnect", async () => {
  const directory = await mkdtemp(join(tmpdir(), "aireader-codex-shutdown-"));
  const marker = join(directory, "late-started.txt");
  let release!: () => void;
  let entered!: () => void;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  const beforeSpawn = new Promise<void>((resolve) => { entered = resolve; });
  const adapter = new CodexAdapter(directory, undefined, {
    path: process.execPath,
    version: "fixture",
    args: [resolve("tests/fixtures/fake-codex.mjs"), `--startup-marker=${marker}`],
    beforeSpawn: async () => { entered(); await gate; },
  });
  try {
    const connecting = adapter.connect();
    await beforeSpawn;
    await adapter.shutdown();
    await expect(connecting).rejects.toThrow("关闭");
    release();
    await new Promise((resolve) => setTimeout(resolve, 250));
    expect(existsSync(marker)).toBe(false);
    await expect(adapter.connect()).rejects.toThrow("正在关闭");
    expect(adapter.info.connected).toBe(false);
  } finally {
    release();
    await rm(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }
});
