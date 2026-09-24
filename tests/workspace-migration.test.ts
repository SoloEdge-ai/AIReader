import { DatabaseSync } from "node:sqlite";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test, expect } from "vitest";
import { Storage } from "../apps/core/src/storage";

// Accepted 0.2 plan: no legacy migration or automatic deletion; installation cleanup is separate.
test("v5 refuses legacy and future databases without modifying their files", async () => {
  const directory = await mkdtemp(join(tmpdir(), "aireader-v5-format-"));
  const path = join(directory, "library.sqlite");
  let opened: Storage | undefined;
  try {
    const old = new DatabaseSync(path);
    old.exec(
      "CREATE TABLE private_fixture(value TEXT); INSERT INTO private_fixture VALUES('keep'); PRAGMA user_version=4;",
    );
    old.close();
    const before = await readFile(path);
    expect(() => {
      opened = new Storage(directory);
    }).toThrow("旧版数据");
    expect(await readFile(path)).toEqual(before);
    const future = new DatabaseSync(path);
    future.exec("PRAGMA user_version=6");
    future.close();
    const newer = await readFile(path);
    expect(() => new Storage(directory)).toThrow("数据库来自较新版本");
    expect(await readFile(path)).toEqual(newer);
  } finally {
    opened?.close();
    await rm(directory, { recursive: true, force: true });
  }
});
