import type { IncomingMessage, ServerResponse } from "node:http";
import { z } from "zod";
import { ModelSelectionSchema } from "../../../packages/protocol/src";
import type { AiService } from "./ai-service";
import { jsonBody, send } from "./http";
import type { IndexService } from "./indexer";

/** Book-scoped semantic index API; resumes use the task's frozen model choice. */
export async function handleBookIndexRoutes(
  req: IncomingMessage,
  res: ServerResponse,
  bookId: string,
  parts: string[],
  indexer: IndexService,
  ai: AiService,
): Promise<boolean> {
  if (parts[3] !== "index") return false;
  if (req.method === "GET") {
    send(res, { jobs: indexer.list(bookId), nodes: indexer.nodes(bookId) });
    return true;
  }
  if (req.method === "POST" && parts[4]) {
    const value = z
      .object({ action: z.enum(["pause", "cancel", "resume"]) })
      .parse(await jsonBody(req));
    if (value.action === "resume") {
      const job = indexer.list(bookId).find((item) => item.id === parts[4]);
      if (!job?.model || !job.effort)
        throw new Error("旧索引任务未记录模型，请创建新的索引任务");
      await ai.selectModel({ model: job.model, effort: job.effort });
    }
    send(res, indexer.control(bookId, parts[4], value.action));
    return true;
  }
  if (req.method === "POST") {
    const value = z
      .object({
        page: z.number().int().positive(),
        full: z.boolean().default(false),
        model: z.string().max(100).optional(),
        effort: z.string().max(30).optional(),
      })
      .parse(await jsonBody(req));
    const chosen = await ai.selectModel(
      value.model ? ModelSelectionSchema.parse(value) : undefined,
    );
    send(
      res,
      indexer.start(
        bookId,
        value.page,
        value.full,
        chosen.model,
        chosen.effort,
      ),
    );
    return true;
  }
  return false;
}
