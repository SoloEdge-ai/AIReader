import { DatabaseSync } from "node:sqlite";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test, expect } from "vitest";
import { Storage } from "../apps/core/src/storage";

// New workspace formats never rewrite, back up or delete an incompatible user database.
test("v6 refuses legacy and future databases without modifying their files", async () => {
  const directory = await mkdtemp(join(tmpdir(), "aireader-v6-format-"));
  const path = join(directory, "library.sqlite");
  let opened: Storage | undefined;
  try {
    const old = new DatabaseSync(path);
    old.exec(
      "CREATE TABLE private_fixture(value TEXT); INSERT INTO private_fixture VALUES('keep'); PRAGMA user_version=5;",
    );
    old.close();
    const before = await readFile(path);
    expect(() => {
      opened = new Storage(directory);
    }).toThrow("旧版数据");
    expect(await readFile(path)).toEqual(before);
    const future = new DatabaseSync(path);
    future.exec("PRAGMA user_version=7");
    future.close();
    const newer = await readFile(path);
    expect(() => new Storage(directory)).toThrow("数据库来自较新版本");
    expect(await readFile(path)).toEqual(newer);
  } finally {
    opened?.close();
    await rm(directory, { recursive: true, force: true });
  }
});

test("new libraries use database v6 with row storage for workspace groups", async () => {
  const directory = await mkdtemp(join(tmpdir(), "aireader-v6-new-"));
  const storage = new Storage(directory);
  try {
    expect(Number(storage.db.prepare("PRAGMA user_version").get()!.user_version)).toBe(6);
    expect(storage.db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='workspace_groups'").get())
      .toEqual({ name: "workspace_groups" });
  } finally {
    storage.close();
    await rm(directory, { recursive: true, force: true });
  }
});
