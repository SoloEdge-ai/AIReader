import { readFile } from "node:fs/promises";
import { resolve, basename } from "node:path";
import { Library } from "../apps/core/src/library";
const file = process.argv[2];
if (!file) throw new Error("Pass a local PDF path");
const library = new Library(resolve(".local/smoke-library"));
const start = Date.now();
try {
  const book = await library.import(await readFile(file), basename(file));
  const result = await library.waitForBook(book.id);
  console.log(
    JSON.stringify({
      id: result.id,
      pages: result.pages,
      textPages: result.textPages,
      chapters: result.chapters.length,
      status: result.status,
      error: result.error,
      passages: library.passages(book.id).length,
      searchHits: library.search(book.id, "推理 memory").length,
      elapsedMs: Date.now() - start,
    }),
  );
} finally {
  library.close();
}
