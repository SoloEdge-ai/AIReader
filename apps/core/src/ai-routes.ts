import type { IncomingMessage, ServerResponse } from "node:http";
import { ModelSelectionSchema } from "../../../packages/protocol/src";
import type { AiService } from "./ai-service";
import { jsonBody, send } from "./http";

/** Authenticated global AI HTTP contract; lifecycle and model policy live in AiService. */
export async function handleAiRoutes(
  req: IncomingMessage,
  res: ServerResponse,
  parts: string[],
  ai: AiService,
): Promise<boolean> {
  if (parts[1] !== "ai") return false;
  const endpoint = parts[2];
  if (endpoint === "status") {
    send(res, ai.codex.info);
    return true;
  }
  if (endpoint === "runtime") {
    if (req.method === "POST" && parts[3] === "cancel")
      send(res, await ai.cancelRuntime());
    else if (req.method === "POST") send(res, await ai.prepareRuntime());
    else send(res, ai.runtime.state);
    return true;
  }
  if (endpoint === "selection") {
    if (req.method === "POST")
      await ai.saveModel(ModelSelectionSchema.parse(await jsonBody(req)));
    send(res, ai.selectedModel());
    return true;
  }
  if (endpoint === "models") {
    send(res, await ai.codex.models());
    return true;
  }
  if (req.method === "POST" && endpoint === "connect") {
    await ai.codex.connect();
    send(res, ai.codex.info);
    return true;
  }
  if (req.method === "POST" && endpoint === "login") {
    send(res, await ai.codex.login());
    return true;
  }
  if (req.method === "POST" && endpoint === "login-cancel") {
    await ai.codex.cancelLogin();
    send(res, ai.codex.info);
    return true;
  }
  if (req.method === "POST" && endpoint === "logout") {
    send(res, await ai.logout());
    return true;
  }
  if (req.method === "POST" && endpoint === "disconnect") {
    send(res, await ai.disconnect());
    return true;
  }
  return false;
}
