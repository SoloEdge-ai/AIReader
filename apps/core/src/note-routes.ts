import { createReadStream } from "node:fs";
import type { IncomingMessage, ServerResponse } from "node:http";
import type { Notes } from "./notes";
import { body, jsonBody, send } from "./http";

/** Owns the book-scoped Note/annotation HTTP contract, including exports and image assets. */
export async function handleNoteRoutes(
  req: IncomingMessage,
  res: ServerResponse,
  bookId: string,
  parts: string[],
  notes: Notes,
): Promise<boolean> {
  if (parts[3] === "annotations" || parts[3] === "notes") {
    const kind = parts[3] === "annotations" ? "annotation" : "note";
    if (parts[4]) {
      if (kind === "note" && req.method === "GET" && parts[5] === "export" && parts.length === 6) {
        const exported = await notes.export(bookId, parts[4]);
        res.writeHead(200, {
          "Content-Type": "application/zip",
          "Content-Disposition": `attachment; filename="${exported.filename}"`,
          "Content-Length": exported.buffer.length,
          "Cache-Control": "no-store",
          "X-Content-Type-Options": "nosniff",
        }).end(exported.buffer);
      } else if (req.method === "POST" && kind === "annotation" && parts[5] === "note")
        send(res, notes.comment(bookId, parts[4]));
      else if (req.method === "DELETE")
        send(res, notes.remove(bookId, parts[4], kind));
      else if (req.method === "POST" && parts[5] === "restore")
        send(res, notes.remove(bookId, parts[4], kind, true));
      else if (req.method === "POST")
        send(res, kind === "annotation"
          ? notes.updateAnnotation(bookId, parts[4], await jsonBody(req))
          : notes.updateNote(bookId, parts[4], await jsonBody(req)));
      else throw new Error("不支持的操作");
    } else if (req.method === "POST")
      send(res, kind === "annotation"
        ? await notes.createAnnotation(bookId, JSON.parse((await body(req, 12 * 1024 * 1024)).toString()))
        : notes.createNote(bookId), 201);
    else send(res, kind === "annotation" ? notes.annotations(bookId) : notes.list(bookId));
    return true;
  }
  if (parts[3] === "annotation-assets" && parts[4] && req.method === "GET") {
    const file = notes.asset(bookId, parts[4]);
    res.writeHead(200, {
      "Content-Type": "image/png",
      "X-Content-Type-Options": "nosniff",
      "Cache-Control": "private, max-age=3600",
    });
    createReadStream(file).on("error", () => res.destroy()).pipe(res);
    return true;
  }
  return false;
}
