import { createReadStream } from "node:fs";
import type { IncomingMessage, ServerResponse } from "node:http";
import { z } from "zod";
import { jsonBody, send } from "./http";
import type { BookTools } from "./tools";

/** Book-scoped tool API. The service owns turn checks, sandbox state and file paths. */
export async function handleBookToolRoutes(
  req: IncomingMessage,
  res: ServerResponse,
  bookId: string,
  parts: string[],
  url: URL,
  tools: BookTools,
): Promise<boolean> {
  if (parts[3] === "tools") {
    if (req.method === "GET") {
      send(res, { ...tools.status(bookId), files: await tools.files(bookId) });
      return true;
    }
    if (req.method === "POST" && parts[4] === "verify") {
      send(res, await tools.verify(bookId));
      return true;
    }
    if (req.method === "POST" && parts[4] === "run") {
      const value = z
        .object({
          turnId: z.string(),
          script: z.string().min(1).max(12000),
        })
        .parse(await jsonBody(req));
      send(res, await tools.run(bookId, value.turnId, value.script));
      return true;
    }
    if (req.method === "POST" && parts[4] === "stop") {
      const value = z.object({ turnId: z.string() }).parse(await jsonBody(req));
      await tools.cancelForBook(bookId, value.turnId);
      send(res, { ok: true });
      return true;
    }
    if (req.method === "POST" && parts[4] === "draft") {
      const value = z
        .object({ task: z.string().min(1).max(2000) })
        .parse(await jsonBody(req));
      send(res, await tools.draft(bookId, value.task));
      return true;
    }
  }
  if (parts[3] === "generated" && req.method === "GET") {
    const name = url.searchParams.get("name") ?? "";
    const file = await tools.file(bookId, name);
    res.setHeader("Content-Type", "application/octet-stream");
    res.setHeader(
      "Content-Disposition",
      "attachment; filename*=UTF-8''" + encodeURIComponent(name || "file"),
    );
    createReadStream(file)
      .on("error", () => res.destroy())
      .pipe(res);
    return true;
  }
  return false;
}
