import { test, expect } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { createCore } from "../apps/core/src/server";

test("AI model selection survives disconnect but clears on logout", async () => {
  const directory = await mkdtemp(join(tmpdir(), "aireader-ai-http-"));
  const core = createCore(directory, "dist/web", {
    path: process.execPath,
    version: "fixture",
    args: [resolve("tests/fixtures/fake-codex.mjs")],
  });
  try {
    await new Promise<void>((resolve) =>
      core.server.listen(0, "127.0.0.1", resolve),
    );
    const address = core.server.address();
    if (!address || typeof address === "string")
      throw new Error("Missing Core port");
    const origin = `http://127.0.0.1:${address.port}`;
    const session = await fetch(origin + "/api/session", {
      method: "POST",
      headers: { Origin: origin },
    });
    const cookie = session.headers.get("set-cookie")?.split(";")[0];
    if (!cookie) throw new Error("Missing Core session");
    const headers = { Origin: origin, Cookie: cookie };
    const endpoint = origin + "/api/ai";
    expect(
      (await (await fetch(endpoint + "/models", { headers })).json()).map(
        (model: { model: string }) => model.model,
      ),
    ).toEqual(["fixture-a", "fixture-b"]);
    const selected = await fetch(endpoint + "/selection", {
      method: "POST",
      headers,
      body: JSON.stringify({ model: "fixture-b", effort: "high" }),
    });
    expect(await selected.json()).toEqual({
      model: "fixture-b",
      effort: "high",
    });
    expect(
      (
        await fetch(endpoint + "/selection", {
          method: "POST",
          headers,
          body: JSON.stringify({ model: "fixture-b", effort: "low" }),
        })
      ).status,
    ).toBe(400);
    expect(
      await (await fetch(endpoint + "/selection", { headers })).json(),
    ).toEqual({ model: "fixture-b", effort: "high" });
    expect(
      (
        await (
          await fetch(endpoint + "/disconnect", { method: "POST", headers })
        ).json()
      ).connected,
    ).toBe(false);
    expect(
      (await (await fetch(endpoint + "/models", { headers })).json()).length,
    ).toBe(2);
    expect(
      await (await fetch(endpoint + "/selection", { headers })).json(),
    ).toEqual({ model: "fixture-b", effort: "high" });
    expect((await (await fetch(endpoint + "/runtime", { headers })).json()).status).toBe("missing");
    expect((await (await fetch(endpoint + "/runtime/cancel", {
      method: "POST", headers,
    })).json()).status).toBe("missing");
    const loggedOut = await fetch(endpoint + "/logout", { method: "POST", headers });
    expect(loggedOut.status).toBe(200);
    expect((await loggedOut.json()).account).toBeNull();
    expect(await (await fetch(endpoint + "/selection", { headers })).json()).toBeNull();
  } finally {
    await core.shutdown();
    await rm(directory, {
      recursive: true,
      force: true,
      maxRetries: 5,
      retryDelay: 100,
    });
  }
});
