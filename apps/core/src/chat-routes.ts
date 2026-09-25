import { createReadStream } from "node:fs";
import type { IncomingMessage, ServerResponse } from "node:http";
import { z } from "zod";
import {
  ChatImageInputSchema,
  MAX_CHAT_IMAGE_BYTES,
  MAX_CHAT_IMAGES,
  ModelSelectionSchema,
  ReadingSnapshotSchema,
  type ModelSelection,
} from "../../../packages/protocol/src";
import type { ChatService } from "./chat";
import { jsonBody, send } from "./http";
import type { Notes } from "./notes";

export type ChatRouteServices = {
  chat: ChatService;
  notes: Notes;
  selectModel: (selection?: ModelSelection) => Promise<ModelSelection>;
};

/** Authenticated, book-scoped chat HTTP contract; model, evidence and storage stay in Core services. */
export async function handleBookChatRoutes(
  req: IncomingMessage,
  res: ServerResponse,
  bookId: string,
  bookPages: number,
  parts: string[],
  url: URL,
  services: ChatRouteServices,
): Promise<boolean> {
  if (parts[3] === "chat-images" && parts[4] && req.method === "GET") {
    const file = services.chat.images.asset(bookId, parts[4]);
    res.writeHead(200, {
      "Content-Type": "image/png",
      "X-Content-Type-Options": "nosniff",
      "Cache-Control": "private, max-age=3600",
    });
    createReadStream(file).on("error", () => res.destroy()).pipe(res);
    return true;
  }
  if (parts[3] === "memory" && req.method === "POST") {
    const value = z
      .object({ sessionId: z.string().max(100), goal: z.string().max(600) })
      .parse(await jsonBody(req));
    services.chat.setGoal(bookId, value.sessionId, value.goal);
    send(res, { ok: true });
    return true;
  }
  if (parts[3] === "turns") {
    if (
      req.method === "POST" &&
      parts[4] &&
      parts[5] === "note" &&
      parts.length === 6
    ) {
      z.object({}).strict().parse(await jsonBody(req));
      const saved = services.notes.fromAnswer(bookId, parts[4]);
      send(res, saved, saved.created ? 201 : 200);
      return true;
    }
    if (req.method === "POST" && parts[5] === "cancel") {
      services.chat.cancel(bookId, parts[4]);
      send(res, { ok: true });
      return true;
    }
    if (req.method === "POST") {
      const value = z
        .object({
          reading: ReadingSnapshotSchema,
          question: z.string().min(1).max(6000),
          images: ChatImageInputSchema.array().max(MAX_CHAT_IMAGES).default([]),
          materialIds: z.array(z.string().uuid()).max(20).default([]),
          sessionId: z.string().min(1).max(100),
          model: z.string().max(100).optional(),
          effort: z.string().max(30).optional(),
        })
        .parse(
          await jsonBody(
            req,
            MAX_CHAT_IMAGES * Math.ceil(MAX_CHAT_IMAGE_BYTES / 3) * 4 +
              1024 * 1024,
          ),
        );
      if (value.reading.bookId !== bookId || value.reading.page > bookPages)
        throw new Error("阅读位置与书籍不匹配");
      const chosen = await services.selectModel(
        ModelSelectionSchema.parse({ model: value.model, effort: value.effort }),
      );
      send(
        res,
        services.chat.start(
          value.reading,
          value.question,
          value.sessionId,
          chosen.model,
          chosen.effort,
          value.images,
          value.materialIds,
        ),
        202,
      );
      return true;
    }
    send(
      res,
      services.chat.list(bookId, url.searchParams.get("session") ?? undefined),
    );
    return true;
  }
  if (parts[3] === "sessions") {
    if (req.method === "POST") {
      if (parts[4])
        send(
          res,
          services.chat.renameSession(
            bookId,
            parts[4],
            z
              .object({ title: z.string().trim().min(1).max(100) })
              .parse(await jsonBody(req)).title,
          ),
        );
      else send(res, services.chat.createSession(bookId));
    } else send(res, services.chat.sessions(bookId));
    return true;
  }
  return false;
}
