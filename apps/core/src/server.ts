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
  ReadingSnapshotSchema,
  ReaderPreferencesSchema,
} from "../../../packages/protocol/src";
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
export async function jsonBody(req: IncomingMessage) {
  return JSON.parse((await body(req)).toString());
}
export function send(res: ServerResponse, value: unknown, status = 200) {
  res
    .writeHead(status, {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
    })
    .end(JSON.stringify(value));
}
export function createCore(directory: string, webRoot: string) {
  const token = randomBytes(32).toString("hex");
  const sockets = new WebSocketServer({ noServer: true });
  const emit = (event: CoreEvent) => {
    for (const client of sockets.clients)
      if (client.readyState === WebSocket.OPEN)
        client.send(JSON.stringify(event));
  };
  const library = new Library(directory, emit);
  library.resume();
  let codex = new CodexAdapter(
    join(directory, "control"),
    library.store.get<{ path: string }>("setting", "codex")?.path,
  );
  let chat = new ChatService(library, codex);
  let indexer = new IndexService(library, codex);
  indexer.resume();
  let bookTools = new BookTools(library, codex);
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
        res.setHeader("Access-Control-Allow-Methods", "GET, POST, DELETE");
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
          if (parts[2] === "status") {
            send(res, codex.info);
            return;
          }
          if (req.method === "POST" && parts[2] === "connect") {
            await codex.connect();
            send(res, codex.info);
            return;
          }
          if (req.method === "POST" && parts[2] === "disconnect") {
            chat.cancelAll();
            codex.disconnect();
            send(res, codex.info);
            return;
          }
          if (req.method === "POST" && parts[2] === "login") {
            send(res, await codex.login());
            return;
          }
          if (parts[2] === "models") {
            send(res, await codex.models());
            return;
          }
          if (req.method === "POST" && parts[2] === "path") {
            const value = z
              .object({ path: z.string().max(1000) })
              .parse(await jsonBody(req));
            bookTools.close();
            indexer.close();
            chat.close();
            codex.disconnect();
            library.store.put("setting", "codex", "", value);
            codex = new CodexAdapter(
              join(directory, "control"),
              value.path || undefined,
            );
            chat = new ChatService(library, codex);
            indexer = new IndexService(library, codex);
            bookTools = new BookTools(library, codex);
            send(res, { ok: true });
            return;
          }
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
              send(res, indexer.control(id, parts[4], value.action));
              return;
            }
            if (req.method === "POST") {
              const value = z
                .object({
                  page: z.number().int().positive(),
                  full: z.boolean().default(false),
                })
                .parse(await jsonBody(req));
              send(res, indexer.start(id, value.page, value.full));
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
                  sessionId: z.string().min(1).max(100),
                  model: z.string().max(100).optional(),
                })
                .parse(await jsonBody(req));
              if (
                value.reading.bookId !== id ||
                value.reading.page > book.pages
              )
                throw new Error("阅读位置与书籍不匹配");
              send(
                res,
                chat.start(
                  value.reading,
                  value.question,
                  value.sessionId,
                  value.model,
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
          { error: error instanceof Error ? error.message : String(error) },
          400,
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
