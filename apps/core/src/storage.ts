import { DatabaseSync } from "node:sqlite";
import { mkdirSync, copyFileSync, existsSync } from "node:fs";
import { join } from "node:path";
export class Storage {
  readonly db: DatabaseSync;
  private open = true;
  constructor(readonly directory: string) {
    mkdirSync(directory, { recursive: true });
    const path = join(directory, "library.sqlite");
    const existed = existsSync(path);
    this.db = new DatabaseSync(path);
    const version = Number(
      this.db.prepare("PRAGMA user_version").get()!.user_version,
    );
    if (version > 2) {
      this.db.close();
      throw new Error("数据库来自较新版本，请更新 AIReader。");
    }
    if (version < 2) {
      if (existed) {
        this.db.exec("PRAGMA wal_checkpoint(TRUNCATE)");
        copyFileSync(path, path + ".before-v2.bak");
      }
      this.db
        .exec(`CREATE TABLE IF NOT EXISTS records(kind TEXT NOT NULL,id TEXT NOT NULL,book_id TEXT NOT NULL,value TEXT NOT NULL,PRIMARY KEY(kind,id));
        CREATE TABLE IF NOT EXISTS passages(id TEXT PRIMARY KEY,book_id TEXT NOT NULL,page INTEGER NOT NULL,text TEXT NOT NULL,value TEXT NOT NULL);
        CREATE INDEX IF NOT EXISTS passages_book ON passages(book_id,page);
        CREATE VIRTUAL TABLE IF NOT EXISTS search USING fts5(id UNINDEXED,book_id UNINDEXED,tokens);
        PRAGMA user_version=2;`);
    }
    this.db.exec("PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000;");
  }
  get<T>(kind: string, id: string): T | undefined {
    const row = this.db
      .prepare("SELECT value FROM records WHERE kind=? AND id=?")
      .get(kind, id) as { value: string } | undefined;
    return row ? JSON.parse(row.value) : undefined;
  }
  list<T>(kind: string, bookId?: string): T[] {
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
    this.db
      .prepare("INSERT OR REPLACE INTO records VALUES(?,?,?,?)")
      .run(kind, id, bookId, JSON.stringify(value));
  }
  remove(kind: string, id: string) {
    this.db.prepare("DELETE FROM records WHERE kind=? AND id=?").run(kind, id);
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
