import { test, expect } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { PDFDocument, StandardFonts } from "pdf-lib";
import { Library } from "../apps/core/src/library";
import { CodexAdapter } from "../apps/core/src/codex";
import { IndexService } from "../apps/core/src/indexer";
test("semantic jobs persist pause/resume state and only reference their own source passages", async () => {
  const directory = await mkdtemp(join(tmpdir(), "aireader-index-"));
  const library = new Library(directory);
  const codex = new CodexAdapter(join(directory, "control"), undefined, {
    path: process.execPath,
    version: "fixture",
    args: [resolve("tests/fixtures/fake-codex.mjs")],
  });
  const indexer = new IndexService(library, codex);
  try {
    const pdf = await PDFDocument.create();
    const font = await pdf.embedFont(StandardFonts.Helvetica);
    pdf.addPage().drawText("Memory architecture and storage", { font });
    const book = await library.import(
      Buffer.from(await pdf.save()),
      "Fixture.pdf",
    );
    await library.waitForBook(book.id);
    const job = indexer.start(book.id, 1);
    indexer.control(book.id, job.id, "pause");
    expect(indexer.list(book.id)[0].status).toBe("paused");
    await expect
      .poll(
        () => {
          try {
            indexer.control(book.id, job.id, "resume");
            return true;
          } catch (error) {
            if (
              error instanceof Error &&
              error.message === "正在停止当前任务，请稍后重试"
            )
              return false;
            throw error;
          }
        },
        { timeout: 10000 },
      )
      .toBe(true);
    await expect.poll(() => indexer.list(book.id)[0].status).toBe("complete");
    const nodes = indexer.nodes(book.id);
    expect(nodes).toHaveLength(1);
    expect(nodes[0].sourcePassageIds).toEqual(
      library.passages(book.id).map((p) => p.id),
    );
    indexer.close();
    const reopened = new IndexService(library, codex);
    expect(reopened.nodes(book.id)).toEqual(nodes);
    reopened.close();
  } finally {
    indexer.close();
    codex.disconnect();
    library.close();
    await rm(directory, { recursive: true, force: true });
  }
});
