import type { IncomingMessage, ServerResponse } from "node:http";
import { jsonBody, send } from "./http";
import type { Preferences } from "./preferences";

/** Authenticated global preference contract; book scope is handled in book-routes. */
export async function handleGlobalPreferenceRoutes(
  req: IncomingMessage,
  res: ServerResponse,
  parts: string[],
  preferences: Preferences,
): Promise<boolean> {
  if (parts.length !== 2) return false;
  if (parts[1] === "tool-preferences") {
    if (req.method === "PUT") preferences.saveTools(await jsonBody(req));
    else if (req.method !== "GET") {
      send(res, { error: "Method not allowed" }, 405);
      return true;
    }
    send(res, preferences.tools());
    return true;
  }
  if (parts[1] === "preferences") {
    if (req.method === "POST") preferences.saveReader(await jsonBody(req));
    else if (req.method !== "GET") {
      send(res, { error: "Method not allowed" }, 405);
      return true;
    }
    send(res, preferences.reader());
    return true;
  }
  return false;
}
