import { createServer, IncomingMessage, ServerResponse } from "node:http";
import { readFile } from "node:fs/promises";
import { resolve, extname, relative, isAbsolute } from "node:path";
import { randomBytes } from "node:crypto";
import { WebSocketServer, WebSocket } from "ws";
import { Library } from "./library";
import { CodexAdapter } from "./codex";
import { ChatService } from "./chat";
import { IndexService } from "./indexer";
import { BookTools } from "./tools";
import { RuntimeManager } from "./runtime";
import { AiService } from "./ai-service";
import { handleAiRoutes } from "./ai-routes";
import { Notes } from "./notes";
import { jsonBody, send } from "./http";
import { handleNoteRoutes } from "./note-routes";
import { handleBookChatRoutes } from "./chat-routes";
import { handleBookCollectionRoutes, handleBookReaderRoutes } from "./book-routes";
import { handleBookToolRoutes } from "./book-tools-routes";
import { handleBookIndexRoutes } from "./index-routes";
import { Preferences } from "./preferences";
import { handleGlobalPreferenceRoutes } from "./preferences-routes";
import { Workspaces, WorkspaceConflict, WorkspacePayloadError } from "./workspace";
import { WorkspaceAssets } from "./workspace-assets";
import { QuestionMaterials } from "./question-materials";
import { WorkspaceArchives } from "./workspace-archive";
import { handleBookWorkspaceRoutes, handleGlobalWorkspaceRoutes } from "./workspace-routes";
import { BookCommands } from "./book-commands";
import { join } from "node:path";
import type { CoreEvent } from "../../../packages/protocol/src/index";
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
  const preferences = new Preferences(library);
  const workspaces = new Workspaces(library);
  const workspaceAssets = new WorkspaceAssets(library, workspaces);
  const notes = new Notes(library, workspaceAssets);
  const bookCommands = new BookCommands(library);
  const questionMaterials = new QuestionMaterials(library, workspaces, notes, workspaceAssets);
  const workspaceArchives = new WorkspaceArchives(library, workspaceAssets);
  const workspaceRoutes = { workspaces, assets: workspaceAssets, materials: questionMaterials,
    archives: workspaceArchives, notes };
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
  const ai = new AiService(library, codex, runtime, chat, indexer, bookTools);
  codex.on("account", (data) => emit({ type: "account", data }));
  codex.on("disconnected", () => emit({ type: "account", data: codex.info }));
  let closed = false;
  void runtime.inspect().then((state) => {
    if (!closed && state.status === "ready")
      void codex.connect().catch(() => {});
  });
  const chatRoutes = { chat, notes, selectModel: ai.selectModel.bind(ai) };
  const authenticated = (req: IncomingMessage) =>
    req.headers.cookie
      ?.split(";")
      .some((x) => x.trim() === `aireader=${token}`);
  const allowedOrigin = (req: IncomingMessage) =>
    req.headers.origin === `http://${req.headers.host}` ||
    (!process.env.AIREADER_WEB &&
      req.headers.origin === "http://127.0.0.1:5173");
  const activeRequests = new Set<Promise<void>>();
  async function handleRequest(req: IncomingMessage, res: ServerResponse): Promise<void> {
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
        if (parts[1] === "v2" && parts[2] === "books" && parts[3] &&
            parts[4] === "commands" && parts.length === 5 && req.method === "POST") {
          send(res, bookCommands.execute(parts[3], await jsonBody(req, 8 * 1024 * 1024)));
          return;
        }
        if (await handleGlobalWorkspaceRoutes(req, res, parts, workspaceRoutes)) return;
        if (await handleGlobalPreferenceRoutes(req, res, parts, preferences)) return;
        if (await handleAiRoutes(req, res, parts, ai)) return;
        if (await handleBookCollectionRoutes(req, res, parts, library)) return;
        if (parts[1] === "books" && parts[2]) {
          const id = parts[2];
          const book = library.book(id);
          if (await handleBookWorkspaceRoutes(req, res, id, parts, url, workspaceRoutes)) return;
          if (await handleNoteRoutes(req, res, id, parts, notes)) return;
          if (await handleBookReaderRoutes(req, res, book, parts, url, library, preferences)) return;
          if (await handleBookToolRoutes(req, res, id, parts, url, bookTools)) return;
          if (await handleBookIndexRoutes(req, res, id, parts, indexer, ai)) return;
          if (await handleBookChatRoutes(req, res, id, book.pages, parts, url, chatRoutes)) return;
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
  }
  const server = createServer((req, res) => {
    if (closed) {
      send(res, { error: "Core 正在关闭" }, 503);
      return;
    }
    const request = handleRequest(req, res);
    activeRequests.add(request);
    void request.then(
      () => activeRequests.delete(request),
      () => activeRequests.delete(request),
    );
  });
  server.on("upgrade", (req, socket, head) => {
    if (closed || req.url !== "/events" || !allowedOrigin(req) || !authenticated(req)) {
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
    async shutdown() {
      closed = true;
      ai.close();
      await runtime.cancel();
      bookTools.close();
      indexer.close();
      chat.close();
      await codex.shutdown();
      for (const client of sockets.clients) client.terminate();
      sockets.close();
      const stopped = new Promise<void>((resolve, reject) => server.close((error) =>
        error && (error as NodeJS.ErrnoException).code !== "ERR_SERVER_NOT_RUNNING" ? reject(error) : resolve()));
      // Renderer drafts are already saved. Break stalled transports, but allow
      // handlers that reached file/transaction work to finish before closing SQLite.
      server.closeAllConnections();
      await stopped;
      while (activeRequests.size) await Promise.allSettled([...activeRequests]);
      library.close();
    },
    close() {
      closed = true;
      ai.close();
      void runtime.cancel();
      bookTools.close();
      indexer.close();
      chat.close();
      void codex.shutdown();
      for (const client of sockets.clients) client.terminate();
      sockets.close();
      server.close();
      library.close();
    },
  };
}
