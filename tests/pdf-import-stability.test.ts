import { test, expect } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PDFDocument } from "pdf-lib";
import { createCore } from "../apps/core/src/server";

test("repeated PDF imports keep Core available and each book searchable", async () => {
  const directory = await mkdtemp(join(tmpdir(), "aireader-pdf-stability-"));
  const core = createCore(directory, "dist/web");
  await new Promise<void>((done) => core.server.listen(0, "127.0.0.1", done));
  const address = core.server.address();
  if (!address || typeof address === "string") throw new Error("No address");
  const base = `http://127.0.0.1:${address.port}`;
  try {
    const session = await fetch(base + "/api/session", {
      method: "POST",
      headers: { Origin: base },
    });
    const cookie = session.headers.get("set-cookie")!.split(";")[0];
    const headers = { Cookie: cookie, Origin: base };
    for (let index = 0; index < 40; index++) {
      const pdf = await PDFDocument.create();
      pdf.addPage().drawText(`Import stability sample ${index}`);
      const response = await fetch(base + "/api/books", {
        method: "POST",
        headers,
        body: Buffer.from(await pdf.save()),
      });
      expect(response.status).toBe(201);
      const book = await response.json();
      await expect
        .poll(
          async () => {
            const response = await fetch(base + `/api/books/${book.id}`, {
              headers,
            });
            return (await response.json()).status;
          },
          { timeout: 10000 },
        )
        .toBe("ready");
      const results = await (
        await fetch(base + `/api/books/${book.id}/search?q=stability`, {
          headers,
        })
      ).json();
      expect(results[0].anchor).toMatchObject({ bookId: book.id, page: 1 });
      expect((await fetch(base + "/api/health", { headers })).status).toBe(200);
    }
    const dense = await PDFDocument.create();
    for (let page = 1; page <= 20; page++) {
      const pdfPage = dense.addPage([612, 792]);
      for (let line = 0; line < 100; line++)
        pdfPage.drawText(`Dense parser payload page ${page} row ${line}`, {
          x: 20,
          y: 770 - line * 7,
          size: 6,
        });
      if (page === 20)
        pdfPage.drawText("IPC_BACKPRESSURE_FINAL_PAGE", {
          x: 20,
          y: 20,
          size: 6,
        });
    }
    const denseBook = await (
      await fetch(base + "/api/books", {
        method: "POST",
        headers,
        body: Buffer.from(await dense.save()),
      })
    ).json();
    await expect
      .poll(
        async () => {
          const response = await fetch(base + `/api/books/${denseBook.id}`, {
            headers,
          });
          return (await response.json()).status;
        },
        { timeout: 20000 },
      )
      .toBe("ready");
    const denseResults = await (
      await fetch(
        base +
          `/api/books/${denseBook.id}/search?q=IPC_BACKPRESSURE_FINAL_PAGE`,
        { headers },
      )
    ).json();
    expect(denseResults[0].anchor).toMatchObject({
      bookId: denseBook.id,
      page: 20,
    });
    const broken = await (
      await fetch(base + "/api/books", {
        method: "POST",
        headers,
        body: "%PDF-1.7\ninvalid document",
      })
    ).json();
    await expect
      .poll(
        async () => {
          const response = await fetch(base + `/api/books/${broken.id}`, {
            headers,
          });
          return (await response.json()).status;
        },
        { timeout: 10000 },
      )
      .toBe("error");
    expect((await fetch(base + "/api/health", { headers })).status).toBe(200);
  } finally {
    core.close();
    await rm(directory, { recursive: true, force: true, maxRetries: 5 });
  }
}, 60000);
