import { readFile } from "node:fs/promises";
import type { IncomingMessage, ServerResponse } from "node:http";
import { z } from "zod";
import { WorkspaceCommandV2Schema } from "../../../packages/protocol/src/workspace-commands";
import { body, jsonBody, send } from "./http";
import type { Notes } from "./notes";
import type { QuestionMaterials } from "./question-materials";
import type { WorkspaceArchives } from "./workspace-archive";
import { MAX_WORKSPACE_ARCHIVE_BYTES } from "./workspace-archive";
import type { WorkspaceAssets } from "./workspace-assets";
import type { Workspaces } from "./workspace";

export type WorkspaceRouteServices = {
  workspaces: Workspaces;
  assets: WorkspaceAssets;
  archives: WorkspaceArchives;
  materials: QuestionMaterials;
  notes: Notes;
};

/** Authenticated workspace routes that do not require a preloaded book. */
export async function handleGlobalWorkspaceRoutes(
  req: IncomingMessage, res: ServerResponse, parts: string[], services: WorkspaceRouteServices,
): Promise<boolean> {
  if (parts[1] === "v2" && parts[2] === "books" && parts[3] && parts[4] === "workspace" &&
      parts[5] === "commands" && parts.length === 6 && req.method === "POST") {
    const batch = WorkspaceCommandV2Schema.parse(await jsonBody(req, 8 * 1024 * 1024));
    await services.assets.validateCommandObjects(parts[3], batch, 2);
    send(res, services.workspaces.commandV2(parts[3], batch));
    return true;
  }
  if (parts[1] === "workspace-archives" && parts.length === 2 && req.method === "POST") {
    send(res, await services.archives.restore(await body(req, MAX_WORKSPACE_ARCHIVE_BYTES)), 201);
    return true;
  }
  return false;
}

/** Book-scoped workspace contract: commands, assets, archives, and frozen question materials. */
export async function handleBookWorkspaceRoutes(
  req: IncomingMessage, res: ServerResponse, bookId: string, parts: string[], url: URL,
  services: WorkspaceRouteServices,
): Promise<boolean> {
  if (parts[3] === "workspace" && parts[4] === "archive" && parts.length === 5 && req.method === "GET") {
    const bytes = await services.archives.export(bookId);
    res.writeHead(200, {
      "Content-Type": "application/zip",
      "Content-Disposition": `attachment; filename="AIReader-${bookId}.aireader"`,
      "Content-Length": bytes.length,
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
    }).end(bytes);
    return true;
  }
  if (parts[3] === "workspace" && parts.length === 4) {
    if (req.method === "GET") send(res, services.workspaces.get(bookId));
    else if (req.method === "POST")
      send(res, { error: "此版本不接受整份工作区写入，请更新 AIReader" }, 409);
    else send(res, { error: "不支持的操作" }, 405);
    return true;
  }
  if (parts[3] === "workspace" && parts[4] === "commands" && parts.length === 5 && req.method === "POST") {
    const batch = await services.assets.validateCommandObjects(bookId, await jsonBody(req, 8 * 1024 * 1024));
    send(res, services.workspaces.command(bookId, batch));
    return true;
  }
  if (parts[3] === "workspace" && parts[4] === "cards" && parts[5] &&
      parts[6] === "note" && parts.length === 7 && req.method === "POST") {
    z.object({}).strict().parse(await jsonBody(req));
    const result = services.notes.promoteCard(bookId, parts[5]);
    send(res, result.note, result.created ? 201 : 200);
    return true;
  }
  if (parts[3] === "workspace" && parts[4] === "camera" && parts.length === 5 && req.method === "PUT") {
    send(res, services.workspaces.camera(bookId, await jsonBody(req)));
    return true;
  }
  if (parts[3] === "workspace" && parts[4] === "region-excerpts" && parts.length === 5 && req.method === "POST") {
    send(res, await services.assets.createRegion(bookId, await jsonBody(req, 12 * 1024 * 1024)), 201);
    return true;
  }
  if (parts[3] === "workspace-assets" && parts[4] && parts.length === 5 && req.method === "GET") {
    const bytes = await services.assets.read(bookId, parts[4]);
    res.writeHead(200, {
      "Content-Type": "image/png", "Content-Length": bytes.length,
      "Cache-Control": "private, max-age=31536000, immutable", "X-Content-Type-Options": "nosniff",
    }).end(bytes);
    return true;
  }
  if (parts[3] === "question-materials") {
    if (req.method === "POST" && parts.length === 4) {
      send(res, await services.materials.create(bookId,
        await jsonBody(req, 4 * 12 * 1024 * 1024 + 1024 * 1024)), 201);
      return true;
    }
    const sessionId = url.searchParams.get("session") ?? "";
    if (req.method === "GET" && parts[4] && parts.length === 5) {
      send(res, services.materials.get(bookId, sessionId, parts[4]));
      return true;
    }
    if (req.method === "GET" && parts[4] && parts[5] === "images" && parts[6] && parts.length === 7) {
      const path = services.materials.image(bookId, sessionId, parts[4], parts[6]);
      const bytes = await readFile(path);
      res.writeHead(200, { "Content-Type": "image/png", "Content-Length": bytes.length,
        "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" }).end(bytes);
      return true;
    }
  }
  return false;
}
