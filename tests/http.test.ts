import { test, expect } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PDFDocument, StandardFonts } from "pdf-lib";
import { createCore } from "../apps/core/src/server";
test("HTTP protects book APIs, imports and searches a PDF, rejects mismatched reading state", async () => {
  const directory = await mkdtemp(join(tmpdir(), "aireader-http-"));
  const core = createCore(directory, "dist/web");
  await new Promise<void>((r) => core.server.listen(0, "127.0.0.1", r));
  const address = core.server.address() as { port: number };
  const base = `http://127.0.0.1:${address.port}`;
  try {
    expect((await fetch(base + "/api/books")).status).toBe(401);
    expect(
      (
        await fetch(base + "/api/session", {
          method: "POST",
          headers: { Origin: "https://example.com" },
        })
      ).status,
    ).toBe(403);
    const session = await fetch(base + "/api/session", {
      method: "POST",
      headers: { Origin: base },
    });
    const cookie = session.headers.get("set-cookie")!.split(";")[0];
    const headers = { Cookie: cookie, Origin: base };
    const toolEndpoint = base + "/api/tool-preferences";
    expect(await (await fetch(toolEndpoint, { headers })).json()).toEqual({
      dock: "bottom", offset: 0.5, collapsedOffset: 0.5, collapsed: false,
      pen: { color: "#345d84", width: 2, opacity: 1 },
      highlighter: { color: "#e6b72d", width: 12, opacity: 0.3 },
    });
    expect((await fetch(toolEndpoint, {
      method: "PUT",
      headers: { ...headers, "Content-Type": "application/json" },
      body: JSON.stringify({ dock: "left", offset: 0.35, collapsedOffset: 0.72, collapsed: true }),
    })).status).toBe(200);
    expect(await (await fetch(toolEndpoint, { headers })).json()).toEqual({
      dock: "left", offset: 0.35, collapsedOffset: 0.72, collapsed: true,
      pen: { color: "#345d84", width: 2, opacity: 1 },
      highlighter: { color: "#e6b72d", width: 12, opacity: 0.3 },
    });
    expect((await fetch(toolEndpoint, {
      method: "PUT", headers,
      body: JSON.stringify({ dock: "outside", offset: 4, collapsed: true }),
    })).status).toBe(400);
    const pdf = await PDFDocument.create();
    const font = await pdf.embedFont(StandardFonts.Helvetica);
    pdf.addPage().drawText("Memory isolation for inference", { font });
    const bytes = await pdf.save();
    const response = await fetch(base + "/api/books", {
      method: "POST",
      headers: { ...headers, "X-Filename": "Fixture.pdf" },
      body: Buffer.from(bytes),
    });
    expect(response.status).toBe(201);
    const book = await response.json();
    await core.library.waitForBook(book.id);
    const results = await (
      await fetch(base + `/api/books/${book.id}/search?q=memory`, { headers })
    ).json();
    expect(results[0].anchor).toMatchObject({ bookId: book.id, page: 1 });
    const mismatch = await fetch(base + `/api/books/${book.id}/turns`, {
      method: "POST",
      headers: { ...headers, "Content-Type": "application/json" },
      body: JSON.stringify({
        reading: { bookId: "another", page: 1 },
        question: "why",
        sessionId: "s",
      }),
    });
    expect(mismatch.status).toBe(400);
    expect(
      (
        await fetch(base + "/api/books", {
          method: "POST",
          headers,
          body: "Not a PDF",
        })
      ).status,
    ).toBe(400);
    await fetch(base + `/api/books/${book.id}/tools`, { headers });
    expect(
      (
        await fetch(base + `/api/books/${book.id}/generated?name=.`, {
          headers,
        })
      ).status,
    ).toBe(400);
    expect((await fetch(base + "/api/health", { headers })).status).toBe(200);
  } finally {
    core.close();
    await rm(directory, { recursive: true, force: true });
  }
});
