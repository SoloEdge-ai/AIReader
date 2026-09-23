import { test, expect } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Library } from "../apps/core/src/library";
import {
  buildContext,
  renderPrompt,
  validateCitations,
} from "../apps/core/src/context";
import type { Book, ChatTurn } from "../packages/protocol/src";
import { PDFDocument, StandardFonts } from "pdf-lib";
test("50 turns remain bounded and unknown or cross-book citations are not clickable", async () => {
  const dir = await mkdtemp(join(tmpdir(), "aireader-context-"));
  const library = new Library(dir);
  try {
    const book: Book = {
      id: "a",
      fingerprint: "f",
      title: "Test",
      pages: 10,
      parsedPages: 4,
      textPages: 4,
      status: "parsing",
      progress: 1,
      createdAt: "",
      chapters: [],
      labels: [],
      indexVersion: 1,
    };
    library.store.put("book", "a", "a", book);
    for (let i = 0; i < 50; i++)
      library.store.put("turn", String(i), "a", {
        id: String(i),
        bookId: "a",
        sessionId: "s",
        question: "历史问题".repeat(300),
        answer: "历史回答".repeat(1000),
        createdAt: String(i).padStart(2, "0"),
        status: "complete",
      } as ChatTurn);
    const reading = {
      bookId: "a",
      page: 3,
      selection: "",
      scope: "auto" as const,
    };
    const context = buildContext(library, reading, "这里是什么？", "s");
    reading.page = 9;
    expect(context.reading.page).toBe(3);
    expect(context.estimatedTokens).toBeLessThanOrEqual(12000);
    expect(renderPrompt(context, "这里是什么？").length).toBeLessThan(36000);
    expect(context.coverage).toContain("4 / 10");
    expect(validateCitations("错误 [[other:2:0]]", context).citations).toEqual(
      [],
    );
  } finally {
    library.close();
    await rm(dir, { recursive: true, force: true });
  }
});
test("late chapter search hits survive the context budget and blank pages remain uncovered", async () => {
  const dir = await mkdtemp(join(tmpdir(), "aireader-evidence-"));
  const library = new Library(dir);
  try {
    const pdf = await PDFDocument.create();
    const font = await pdf.embedFont(StandardFonts.Helvetica);
    for (let page = 1; page <= 10; page++) {
      const p = pdf.addPage();
      for (let line = 0; line < 80; line++)
        p.drawText(
          `Background discussion ${page} ${line}: unrelated scheduling and memory operations.`,
          { font, x: 20, y: 800 - line * 9, size: 8 },
        );
      if (page === 10)
        p.drawText("ZEBRACACHE is the unique result on this final page.", {
          font,
          x: 20,
          y: 50,
          size: 8,
        });
    }
    pdf.addPage();
    const book = await library.import(
      Buffer.from(await pdf.save()),
      "Long chapter.pdf",
    );
    const parsed = await library.waitForBook(book.id);
    expect(parsed.error).toBeUndefined();
    const context = buildContext(
      library,
      { bookId: book.id, page: 1, scope: "chapter", selection: "" },
      "ZEBRACACHE",
      "session",
    );
    expect(context.evidence.some((p) => p.text.includes("ZEBRACACHE"))).toBe(
      true,
    );
    expect(context.estimatedTokens).toBeLessThanOrEqual(12000);
    expect(context.coverage).toContain("10 / 11");
    const global = buildContext(
      library,
      { bookId: book.id, page: 1, scope: "book", selection: "" },
      "全书总结",
      "s",
    );
    expect(global.coverage).toContain("部分总结");
  } finally {
    library.close();
    await rm(dir, { recursive: true, force: true });
  }
});
