import { test, expect } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { PDFDocument, PDFName, PDFString } from "pdf-lib";
import { PNG } from "pngjs";
import { unzipSync, strFromU8 } from "fflate";
import { createCore } from "../apps/core/src/server";
import type { Book, ChatTurn } from "../packages/protocol/src";

async function fixture() {
  const directory = await mkdtemp(join(tmpdir(), "aireader-region-images-"));
  let core: ReturnType<typeof createCore>;
  let base = "",
    cookie = "";
  async function serve() {
    core = createCore(directory, "dist/web", {
      path: process.execPath,
      version: "fixture",
      args: [resolve("tests/fixtures/fake-codex.mjs")],
    });
    await new Promise<void>((done) => core.server.listen(0, "127.0.0.1", done));
    const address = core.server.address();
    if (!address || typeof address === "string") throw new Error("No address");
    base = `http://127.0.0.1:${address.port}`;
    cookie = (
      await fetch(base + "/api/session", {
        method: "POST",
        headers: { Origin: base },
      })
    ).headers
      .get("set-cookie")!
      .split(";")[0];
  }
  const api = (path: string, body?: unknown) =>
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
  async function importBook(labelPrefix = "fig-") {
    const pdf = await PDFDocument.create();
    pdf
      .addPage()
      .drawText("Neighboring figure text must not be silently included.");
    pdf.addPage().drawText("Current reading page text.");
    pdf.catalog.set(
      PDFName.of("PageLabels"),
      pdf.context.obj({
        Nums: [0, { S: PDFName.of("D"), P: PDFString.of(labelPrefix), St: 1 }],
      }),
    );
    const imported: Book = await (await api("books", await pdf.save())).json();
    await expect
      .poll(
        async () => (await (await api(`books/${imported.id}`)).json()).status,
        { timeout: 10000 },
      )
      .toBe("ready");
    return (await api(`books/${imported.id}`)).json() as Promise<Book>;
  }
  await serve();
  return {
    api,
    importBook,
    restart: async () => {
      core.close();
      await serve();
    },
    close: async () => {
      core.close();
      await rm(directory, {
        recursive: true,
        force: true,
        maxRetries: 5,
        retryDelay: 100,
      });
    },
  };
}

function redImage() {
  const png = new PNG({ width: 2, height: 3 });
  for (let i = 0; i < png.data.length; i += 4)
    png.data.set([255, 0, 0, 255], i);
  return {
    name: "图表区域.png",
    dataUrl: "data:image/png;base64," + PNG.sync.write(png).toString("base64"),
  };
}

test("PDF region images retain their book position and authoritative page label across restart", async () => {
  const f = await fixture();
  try {
    const book = await f.importBook();
    const session = await (await f.api(`books/${book.id}/sessions`, {})).json();
    const source = {
      kind: "pdf-region",
      bookId: book.id,
      fingerprint: book.fingerprint,
      page: 1,
      rect: [10, 20, 110, 120],
    };
    const response = await f.api(`books/${book.id}/turns`, {
      reading: { bookId: book.id, page: 2, scope: "auto" },
      question: "CHECK_IMAGE",
      sessionId: session.id,
      model: "fixture-a",
      effort: "medium",
      images: [{ ...redImage(), source }],
    });
    expect(response.status).toBe(202);
    const turn: ChatTurn = await response.json();
    expect(turn.images?.[0].source).toEqual({ ...source, label: "fig-1" });
    const turns = async (): Promise<ChatTurn[]> =>
      (await f.api(`books/${book.id}/turns`)).json();
    await expect
      .poll(async () => (await turns())[0].status, { timeout: 5000 })
      .toBe("complete");
    expect((await turns())[0].answer).toBe(
      "Images received: 1; 2x3:255,0,0,255",
    );
    expect((await turns())[0].context.reading.page).toBe(2);
    expect((await turns())[0].context.evidence.every((p) => p.page === 2)).toBe(
      true,
    );
    const { note } = await (
      await f.api(`books/${book.id}/turns/${turn.id}/note`, {})
    ).json();
    const exported = await f.api(`books/${book.id}/notes/${note.id}/export`);
    expect(exported.status).toBe(200);
    const archive = unzipSync(new Uint8Array(await exported.arrayBuffer()));
    expect(Object.keys(archive).sort()).toEqual([
      "assets/question-1.png",
      "note.md",
    ]);
    const markdown = strFromU8(archive["note.md"]);
    expect(markdown).toContain("第 fig-1 页");
    expect(markdown).toContain("图表框选位置");
    expect(markdown).toContain("10,20,110,120");
    expect(markdown).toContain("位置说明不证明图像内容来自原始 PDF");
    await f.restart();
    expect((await turns())[0].images?.[0].source).toEqual({
      ...source,
      label: "fig-1",
    });
    const image = await f.api(
      `books/${book.id}/chat-images/${turn.images![0].id}`,
    );
    expect(image.status).toBe(200);
    expect([
      ...PNG.sync
        .read(Buffer.from(await image.arrayBuffer()))
        .data.subarray(0, 4),
    ]).toEqual([255, 0, 0, 255]);
  } finally {
    await f.close();
  }
}, 20000);

test("region provenance rejects forged books, fingerprints, labels, paths and invalid rectangles before creating a turn", async () => {
  const f = await fixture();
  try {
    const book = await f.importBook();
    const other = await f.importBook("other-");
    const session = await (await f.api(`books/${book.id}/sessions`, {})).json();
    const source = {
      kind: "pdf-region",
      bookId: book.id,
      fingerprint: book.fingerprint,
      page: 1,
      rect: [10, 20, 110, 120],
    };
    const request = {
      reading: { bookId: book.id, page: 2 },
      question: "CHECK_IMAGE",
      sessionId: session.id,
      model: "fixture-a",
      effort: "medium",
    };
    for (const invalid of [
      { ...source, bookId: other.id },
      { ...source, fingerprint: other.fingerprint },
      { ...source, page: 3 },
      { ...source, page: 0 },
      { ...source, page: 1.5 },
      { ...source, rect: [10, 20, 10, 120] },
      { ...source, rect: [110, 20, 10, 120] },
      { ...source, rect: [10, 20, 110, 20] },
      { ...source, rect: [10, 20, 200001, 120] },
      { ...source, rect: [10, 20, null, 120] },
      { ...source, label: "forged-page" },
      { ...source, path: "C:/Users/private.pdf" },
      { ...source, citationId: "fake:1:0" },
    ]) {
      const response = await f.api(`books/${book.id}/turns`, {
        ...request,
        images: [{ ...redImage(), source: invalid }],
      });
      expect(response.status).toBe(400);
    }
    expect(await (await f.api(`books/${book.id}/turns`)).json()).toEqual([]);
    const accepted = await f.api(`books/${book.id}/turns`, {
      ...request,
      images: [{ ...redImage(), source }],
    });
    expect(accepted.status).toBe(202);
    const turn: ChatTurn = await accepted.json();
    expect(
      (await f.api(`books/${other.id}/chat-images/${turn.images![0].id}`))
        .status,
    ).toBe(400);
    await f.api(`books/${book.id}/turns/${turn.id}/cancel`, {});
  } finally {
    await f.close();
  }
}, 20000);

test("large region page labels are part of the same prompt budget and a rejected submission can be retried", async () => {
  const f = await fixture();
  try {
    const book = await f.importBook("L".repeat(10000));
    const session = await (await f.api(`books/${book.id}/sessions`, {})).json();
    const source = {
      kind: "pdf-region",
      bookId: book.id,
      fingerprint: book.fingerprint,
      page: 1,
      rect: [10, 20, 110, 120],
    };
    const request = {
      reading: { bookId: book.id, page: 2 },
      question: "问".repeat(5000),
      sessionId: session.id,
      model: "fixture-a",
      effort: "medium",
      images: [{ ...redImage(), source }],
    };
    const rejected = await f.api(`books/${book.id}/turns`, request);
    expect(rejected.status).toBe(400);
    expect((await rejected.json()).error).toContain("上下文预算");
    expect(await (await f.api(`books/${book.id}/turns`)).json()).toEqual([]);
    const accepted = await f.api(`books/${book.id}/turns`, {
      ...request,
      question: "CHECK_IMAGE",
    });
    expect(accepted.status).toBe(202);
    const turns = async (): Promise<ChatTurn[]> =>
      (await f.api(`books/${book.id}/turns`)).json();
    await expect
      .poll(async () => (await turns())[0].status, { timeout: 5000 })
      .toBe("complete");
    const turn = (await turns())[0];
    expect(turn.context.estimatedTokens).toBeLessThanOrEqual(12000);
    expect(turn.context.estimatedTokens).toBeGreaterThan(5000);
    expect(turn.answer).toBe("Images received: 1; 2x3:255,0,0,255");
  } finally {
    await f.close();
  }
}, 20000);

test("the model receives region metadata alongside actual pixels without granting image citation IDs or expanding reading scope", async () => {
  const f = await fixture();
  try {
    const book = await f.importBook();
    const session = await (await f.api(`books/${book.id}/sessions`, {})).json();
    const source = {
      kind: "pdf-region",
      bookId: book.id,
      fingerprint: book.fingerprint,
      page: 1,
      rect: [10, 20, 110, 120],
    };
    const response = await f.api(`books/${book.id}/turns`, {
      reading: { bookId: book.id, page: 2 },
      question: "CHECK_REGION_PROMPT",
      sessionId: session.id,
      model: "fixture-a",
      effort: "medium",
      images: [{ ...redImage(), source }],
    });
    expect(response.status).toBe(202);
    const turns = async (): Promise<ChatTurn[]> =>
      (await f.api(`books/${book.id}/turns`)).json();
    await expect
      .poll(async () => (await turns())[0].status, { timeout: 5000 })
      .toBe("complete");
    const turn = (await turns())[0];
    expect(turn.answer).not.toContain("MISSING");
    const observed = JSON.parse(
      turn.answer
        .slice("Region prompt received: ".length)
        .replace(/ 〔未验证引用〕$/, ""),
    );
    expect(observed.pictures).toEqual(["2x3:255,0,0,255"]);
    expect(observed.description).toContain('"page":1');
    expect(observed.description).toContain('"label":"fig-1"');
    expect(observed.description).toContain(
      "位置说明不证明图像内容来自原始 PDF",
    );
    expect(observed.description).toContain("不能为图片创建原文引用 ID");
    expect(observed.promptBytes).toBeLessThanOrEqual(turn.context.budget * 2);
    expect(turn.citations).toEqual([]);
    expect(turn.context.reading.page).toBe(2);
    expect(turn.context.evidence.some((p) => p.page === 1)).toBe(false);
  } finally {
    await f.close();
  }
}, 20000);
