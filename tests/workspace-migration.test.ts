import { DatabaseSync } from "node:sqlite";
import { existsSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test, expect } from "vitest";
import { Storage } from "../apps/core/src/storage";

test("v3 database is backed up before v4 upgrade, and newer databases reject writes", async () => {
  const directory = await mkdtemp(join(tmpdir(), "aireader-v4-migration-"));
  const path = join(directory, "library.sqlite");
  try {
    const old = new DatabaseSync(path);
    old.exec(`CREATE TABLE records(kind TEXT NOT NULL,id TEXT NOT NULL,book_id TEXT NOT NULL,value TEXT NOT NULL,PRIMARY KEY(kind,id)); PRAGMA user_version=3;`);
    old.prepare("INSERT INTO records VALUES(?,?,?,?)").run("workspace", "book-1", "book-1", JSON.stringify({ cards: ["kept"] }));
    old.close();
    const upgraded = new Storage(directory);
    expect(upgraded.get("workspace", "book-1")).toEqual({ cards: ["kept"] });
    expect((upgraded.db.prepare("PRAGMA user_version").get() as { user_version: number }).user_version).toBe(4);
    upgraded.close();
    const backupPath = path + ".before-v4.bak";
    expect(existsSync(backupPath)).toBe(true);
    const backup = new DatabaseSync(backupPath);
    expect((backup.prepare("PRAGMA user_version").get() as { user_version: number }).user_version).toBe(3);
    expect(JSON.parse((backup.prepare("SELECT value FROM records WHERE id=?").get("book-1") as { value: string }).value)).toEqual({ cards: ["kept"] });
    backup.close();
    const future = new DatabaseSync(path);
    future.exec("PRAGMA user_version=5");
    future.close();
    expect(() => new Storage(directory)).toThrow("数据库来自较新版本");
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
