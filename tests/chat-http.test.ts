import { test, expect } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { PDFDocument, StandardFonts } from "pdf-lib";
import { createCore } from "../apps/core/src/server";
import type { ChatTurn } from "../packages/protocol/src";

test("public reasoning summaries stream, stay out of future prompts, and survive cancellation and restart", async () => {
  const directory = await mkdtemp(join(tmpdir(), "aireader-chat-http-"));
  let core: ReturnType<typeof createCore> | undefined;
  async function serve() {
    core = createCore(directory, "dist/web", {
      path: process.execPath,
      version: "fixture",
      args: [resolve("tests/fixtures/fake-codex.mjs")],
    });
    await new Promise<void>((done) =>
      core!.server.listen(0, "127.0.0.1", done),
    );
    const address = core.server.address();
    if (!address || typeof address === "string")
      throw new Error("No HTTP address");
    const base = `http://127.0.0.1:${address.port}`;
    const session = await fetch(base + "/api/session", {
      method: "POST",
      headers: { Origin: base },
    });
    const headers = {
      Cookie: session.headers.get("set-cookie")!.split(";")[0],
      Origin: base,
    };
    return async (path: string, body?: unknown) => {
      const response = await fetch(base + "/api/" + path, {
        headers: { ...headers, "Content-Type": "application/json" },
        method: body === undefined ? "GET" : "POST",
        body:
          body === undefined
            ? undefined
            : body instanceof Uint8Array
              ? Buffer.from(body)
              : JSON.stringify(body),
      });
      expect(response.ok).toBe(true);
      return response.json();
    };
  }
  try {
    let api = await serve();
    const pdf = await PDFDocument.create();
    const font = await pdf.embedFont(StandardFonts.Helvetica);
    pdf.addPage().drawText("Memory cache stores tokens.", { font });
    const book = await api("books", await pdf.save());
    await expect
      .poll(async () => (await api(`books/${book.id}`)).status)
      .toBe("ready");
    const session = await api(`books/${book.id}/sessions`, {});
    const path = `books/${book.id}/turns`;
    const readTurn = async (id: string): Promise<ChatTurn> =>
      (await api(path)).find((turn: ChatTurn) => turn.id === id);
    const ask = (question: string) =>
      api(path, {
        reading: {
          bookId: book.id,
          page: 1,
          selection: "Memory cache stores tokens.",
          scope: "selection",
        },
        question,
        sessionId: session.id,
        model: "fixture-a",
        effort: "medium",
      });
    const first = await ask("Explain memory cache");
    await expect
      .poll(async () => (await readTurn(first.id)).status, { timeout: 5000 })
      .toBe("complete");
    const completed = await readTurn(first.id);
    expect(completed.reasoning).toBe(
      "已核对原文。\n\n补充说明与书中观点分开。\n\n保留可核验引用。",
    );
    expect(JSON.stringify(completed)).not.toMatch(/PRIVATE_TRACE|FOREIGN_/);
    const noSummary = await ask("NO_SUMMARY memory");
    await expect
      .poll(async () => (await readTurn(noSummary.id)).status, { timeout: 5000 })
      .toBe("complete");
    const next = await readTurn(noSummary.id);
    expect(next.reasoning).toBe("");
    expect(JSON.stringify(next.context)).not.toContain("已核对原文");
    const pending = await ask("WAIT memory");
    await expect
      .poll(async () => (await readTurn(pending.id)).reasoning, { timeout: 5000 })
      .toBe("核对原文。\n\n区分事实与解释。");
    expect((await readTurn(pending.id)).status).toBe("running");
    await api(`${path}/${pending.id}/cancel`, {});
    await expect
      .poll(async () => (await readTurn(pending.id)).status, { timeout: 5000 })
      .toBe("cancelled");
    core!.close();
    api = await serve();
    expect((await readTurn(first.id)).reasoning).toBe(completed.reasoning);
    expect((await readTurn(pending.id)).reasoning).toBe(
      "核对原文。\n\n区分事实与解释。",
    );
    expect((await readTurn(pending.id)).status).toBe("cancelled");
  } finally {
    core?.close();
    await rm(directory, {
      recursive: true,
      force: true,
      maxRetries: 5,
      retryDelay: 100,
    });
  }
}, 20000);
