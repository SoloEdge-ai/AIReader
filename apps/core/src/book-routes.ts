import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import type { IncomingMessage, ServerResponse } from "node:http";
import { z } from "zod";
import {
  type Book,
} from "../../../packages/protocol/src";
import { body, jsonBody, send } from "./http";
import type { Library } from "./library";
import type { Preferences } from "./preferences";

/** Authenticated book-library HTTP contract; all persistent writes remain in Library. */
export async function handleBookCollectionRoutes(
  req: IncomingMessage,
  res: ServerResponse,
  parts: string[],
  library: Library,
): Promise<boolean> {
  if (parts[1] !== "books" || parts.length !== 2) return false;
  if (req.method === "GET") {
    send(res, library.books());
    return true;
  }
  if (req.method === "POST") {
    const filename = decodeURIComponent(
      String(req.headers["x-filename"] ?? "Document.pdf"),
    ).slice(0, 300);
    send(
      res,
      await library.import(await body(req, 256 * 1024 * 1024), filename),
      201,
    );
    return true;
  }
  return false;
}

/** Routes that require the server to have resolved this exact book first. */
export async function handleBookReaderRoutes(
  req: IncomingMessage,
  res: ServerResponse,
  book: Book,
  parts: string[],
  url: URL,
  library: Library,
  preferences: Preferences,
): Promise<boolean> {
  const bookId = book.id;
  if (parts[3] === "preferences" && parts.length === 4) {
    if (req.method === "POST") preferences.saveForBook(bookId, await jsonBody(req));
    else if (req.method !== "GET") {
      send(res, { error: "Method not allowed" }, 405);
      return true;
    }
    send(res, preferences.forBook(bookId));
    return true;
  }
  if (parts[3] === "open" && req.method === "POST") {
    send(res, library.open(bookId));
    return true;
  }
  if (parts.length === 3) {
    send(res, book);
    return true;
  }
  if (parts[3] === "file" && req.method === "GET") {
    const file = library.file(bookId);
    const size = (await stat(file)).size;
    res.writeHead(200, {
      "Content-Type": "application/pdf",
      "Content-Length": size,
      "Cache-Control": "private, max-age=60",
    });
    createReadStream(file)
      .on("error", () => res.destroy())
      .pipe(res);
    return true;
  }
  if (parts[3] === "search") {
    send(
      res,
      library.search(bookId, (url.searchParams.get("q") ?? "").slice(0, 1000)),
    );
    return true;
  }
  if (parts[3] === "passages") {
    send(
      res,
      library.passages(
        bookId,
        url.searchParams.has("page")
          ? Number(url.searchParams.get("page"))
          : undefined,
      ),
    );
    return true;
  }
  if (parts[3] === "progress" && req.method === "POST") {
    const data = z
      .object({
        page: z.number().int().min(1).max(Math.max(book.pages, 1)),
      })
      .parse(await jsonBody(req));
    library.progress(bookId, data.page);
    send(res, { ok: true });
    return true;
  }
  if (parts[3] === "bookmarks") {
    if (req.method === "POST") {
      const data = z
        .object({
          page: z.number().int().min(1).max(Math.max(book.pages, 1)),
          note: z.string().max(1000),
        })
        .parse(await jsonBody(req));
      send(res, library.addBookmark(bookId, data.page, data.note));
      return true;
    }
    if (req.method === "DELETE") {
      library.removeBookmark(bookId, parts[4]);
      send(res, { ok: true });
      return true;
    }
    send(res, library.bookmarks(bookId));
    return true;
  }
  return false;
}
