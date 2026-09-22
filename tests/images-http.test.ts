import { test, expect } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { PDFDocument } from "pdf-lib";
import { PNG } from "pngjs";
import { createCore } from "../apps/core/src/server";
import type { ChatTurn } from "../packages/protocol/src";

test("chat sends actual images, preserves them across restart, and scopes access to their book", async () => {
  const directory = await mkdtemp(join(tmpdir(), "aireader-images-"));
  let core: ReturnType<typeof createCore>;
  async function serve() {
    core = createCore(directory, "dist/web", {
      path: process.execPath,
      version: "fixture",
      args: [resolve("tests/fixtures/fake-codex.mjs")],
    });
    await new Promise<void>((done) => core.server.listen(0, "127.0.0.1", done));
    const address = core.server.address();
    if (!address || typeof address === "string") throw new Error("No address");
    const base = `http://127.0.0.1:${address.port}`;
    const cookie = (
      await fetch(base + "/api/session", {
        method: "POST",
        headers: { Origin: base },
      })
    ).headers
      .get("set-cookie")!
      .split(";")[0];
    return (path: string, body?: unknown) =>
      fetch(base + "/api/" + path, {
        headers: {
          Cookie: cookie,
          Origin: base,
          "Content-Type": "application/json",
        },
        method: body === undefined ? "GET" : "POST",
        body:
          body instanceof Uint8Array
            ? Buffer.from(body)
            : body === undefined
              ? undefined
              : JSON.stringify(body),
      });
  }
  try {
    let api = await serve();
    const pdf = await PDFDocument.create();
    pdf.addPage().drawText("Image question fixture");
    const book = await (await api("books", await pdf.save())).json();
    await expect
      .poll(async () => (await (await api(`books/${book.id}`)).json()).status)
      .toBe("ready");
    const session = await (await api(`books/${book.id}/sessions`, {})).json();
    const png = new PNG({ width: 2, height: 3 });
    for (let i = 0; i < png.data.length; i += 4)
      png.data.set([255, 0, 0, 255], i);
    const dataUrl =
      "data:image/png;base64," + PNG.sync.write(png).toString("base64");
    const request = {
      reading: { bookId: book.id, page: 1 },
      question: "CHECK_IMAGE",
      sessionId: session.id,
      model: "fixture-a",
      effort: "medium",
      images: [{ name: "截图.png", dataUrl }],
    };
    const response = await api(`books/${book.id}/turns`, request);
    expect(response.status).toBe(202);
    const turn = await response.json();
    const turns = async (): Promise<ChatTurn[]> =>
      (await api(`books/${book.id}/turns`)).json();
    await expect
      .poll(async () => (await turns())[0].answer, { timeout: 5000 })
      .toBe("Images received: 1; 2x3:255,0,0,255");
    expect(turn.images).toMatchObject([
      { name: "截图.png", width: 2, height: 3 },
    ]);
    expect(JSON.stringify(turn)).not.toMatch(/data:image|chat-images[\\/]/);
    const imagePath = `books/${book.id}/chat-images/${turn.images[0].id}`;
    const imageResponse = await api(imagePath);
    expect(imageResponse.headers.get("content-type")).toBe("image/png");
    const decoded = PNG.sync.read(
      Buffer.from(await imageResponse.arrayBuffer()),
    );
    expect([...decoded.data.subarray(0, 4)]).toEqual([255, 0, 0, 255]);
    pdf.addPage();
    const other = await (await api("books", await pdf.save())).json();
    expect(
      (await api(`books/${other.id}/chat-images/${turn.images[0].id}`)).status,
    ).toBe(400);
    for (const images of [
      [{ name: "bad.png", dataUrl: "data:image/png;base64,AAAA" }],
      Array.from({ length: 5 }, () => ({ name: "x.png", dataUrl })),
      [{ name: "private.png", path: "C:/Users/secret.png" }],
      [{ name: "url.png", dataUrl: "https://example.invalid/image.png" }],
    ])
      expect(
        (await api(`books/${book.id}/turns`, { ...request, images })).status,
      ).toBe(400);
    expect((await turns()).length).toBe(1);
    const next = await api(`books/${book.id}/turns`, {
      ...request,
      images: [],
    });
    expect(next.status).toBe(202);
    await expect
      .poll(async () => (await turns())[1].answer, { timeout: 5000 })
      .toBe("Images received: 0; ");
    expect((await turns())[1].context.recent).toContain("图片未随历史重发");
    core!.close();
    api = await serve();
    expect((await turns())[0].images).toEqual(turn.images);
    expect((await api(imagePath)).status).toBe(200);
  } finally {
    core!?.close();
    await rm(directory, {
      recursive: true,
      force: true,
      maxRetries: 5,
      retryDelay: 100,
    });
  }
}, 20000);
