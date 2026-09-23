import { test, expect } from "vitest";
import { PDFDocument, StandardFonts } from "pdf-lib";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Library } from "../apps/core/src/library";
test("import is deduplicated, searchable and progress survives restart", async () => {
  const dir = await mkdtemp(join(tmpdir(), "aireader-test-"));
  const pdf = await PDFDocument.create();
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  pdf.addPage().drawText("Transformer memory and inference architecture.", {
    x: 30,
    y: 700,
    font,
  });
  pdf.addPage();
  const bytes = Buffer.from(await pdf.save());
  const library = new Library(dir);
  try {
    const book = await library.import(bytes, "Example.pdf");
    expect((await library.import(bytes, "Duplicate.pdf")).id).toBe(book.id);
    const parsed = await library.waitForBook(book.id);
    expect(parsed.error).toBeUndefined();
    expect(library.book(book.id)).toMatchObject({
      status: "ready",
      pages: 2,
      textPages: 1,
    });
    const hits = library.search(book.id, "memory");
    expect(hits).toHaveLength(1);
    expect(hits[0].anchor.page).toBe(1);
    library.progress(book.id, 2);
    library.addBookmark(book.id, 2, "Read again");
    library.close();
    const reopened = new Library(dir);
    expect(reopened.book(book.id).progress).toBe(2);
    expect(reopened.bookmarks(book.id)[0].note).toBe("Read again");
    reopened.close();
  } finally {
    library.close();
    await rm(dir, { recursive: true, force: true });
  }
}, 20000);
