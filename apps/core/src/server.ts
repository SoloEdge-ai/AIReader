import { createServer, IncomingMessage, ServerResponse } from "node:http";
import { readFile, stat } from "node:fs/promises";
import { createReadStream } from "node:fs";
import { resolve, extname, relative, isAbsolute } from "node:path";
import { randomBytes } from "node:crypto";
import { WebSocketServer, WebSocket } from "ws";
import { z } from "zod";
import { Library } from "./library";
import { CodexAdapter } from "./codex";
import { ChatService } from "./chat";
import { IndexService } from "./indexer";
import { BookTools } from "./tools";
import {
  ToolPreferencesSchema,
  ReadingSnapshotSchema,
  ReaderPreferencesSchema,
  ModelSelectionSchema,
  ChatImageInputSchema,
  MAX_CHAT_IMAGES,
  MAX_CHAT_IMAGE_BYTES,
  type ModelSelection,
} from "../../../packages/protocol/src";
import { RuntimeManager } from "./runtime";
import { Notes } from "./notes";
import { Workspaces, WorkspaceConflict, WorkspacePayloadError } from "./workspace";
import { WorkspaceCommandV2Schema } from "../../../packages/protocol/src/workspace-commands";
import { WorkspaceAssets } from "./workspace-assets";
import { QuestionMaterials } from "./question-materials";
import {
  WorkspaceArchives,
  MAX_WORKSPACE_ARCHIVE_BYTES,
} from "./workspace-archive";
import { join } from "node:path";
import type { CoreEvent } from "../../../packages/protocol/src/index";
export async function body(req: IncomingMessage, limit = 1024 * 1024) {
  const chunks: Buffer[] = [];
  let length = 0;
  for await (const chunk of req) {
    length += chunk.length;
    if (length > limit) throw new Error("文件或请求过大");
    chunks.push(Buffer.from(chunk));
  }
  return Buffer.concat(chunks);
}
export async function jsonBody(req: IncomingMessage, limit?: number) {
  return JSON.parse((await body(req, limit)).toString());
}
export function send(res: ServerResponse, value: unknown, status = 200) {
  res
    .writeHead(status, {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
    })
    .end(JSON.stringify(value));
}
export function createCore(
  directory: string,
  webRoot: string,
  testLaunch?: ConstructorParameters<typeof CodexAdapter>[2],
) {
  const token = randomBytes(32).toString("hex");
  const sockets = new WebSocketServer({ noServer: true });
  const emit = (event: CoreEvent) => {
    for (const client of sockets.clients)
      if (client.readyState === WebSocket.OPEN)
        client.send(JSON.stringify(event));
  };
  const library = new Library(directory, emit);
  const notes = new Notes(library);
  const workspaces = new Workspaces(library);
  const workspaceAssets = new WorkspaceAssets(library, workspaces);
  const questionMaterials = new QuestionMaterials(library, workspaces, notes, workspaceAssets);
  const workspaceArchives = new WorkspaceArchives(library);
  library.resume();
  const runtime = new RuntimeManager(directory, (data) =>
    emit({ type: "runtime", data }),
  );
  const codex = new CodexAdapter(
    join(directory, "control"),
    () => runtime.executable(),
    testLaunch,
  );
  const chat = new ChatService(library, codex, questionMaterials);
  const indexer = new IndexService(library, codex);
  indexer.pauseAll();
  const bookTools = new BookTools(library, codex);
  codex.on("account", (data) => emit({ type: "account", data }));
  codex.on("disconnected", () => emit({ type: "account", data: codex.info }));
  let closed = false;
  void runtime.inspect().then((state) => {
    if (!closed && state.status === "ready")
      void codex.connect().catch(() => {});
  });
  async function selection(value?: ModelSelection) {
    await codex.connect();
    if (!codex.info.account) throw new Error("请先登录 ChatGPT");
    const chosen =
      value ?? library.store.get<ModelSelection>("setting", "model");
    if (!chosen) throw new Error("请先选择模型和思考强度");
    const models = await codex.models(),
      model = models.find((m) => m.model === chosen.model);
    if (
      !model ||
      !model.supportedReasoningEfforts.some(
        (e) => e.reasoningEffort === chosen.effort,
      )
    )
      throw new Error("所选模型或思考强度已不可用，请重新选择");
    return chosen;
  }
  const authenticated = (req: IncomingMessage) =>
    req.headers.cookie
      ?.split(";")
      .some((x) => x.trim() === `aireader=${token}`);
  const allowedOrigin = (req: IncomingMessage) =>
    req.headers.origin === `http://${req.headers.host}` ||
    (!process.env.AIREADER_WEB &&
      req.headers.origin === "http://127.0.0.1:5173");
  const server = createServer(async (req, res) => {
    try {
      if (!req.headers.host?.match(/^127\.0\.0\.1:\d+$/)) {
        send(res, { error: "Invalid host" }, 403);
        return;
      }
      if (req.headers.origin && !allowedOrigin(req)) {
        send(res, { error: "Invalid origin" }, 403);
        return;
      }
      if (allowedOrigin(req)) {
        res.setHeader("Access-Control-Allow-Origin", req.headers.origin!);
        res.setHeader("Access-Control-Allow-Credentials", "true");
        res.setHeader("Vary", "Origin");
      }
      if (req.method === "OPTIONS") {
        res.setHeader(
          "Access-Control-Allow-Headers",
          "Content-Type, X-Filename",
        );
        res.setHeader("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE");
        res.writeHead(204).end();
        return;
      }
      const url = new URL(req.url ?? "/", "http://localhost");
      const parts = url.pathname.split("/").filter(Boolean);
      if (url.pathname === "/api/session" && req.method === "POST") {
        if (!allowedOrigin(req)) {
          send(res, { error: "Origin required" }, 403);
          return;
        }
        res.setHeader(
          "Set-Cookie",
          `aireader=${token}; HttpOnly; SameSite=Strict; Path=/`,
        );
        send(res, { ok: true });
        return;
      }
      if (parts[0] === "api") {
        if (
          !authenticated(req) ||
          (req.method !== "GET" && !allowedOrigin(req))
        ) {
          send(res, { error: "Session required" }, 401);
          return;
        }
        if (parts[1] === "health") {
          send(res, { ok: true });
          return;
        }
        if (parts[1] === "v2" && parts[2] === "books" && parts[3] && parts[4] === "workspace" && parts[5] === "commands" && parts.length === 6 && req.method === "POST") {
          const batch = WorkspaceCommandV2Schema.parse(await jsonBody(req, 8 * 1024 * 1024));
          await workspaceAssets.validateCommandObjects(parts[3], batch, 2);
          send(res, workspaces.commandV2(parts[3], batch));
          return;
        }
        if (parts[1] === "tool-preferences" && parts.length === 2) {
          if (req.method === "PUT")
            library.store.put(
              "setting",
              "reader-tools",
              "",
              ToolPreferencesSchema.parse(await jsonBody(req)),
            );
          if (req.method !== "GET" && req.method !== "PUT") {
            send(res, { error: "Method not allowed" }, 405);
            return;
          }
          send(
            res,
            ToolPreferencesSchema.parse(
              library.store.get("setting", "reader-tools") ?? {},
            ),
          );
          return;
        }
        if (parts[1] === "preferences") {
          if (req.method === "POST")
            library.store.put(
              "setting",
              "reader",
              "",
              ReaderPreferencesSchema.parse(await jsonBody(req)),
            );
          send(
            res,
            ReaderPreferencesSchema.parse(
              library.store.get("setting", "reader") ?? {},
            ),
          );
          return;
        }
        if (parts[1] === "ai") {
          const endpoint = parts[2];
          if (endpoint === "status") {
            send(res, codex.info);
            return;
          }
          if (endpoint === "runtime") {
            if (req.method === "POST" && parts[3] === "cancel")
              await runtime.cancel();
            else if (req.method === "POST") {
              chat.cancelAll();
              indexer.pauseAll();
              bookTools.stopAll();
              await codex.disconnect();
              void runtime.prepare();
            }
            send(res, runtime.state);
            return;
          }
          if (endpoint === "selection") {
            if (req.method === "POST") {
              const choice = await selection(
                ModelSelectionSchema.parse(await jsonBody(req)),
              );
              library.store.put("setting", "model", "", choice);
            }
            send(res, library.store.get("setting", "model") ?? null);
            return;
          }
          if (endpoint === "models") {
            send(res, await codex.models());
            return;
          }
          if (req.method === "POST" && endpoint === "connect") {
            await codex.connect();
            send(res, codex.info);
            return;
          }
          if (req.method === "POST" && endpoint === "login") {
            send(res, await codex.login());
            return;
          }
          if (req.method === "POST" && endpoint === "login-cancel") {
            await codex.cancelLogin();
            send(res, codex.info);
            return;
          }
          if (
            req.method === "POST" &&
            (endpoint === "logout" || endpoint === "disconnect")
          ) {
            chat.cancelAll();
            indexer.pauseAll();
            bookTools.stopAll();
            if (endpoint === "logout") {
              await codex.logout();
              library.store.remove("setting", "model");
            } else await codex.disconnect();
            send(res, codex.info);
            return;
          }
        }
        if (
          parts[1] === "workspace-archives" &&
          parts.length === 2 &&
          req.method === "POST"
        ) {
          send(
            res,
            await workspaceArchives.restore(
              await body(req, MAX_WORKSPACE_ARCHIVE_BYTES),
            ),
            201,
          );
          return;
        }
        if (parts[1] === "books" && parts.length === 2) {
          if (req.method === "GET") {
            send(res, library.books());
            return;
          }
          if (req.method === "POST") {
            send(
              res,
              await library.import(
                await body(req, 256 * 1024 * 1024),
                decodeURIComponent(
                  String(req.headers["x-filename"] ?? "Document.pdf"),
                ).slice(0, 300),
              ),
              201,
            );
            return;
          }
        }
        if (parts[1] === "books" && parts[2]) {
          const id = parts[2];
          const book = library.book(id);
          if (
            parts[3] === "workspace" &&
            parts[4] === "archive" &&
            parts.length === 5 &&
            req.method === "GET"
          ) {
            const bytes = await workspaceArchives.export(id);
            res
              .writeHead(200, {
                "Content-Type": "application/zip",
                "Content-Disposition": `attachment; filename="AIReader-${id}.aireader"`,
                "Content-Length": bytes.length,
                "Cache-Control": "no-store",
                "X-Content-Type-Options": "nosniff",
              })
              .end(bytes);
            return;
          }
          if (parts[3] === "workspace" && parts.length === 4) {
            if (req.method === "GET") send(res, workspaces.get(id));
            else if (req.method === "POST")
              send(res, { error: "此版本不接受整份工作区写入，请更新 AIReader" }, 409);
            else send(res, { error: "不支持的操作" }, 405);
            return;
          }
          if (parts[3] === "workspace" && parts[4] === "commands" && parts.length === 5 && req.method === "POST") {
            const batch = await workspaceAssets.validateCommandObjects(id, await jsonBody(req, 8 * 1024 * 1024));
            send(res, workspaces.command(id, batch));
            return;
          }
          if (parts[3] === "workspace" && parts[4] === "camera" && parts.length === 5 && req.method === "PUT") {
            send(res, workspaces.camera(id, await jsonBody(req)));
            return;
          }
          if (parts[3] === "workspace" && parts[4] === "region-excerpts" && parts.length === 5 && req.method === "POST") {
            send(res, await workspaceAssets.createRegion(id, await jsonBody(req, 12 * 1024 * 1024)), 201);
            return;
          }
          if (parts[3] === "workspace-assets" && parts[4] && parts.length === 5 && req.method === "GET") {
            const bytes = await workspaceAssets.read(id, parts[4]);
            res.writeHead(200, {
              "Content-Type": "image/png", "Content-Length": bytes.length,
              "Cache-Control": "private, max-age=31536000, immutable", "X-Content-Type-Options": "nosniff",
            }).end(bytes);
            return;
          }
          if (parts[3] === "question-materials") {
            if (req.method === "POST" && parts.length === 4) {
              send(res, await questionMaterials.create(id,
                await jsonBody(req, 4 * 12 * 1024 * 1024 + 1024 * 1024)), 201);
              return;
            }
            const sessionId = url.searchParams.get("session") ?? "";
            if (req.method === "GET" && parts[4] && parts.length === 5) {
              send(res, questionMaterials.get(id, sessionId, parts[4]));
              return;
            }
            if (req.method === "GET" && parts[4] && parts[5] === "images" && parts[6] && parts.length === 7) {
              const path = questionMaterials.image(id, sessionId, parts[4], parts[6]);
              const bytes = await readFile(path);
              res.writeHead(200, { "Content-Type": "image/png", "Content-Length": bytes.length,
                "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" }).end(bytes);
              return;
            }
          }
          if (parts[3] === "annotations" || parts[3] === "notes") {
            const kind = parts[3] === "annotations" ? "annotation" : "note";
            if (parts[4]) {
              if (
                kind === "note" &&
                req.method === "GET" &&
                parts[5] === "export" &&
                parts.length === 6
              ) {
                const exported = await notes.export(id, parts[4]);
                res
                  .writeHead(200, {
                    "Content-Type": "application/zip",
                    "Content-Disposition": `attachment; filename="${exported.filename}"`,
                    "Content-Length": exported.buffer.length,
                    "Cache-Control": "no-store",
                    "X-Content-Type-Options": "nosniff",
                  })
                  .end(exported.buffer);
              } else if (req.method === "POST" && kind === "annotation" && parts[5] === "note")
                send(res, notes.comment(id, parts[4]));
              else if (req.method === "DELETE")
                send(res, notes.remove(id, parts[4], kind));
              else if (req.method === "POST" && parts[5] === "restore")
                send(res, notes.remove(id, parts[4], kind, true));
              else if (req.method === "POST")
                send(
                  res,
                  kind === "annotation"
                    ? notes.updateAnnotation(id, parts[4], await jsonBody(req))
                    : notes.updateNote(id, parts[4], await jsonBody(req)),
                );
              else throw new Error("不支持的操作");
            } else if (req.method === "POST")
              send(
                res,
                kind === "annotation"
                  ? await notes.createAnnotation(
                      id,
                      JSON.parse(
                        (await body(req, 12 * 1024 * 1024)).toString(),
                      ),
                    )
                  : notes.createNote(id),
                201,
              );
            else
              send(
                res,
                kind === "annotation" ? notes.annotations(id) : notes.list(id),
              );
            return;
          }
          if (
            parts[3] === "annotation-assets" &&
            parts[4] &&
            req.method === "GET"
          ) {
            const file = notes.asset(id, parts[4]);
            res.writeHead(200, {
              "Content-Type": "image/png",
              "X-Content-Type-Options": "nosniff",
              "Cache-Control": "private, max-age=3600",
            });
            createReadStream(file)
              .on("error", () => res.destroy())
              .pipe(res);
            return;
          }
          if (parts[3] === "preferences") {
            if (req.method === "POST")
              library.store.put(
                "reader",
                id,
                id,
                ReaderPreferencesSchema.parse(await jsonBody(req)),
              );
            send(
              res,
              ReaderPreferencesSchema.parse(
                library.store.get("reader", id) ?? {},
              ),
            );
            return;
          }
          if (parts[3] === "chat-images" && parts[4] && req.method === "GET") {
            const file = chat.images.asset(id, parts[4]);
            res.writeHead(200, {
              "Content-Type": "image/png",
              "X-Content-Type-Options": "nosniff",
              "Cache-Control": "private, max-age=3600",
            });
            createReadStream(file)
              .on("error", () => res.destroy())
              .pipe(res);
            return;
          }
          if (parts[3] === "open" && req.method === "POST") {
            book.lastOpenedAt = new Date().toISOString();
            library.store.put("book", id, id, book);
            send(res, book);
            return;
          }
          if (parts.length === 3) {
            send(res, book);
            return;
          }
          if (parts[3] === "tools") {
            if (req.method === "GET") {
              send(res, {
                ...bookTools.status(id),
                files: await bookTools.files(id),
              });
              return;
            }
            if (req.method === "POST" && parts[4] === "verify") {
              send(res, await bookTools.verify(id));
              return;
            }
            if (req.method === "POST" && parts[4] === "run") {
              const value = z
                .object({
                  turnId: z.string(),
                  script: z.string().min(1).max(12000),
                })
                .parse(await jsonBody(req));
              send(res, await bookTools.run(id, value.turnId, value.script));
              return;
            }
            if (req.method === "POST" && parts[4] === "stop") {
              const value = z
                .object({ turnId: z.string() })
                .parse(await jsonBody(req));
              const turn = library.store.get<
                import("../../../packages/protocol/src").ChatTurn
              >("turn", value.turnId);
              if (turn?.bookId !== id) throw new Error("会话与书籍不匹配");
              await bookTools.cancel(value.turnId);
              send(res, { ok: true });
              return;
            }
            if (req.method === "POST" && parts[4] === "draft") {
              const value = z
                .object({ task: z.string().min(1).max(2000) })
                .parse(await jsonBody(req));
              const result = await codex.answer(
                "生成一段完成用户任务的 PowerShell 脚本，只返回代码，不执行。工作区仅有 evidence.txt，输出文件必须写在当前目录。禁止联网、读取工作区以外文件和安装依赖。用户任务：" +
                  value.task,
              );
              send(res, {
                script: result.text
                  .replace(/^```(?:powershell|ps1)?\s*/, "")
                  .replace(/\s*```$/, ""),
              });
              return;
            }
          }
          if (parts[3] === "generated" && req.method === "GET") {
            const file = await bookTools.file(
              id,
              url.searchParams.get("name") ?? "",
            );
            res.setHeader("Content-Type", "application/octet-stream");
            res.setHeader(
              "Content-Disposition",
              "attachment; filename*=UTF-8''" +
                encodeURIComponent(url.searchParams.get("name") ?? "file"),
            );
            createReadStream(file)
              .on("error", () => res.destroy())
              .pipe(res);
            return;
          }
          if (parts[3] === "index") {
            if (req.method === "GET") {
              send(res, { jobs: indexer.list(id), nodes: indexer.nodes(id) });
              return;
            }
            if (req.method === "POST" && parts[4]) {
              const value = z
                .object({ action: z.enum(["pause", "cancel", "resume"]) })
                .parse(await jsonBody(req));
              if (value.action === "resume") {
                const job = indexer.list(id).find((j) => j.id === parts[4]);
                if (!job?.model || !job.effort)
                  throw new Error("旧索引任务未记录模型，请创建新的索引任务");
                await selection({ model: job.model, effort: job.effort });
              }
              send(res, indexer.control(id, parts[4], value.action));
              return;
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
              const chosen = await selection(
                value.model ? ModelSelectionSchema.parse(value) : undefined,
              );
              send(
                res,
                indexer.start(
                  id,
                  value.page,
                  value.full,
                  chosen.model,
                  chosen.effort,
                ),
              );
              return;
            }
          }
          if (parts[3] === "memory" && req.method === "POST") {
            const value = z
              .object({
                sessionId: z.string().max(100),
                goal: z.string().max(600),
              })
              .parse(await jsonBody(req));
            library.store.put("memory", id + ":" + value.sessionId, id, {
              goal: value.goal,
              text: "用户学习目标：" + value.goal,
            });
            send(res, { ok: true });
            return;
          }
          if (parts[3] === "turns") {
            if (
              req.method === "POST" &&
              parts[4] &&
              parts[5] === "note" &&
              parts.length === 6
            ) {
              z.object({})
                .strict()
                .parse(await jsonBody(req));
              const saved = notes.fromAnswer(id, parts[4]);
              send(res, saved, saved.created ? 201 : 200);
              return;
            }
            if (req.method === "POST" && parts[5] === "cancel") {
              chat.cancel(id, parts[4]);
              send(res, { ok: true });
              return;
            }
            if (req.method === "POST") {
              const value = z
                .object({
                  reading: ReadingSnapshotSchema,
                  question: z.string().min(1).max(6000),
                  images: ChatImageInputSchema.array()
                    .max(MAX_CHAT_IMAGES)
                    .default([]),
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
              if (
                value.reading.bookId !== id ||
                value.reading.page > book.pages
              )
                throw new Error("阅读位置与书籍不匹配");
              const chosen = await selection(
                ModelSelectionSchema.parse({
                  model: value.model,
                  effort: value.effort,
                }),
              );
              send(
                res,
                chat.start(
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
              return;
            }
            send(
              res,
              chat.list(id, url.searchParams.get("session") ?? undefined),
            );
            return;
          }
          if (parts[3] === "sessions") {
            if (req.method === "POST") {
              if (parts[4])
                send(
                  res,
                  chat.renameSession(
                    id,
                    parts[4],
                    z
                      .object({ title: z.string().trim().min(1).max(100) })
                      .parse(await jsonBody(req)).title,
                  ),
                );
              else send(res, chat.createSession(id));
            } else send(res, chat.sessions(id));
            return;
          }
          if (parts[3] === "file" && req.method === "GET") {
            const file = library.file(id);
            const size = (await stat(file)).size;
            res.writeHead(200, {
              "Content-Type": "application/pdf",
              "Content-Length": size,
              "Cache-Control": "private, max-age=60",
            });
            createReadStream(file)
              .on("error", () => res.destroy())
              .pipe(res);
            return;
          }
          if (parts[3] === "search") {
            send(
              res,
              library.search(
                id,
                (url.searchParams.get("q") ?? "").slice(0, 1000),
              ),
            );
            return;
          }
          if (parts[3] === "passages") {
            send(
              res,
              library.passages(
                id,
                url.searchParams.has("page")
                  ? Number(url.searchParams.get("page"))
                  : undefined,
              ),
            );
            return;
          }
          if (parts[3] === "progress" && req.method === "POST") {
            const data = z
              .object({
                page: z.number().int().min(1).max(Math.max(book.pages, 1)),
              })
              .parse(await jsonBody(req));
            library.progress(id, data.page);
            send(res, { ok: true });
            return;
          }
          if (parts[3] === "bookmarks") {
            if (req.method === "POST") {
              const data = z
                .object({
                  page: z.number().int().min(1).max(Math.max(book.pages, 1)),
                  note: z.string().max(1000),
                })
                .parse(await jsonBody(req));
              send(res, library.addBookmark(id, data.page, data.note));
              return;
            }
            if (req.method === "DELETE") {
              const mark = library.bookmarks(id).find((x) => x.id === parts[4]);
              if (mark) library.store.remove("bookmark", mark.id);
              send(res, { ok: true });
              return;
            }
            send(res, library.bookmarks(id));
            return;
          }
        }
        send(res, { error: "接口不存在" }, 404);
        return;
      }
      const root = resolve(webRoot);
      const file = resolve(
        root,
        "." +
          (url.pathname === "/"
            ? "/index.html"
            : decodeURIComponent(url.pathname)),
      );
      const rel = relative(root, file);
      if (rel.startsWith("..") || isAbsolute(rel)) {
        res.writeHead(403).end();
        return;
      }
      const content = await readFile(file);
      res.setHeader(
        "Content-Type",
        (
          {
            ".html": "text/html; charset=utf-8",
            ".js": "text/javascript",
            ".mjs": "text/javascript",
            ".css": "text/css",
            ".svg": "image/svg+xml",
            ".woff2": "font/woff2",
          } as Record<string, string>
        )[extname(file)] ?? "application/octet-stream",
      );
      res.setHeader(
        "Content-Security-Policy",
        "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self' data:; worker-src 'self' blob:; connect-src 'self' ws://127.0.0.1:*; object-src 'none'; base-uri 'none'; frame-ancestors 'none'",
      );
      res.setHeader("X-Content-Type-Options", "nosniff");
      res.end(content);
    } catch (error) {
      if (!res.headersSent)
        send(
          res,
          { error: error instanceof Error ? error.message : String(error),
            ...(error instanceof WorkspaceConflict || error instanceof WorkspacePayloadError ? { code: error.code } : {}) },
          error instanceof WorkspaceConflict ? 409 : 400,
        );
      else res.destroy();
    }
  });
  server.on("upgrade", (req, socket, head) => {
    if (req.url !== "/events" || !allowedOrigin(req) || !authenticated(req)) {
      socket.destroy();
      return;
    }
    sockets.handleUpgrade(req, socket, head, (client) =>
      sockets.emit("connection", client, req),
    );
  });
  return {
    server,
    library,
    emit,
    close() {
      closed = true;
      void runtime.cancel();
      bookTools.close();
      indexer.close();
      chat.close();
      codex.disconnect();
      for (const client of sockets.clients) client.terminate();
      sockets.close();
      server.close();
      library.close();
    },
  };
}
