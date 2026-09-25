import { createHash, randomUUID } from "node:crypto";
import { mkdir, writeFile, rename } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { spawn, type ChildProcess } from "node:child_process";
import type {
  Book,
  Bookmark,
  Passage,
  CoreEvent,
  ReaderPreferences,
} from "../../../packages/protocol/src/index";
import { ReaderPreferencesSchema } from "../../../packages/protocol/src/index";
import { Storage } from "./storage";
import { tokens } from "./tokenize";
import type { ParseMessage } from "./pdf-worker";
export class Library {
  readonly store: Storage;
  private workers = new Map<string, ChildProcess>();
  private closed = false;
  constructor(
    readonly directory: string,
    readonly emit: (event: CoreEvent) => void = () => {},
  ) {
    this.store = new Storage(directory);
  }
  resume() {
    for (const book of this.books()) {
      if (book.indexVersion < 2) {
        book.indexVersion = 2;
        book.status = "queued";
        this.store.db
          .prepare(
            "DELETE FROM records WHERE book_id=? AND kind IN ('semantic','index','index-target','index-batch')",
          )
          .run(book.id);
        this.save(book);
      }
      if (["queued", "parsing"].includes(book.status)) this.parse(book);
    }
  }
  books() {
    return this.store
      .list<Book>("book")
      .sort((a, b) =>
        (b.lastOpenedAt ?? b.createdAt).localeCompare(
          a.lastOpenedAt ?? a.createdAt,
        ),
      );
  }
  book(id: string) {
    const book = this.store.get<Book>("book", id);
    if (!book) throw new Error("书籍不存在");
    return book;
  }
  open(id: string) {
    const book = this.book(id);
    book.lastOpenedAt = new Date().toISOString();
    this.store.put("book", id, id, book);
    return book;
  }
  readerPreferences(id: string): ReaderPreferences {
    this.book(id);
    return ReaderPreferencesSchema.parse(this.store.get("reader", id) ?? {});
  }
  saveReaderPreferences(id: string, value: ReaderPreferences) {
    this.book(id);
    const preferences = ReaderPreferencesSchema.parse(value);
    this.store.put("reader", id, id, preferences);
    return preferences;
  }
  file(id: string) {
    this.book(id);
    return join(this.directory, "books", id + ".pdf");
  }
  async import(bytes: Buffer, name: string, asCopy = false) {
    if (!bytes.subarray(0, 1024).includes(Buffer.from("%PDF-")))
      throw new Error("请选择有效的 PDF 文件");
    const fingerprint = createHash("sha256").update(bytes).digest("hex");
    const existing = this.books().find((b) => b.fingerprint === fingerprint);
    if (existing && !asCopy) return existing;
    const id = asCopy ? randomUUID() : fingerprint.slice(0, 24);
    await mkdir(join(this.directory, "books"), { recursive: true });
    const target = join(this.directory, "books", id + ".pdf");
    await writeFile(target + ".tmp", bytes);
    await rename(target + ".tmp", target);
    const book: Book = {
      id,
      fingerprint,
      title: name.replace(/\.pdf$/i, ""),
      pages: 0,
      parsedPages: 0,
      textPages: 0,
      status: "queued",
      progress: 1,
      createdAt: new Date().toISOString(),
      chapters: [],
      labels: [],
      indexVersion: 2,
    };
    this.save(book);
    this.parse(book);
    return book;
  }
  private save(book: Book) {
    this.store.put("book", book.id, book.id, book);
    this.emit({ type: "book", bookId: book.id, data: book });
  }
  private parse(book: Book) {
    if (this.workers.has(book.id) || this.closed) return;
    book.status = "parsing";
    book.parsedPages = 0;
    book.textPages = 0;
    this.save(book);
    const compiled =
      process.env.AIREADER_WORKER ?? resolve("dist/core/pdf-worker.mjs");
    if (!existsSync(compiled)) {
      book.status = "error";
      book.error = "解析 Worker 尚未构建，请运行 pnpm build";
      this.save(book);
      return;
    }
    // PDF.js 5.x can fault the entire host when imported in a Windows thread.
    // A process boundary contains native faults without blocking the Core loop.
    const worker = spawn(process.execPath, [compiled], {
      env: { ...process.env, ELECTRON_RUN_AS_NODE: "1" },
      windowsHide: true,
      stdio: ["ignore", "ignore", "ignore", "ipc"],
    });
    this.workers.set(book.id, worker);
    worker.on("message", (message: ParseMessage) => {
      if (this.closed) return;
      const latest = this.book(book.id);
      if (message.type === "metadata") {
        Object.assign(latest, {
          pages: message.pages,
          chapters: message.chapters,
          labels: message.labels,
        });
      }
      if (message.type === "page") {
        this.store.transaction(() => {
          const old = this.store.db
            .prepare("SELECT id FROM passages WHERE book_id=? AND page=?")
            .all(book.id, message.page) as { id: string }[];
          for (const row of old)
            this.store.db.prepare("DELETE FROM search WHERE id=?").run(row.id);
          this.store.db
            .prepare("DELETE FROM passages WHERE book_id=? AND page=?")
            .run(book.id, message.page);
          for (const p of message.passages as Passage[]) {
            this.store.db
              .prepare("INSERT INTO passages VALUES(?,?,?,?,?)")
              .run(p.id, p.bookId, p.page, p.text, JSON.stringify(p));
            this.store.db
              .prepare("INSERT INTO search VALUES(?,?,?)")
              .run(p.id, p.bookId, tokens(p.text).join(" "));
          }
        });
        latest.parsedPages = message.page;
        latest.textPages += message.passages.length > 0 ? 1 : 0;
      }
      if (message.type === "error") {
        latest.status = "error";
        latest.error = message.error;
      }
      if (message.type === "done") latest.status = "ready";
      this.save(latest);
      if (
        (message.type === "done" || message.type === "error") &&
        worker.connected
      )
        worker.send({ type: "parse-ack" }, () => {});
    });
    const failed = (message: string) => {
      if (!this.closed) {
        const latest = this.book(book.id);
        if (latest.status !== "parsing") return;
        latest.status = "error";
        latest.error = message;
        this.save(latest);
      }
    };
    worker.on("error", (error) => {
      this.workers.delete(book.id);
      failed(error.message);
    });
    worker.on("exit", (code) => {
      this.workers.delete(book.id);
      failed(`PDF 解析进程意外结束（${code ?? "已中止"}），请重试解析。`);
    });
    worker.send(
      {
        path: this.file(book.id),
        bookId: book.id,
        fingerprint: book.fingerprint,
        indexVersion: book.indexVersion,
      },
      (error) => {
        if (error) failed(error.message);
      },
    );
  }
  async waitForBook(id: string) {
    while (["queued", "parsing"].includes(this.book(id).status))
      await new Promise((r) => setTimeout(r, 30));
    return this.book(id);
  }
  passages(bookId: string, page?: number): Passage[] {
    this.book(bookId);
    const rows = (
      page === undefined
        ? this.store.db
            .prepare(
              "SELECT value FROM passages WHERE book_id=? ORDER BY page,id",
            )
            .all(bookId)
        : this.store.db
            .prepare(
              "SELECT value FROM passages WHERE book_id=? AND page=? ORDER BY id",
            )
            .all(bookId, page)
    ) as { value: string }[];
    return rows.map((row) => JSON.parse(row.value));
  }
  passage(bookId: string, id: string) {
    return this.passages(bookId).find((p) => p.id === id);
  }
  search(bookId: string, query: string, limit = 20): Passage[] {
    this.book(bookId);
    const terms = tokens(query).slice(0, 40);
    if (!terms.length) return [];
    const match = terms
      .map((t) => '"' + t.replaceAll('"', '""') + '"')
      .join(" OR ");
    const rows = this.store.db
      .prepare(
        "SELECT p.value FROM search s JOIN passages p ON p.id=s.id WHERE search MATCH ? AND s.book_id=? ORDER BY bm25(search) LIMIT ?",
      )
      .all(match, bookId, limit) as { value: string }[];
    return rows.map((row) => JSON.parse(row.value));
  }
  progress(id: string, page: number) {
    const book = this.book(id);
    book.progress = Math.max(1, Math.min(page, book.pages || page));
    this.save(book);
  }
  bookmarks(bookId: string) {
    this.book(bookId);
    return this.store.list<Bookmark>("bookmark", bookId);
  }
  addBookmark(bookId: string, page: number, note: string) {
    this.book(bookId);
    const mark: Bookmark = { id: randomUUID(), bookId, page, note };
    this.store.put("bookmark", mark.id, bookId, mark);
    return mark;
  }
  removeBookmark(bookId: string, bookmarkId: string) {
    const mark = this.bookmarks(bookId).find((item) => item.id === bookmarkId);
    if (mark) this.store.remove("bookmark", mark.id);
  }
  close() {
    this.closed = true;
    for (const worker of this.workers.values()) worker.kill();
    this.workers.clear();
    this.store.close();
  }
}
