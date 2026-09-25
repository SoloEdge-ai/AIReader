import { test, expect } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { connect } from "node:net";
import { once } from "node:events";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createCore } from "../apps/core/src/server";

test("Core shutdown closes a stalled renderer HTTP request after drafts are saved", async () => {
  const directory = await mkdtemp(join(tmpdir(), "aireader-shutdown-http-"));
  const core = createCore(directory, "dist/web");
  let socket: ReturnType<typeof connect> | undefined;
  let shutdown: Promise<void> | undefined;
  try {
    await new Promise<void>((resolve) => core.server.listen(0, "127.0.0.1", resolve));
    const address = core.server.address();
    if (!address || typeof address === "string") throw new Error("Missing Core port");
    const origin = `http://127.0.0.1:${address.port}`;
    const session = await fetch(origin + "/api/session", { method: "POST", headers: { Origin: origin } });
    const cookie = session.headers.get("set-cookie")?.split(";")[0];
    if (!cookie) throw new Error("Missing Core session");
    socket = connect(address.port, "127.0.0.1");
    socket.on("error", () => {});
    await once(socket, "connect");
    socket.write(`POST /api/books HTTP/1.1\r\nHost: 127.0.0.1:${address.port}\r\nOrigin: ${origin}\r\nCookie: ${cookie}\r\nContent-Length: 100\r\n\r\nx`);
    // Leave the request body incomplete; normal server.close waits for its request stream.
    await new Promise((resolve) => setTimeout(resolve, 50));
    shutdown = core.shutdown();
    const completed = await Promise.race([
      shutdown.then(() => true),
      new Promise<false>((resolve) => setTimeout(() => resolve(false), 1000)),
    ]);
    expect(completed).toBe(true);
  } finally {
    socket?.destroy();
    if (shutdown) await shutdown;
    else core.close();
    await rm(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }
}, 10000);
