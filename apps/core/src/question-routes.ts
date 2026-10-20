import type { IncomingMessage, ServerResponse } from "node:http";
import { z } from "zod";
import { jsonBody, send } from "./http";
import type { Questions } from "./questions";

export async function handleQuestionRoutes(req: IncomingMessage, res: ServerResponse, parts: string[], questions: Questions) {
  if (parts[1] === "questions" && parts.length === 2 && req.method === "GET") {
    send(res, questions.list()); return true;
  }
  if (parts[1] !== "books" || !parts[2] || parts[3] !== "questions" || !parts[4] || parts.length !== 6) return false;
  const [, , bookId, , questionId, operation] = parts;
  if (operation === "visit" && req.method === "POST") {
    z.object({}).strict().parse(await jsonBody(req));
    send(res, questions.visit(bookId, questionId)); return true;
  }
  if (operation === "material-plan" && req.method === "POST") {
    const input = z.object({ additionalIds: z.array(z.string().min(1).max(100).regex(/^[a-zA-Z0-9_-]+$/)).max(20).default([]) }).strict().parse(await jsonBody(req));
    send(res, questions.plan(bookId, questionId, input.additionalIds)); return true;
  }
  if (operation === "material-review" && req.method === "POST") {
    send(res, await questions.review(bookId, questionId, await jsonBody(req, 4 * 12 * 1024 * 1024 + 1024 * 1024)), 201); return true;
  }
  return false;
}
