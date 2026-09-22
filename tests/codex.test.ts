import { test, expect } from "vitest";
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
    expect((await adapter.answer("first")).text).toContain("thread-2");
    expect((await adapter.answer("second")).text).toContain("thread-3");
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
