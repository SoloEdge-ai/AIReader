import { test, expect } from "vitest";
import { mkdtemp, mkdir, writeFile, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { createServer } from "node:http";
import * as tar from "tar";
import { RuntimeManager } from "../apps/core/src/runtime";
test("runtime downloads a pinned archive, rejects corruption and can cancel/retry without exposing partial executables", async () => {
  const directory = await mkdtemp(join(tmpdir(), "aireader-runtime-"));
  await mkdir(join(directory, "fixture/package/vendor"), { recursive: true });
  await writeFile(
    join(directory, "fixture/package/vendor/codex.exe"),
    "fixture binary",
  );
  await tar.c(
    {
      cwd: join(directory, "fixture"),
      gzip: true,
      file: join(directory, "fixture.tgz"),
    },
    ["package"],
  );
  const bytes = await readFile(join(directory, "fixture.tgz"));
  let slow = false,
    corrupt = false;
  const server = createServer((_req, res) => {
    res.writeHead(200, { "content-length": bytes.length });
    if (slow) {
      res.write(bytes.subarray(0, 2));
      const timer = setTimeout(() => res.end(bytes.subarray(2)), 2000);
      res.on("close", () => clearTimeout(timer));
    } else res.end(corrupt ? Buffer.alloc(bytes.length) : bytes);
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const address = server.address() as { port: number };
  const manifest = {
    version: "fixture",
    url: `http://127.0.0.1:${address.port}`,
    integrity: createHash("sha512").update(bytes).digest("base64"),
    binary: "vendor/codex.exe",
  };
  const manager = new RuntimeManager(directory, () => {}, manifest);
  try {
    corrupt = true;
    await manager.prepare();
    expect(manager.state.status).toBe("error");
    await expect(manager.executable()).rejects.toThrow();
    corrupt = false;
    slow = true;
    const pending = manager.prepare();
    await new Promise((r) => setTimeout(r, 70));
    await manager.cancel();
    await pending;
    expect(manager.state.status).toBe("missing");
    slow = false;
    await manager.prepare();
    expect(manager.state.status).toBe("ready");
    expect(await readFile(await manager.executable(), "utf8")).toBe(
      "fixture binary",
    );
    const restarted = new RuntimeManager(directory, () => {}, manifest);
    expect((await restarted.inspect()).status).toBe("ready");
    await writeFile(await restarted.executable(), "tampered");
    await expect(restarted.executable()).rejects.toThrow("校验失败");
  } finally {
    await manager.cancel();
    server.closeAllConnections();
    await new Promise<void>((r) => server.close(() => r()));
    await rm(directory, {
      recursive: true,
      force: true,
      maxRetries: 5,
      retryDelay: 100,
    });
  }
});
