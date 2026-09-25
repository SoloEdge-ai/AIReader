import { DatabaseSync } from "node:sqlite";
import { mkdirSync, existsSync } from "node:fs";
import { join } from "node:path";
import { WorkspaceRepository, workspaceTables } from "./workspace-repository";
export class Storage {
  readonly db: DatabaseSync;
  readonly workspaces: WorkspaceRepository;
  private open = true;
  constructor(readonly directory: string) {
    mkdirSync(directory, { recursive: true });
    const path = join(directory, "library.sqlite");
    const existed = existsSync(path);
    if (existed) {
      const probe = new DatabaseSync(path, { readOnly: true });
      let version: number;
      try {
        version = Number(
          probe.prepare("PRAGMA user_version").get()!.user_version,
        );
      } finally {
        probe.close();
      }
      if (version > 5) throw new Error("数据库来自较新版本，请更新 AIReader。");
      if (version < 5)
        throw new Error(
          "此预览版不支持旧版数据；请使用独立数据目录。旧数据未修改，重置须另行确认。",
        );
    }
    this.db = new DatabaseSync(path);
    try {
      if (!existed) {
        this.db.exec(`BEGIN;
        CREATE TABLE IF NOT EXISTS records(kind TEXT NOT NULL,id TEXT NOT NULL,book_id TEXT NOT NULL,value TEXT NOT NULL,PRIMARY KEY(kind,id));
        CREATE TABLE IF NOT EXISTS passages(id TEXT PRIMARY KEY,book_id TEXT NOT NULL,page INTEGER NOT NULL,text TEXT NOT NULL,value TEXT NOT NULL);
        CREATE INDEX IF NOT EXISTS passages_book ON passages(book_id,page);
        CREATE VIRTUAL TABLE IF NOT EXISTS search USING fts5(id UNINDEXED,book_id UNINDEXED,tokens);
        ${workspaceTables}
        PRAGMA user_version=5;
        COMMIT;`);
      }
      this.db.exec(
        "PRAGMA foreign_keys=ON; PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000;",
      );
      this.workspaces = new WorkspaceRepository(this.db);
    } catch (error) {
      this.db.close();
      throw error;
    }
  }
  get<T>(kind: string, id: string): T | undefined {
    this.genericKind(kind);
    const row = this.db
      .prepare("SELECT value FROM records WHERE kind=? AND id=?")
      .get(kind, id) as { value: string } | undefined;
    return row ? JSON.parse(row.value) : undefined;
  }
  getForBook<T>(kind: string, id: string, bookId: string): T | undefined {
    this.genericKind(kind);
    const row = this.db
      .prepare("SELECT value FROM records WHERE kind=? AND id=? AND book_id=?")
      .get(kind, id, bookId) as { value: string } | undefined;
    return row ? JSON.parse(row.value) : undefined;
  }
  list<T>(kind: string, bookId?: string): T[] {
    this.genericKind(kind);
    const rows = (
      bookId === undefined
        ? this.db.prepare("SELECT value FROM records WHERE kind=?").all(kind)
        : this.db
            .prepare("SELECT value FROM records WHERE kind=? AND book_id=?")
            .all(kind, bookId)
    ) as { value: string }[];
    return rows.map((row) => JSON.parse(row.value));
  }
  put(kind: string, id: string, bookId: string, value: unknown) {
    this.genericKind(kind);
    this.db
      .prepare("INSERT OR REPLACE INTO records VALUES(?,?,?,?)")
      .run(kind, id, bookId, JSON.stringify(value));
  }
  remove(kind: string, id: string) {
    this.genericKind(kind);
    this.db.prepare("DELETE FROM records WHERE kind=? AND id=?").run(kind, id);
  }
  private genericKind(kind: string) {
    if (
      ["workspace", "workspace-camera", "workspace-receipt-v2"].includes(kind)
    )
      throw new Error("工作区必须通过实体存储接口访问");
  }
  transaction(action: () => void) {
    this.db.exec("BEGIN");
    try {
      action();
      this.db.exec("COMMIT");
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
  }
  close() {
    if (this.open) {
      this.db.close();
      this.open = false;
    }
  }
}
