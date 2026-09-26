import { expect, test } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, sep } from "node:path";
import { Storage } from "../apps/core/src/storage";
import type { BookWorkspace } from "../packages/protocol/src/workspace";

test("workspace repository validates untrusted writes and rows even when Core skips duplicate parsing", async () => {
  const directory = await mkdtemp(join(tmpdir(), "aireader-workspace-boundary-"));
  const storage = new Storage(directory);
  try {
    expect(() => storage.workspaces.save({ bookId: "book", revision: 0, formatVersion: 5,
      layoutVersion: 3, cards: [], objects: [], groups: [], links: [], unexpected: true } as unknown as BookWorkspace))
      .toThrow();
    storage.workspaces.save({ bookId: "book", revision: 0, formatVersion: 5,
      layoutVersion: 3, cards: [{ id: "card", kind: "note", title: "Note", text: "", comment: "",
        x: 50, y: 60, width: 250, height: 170 }], objects: [], groups: [], links: [] });
    expect(storage.workspaces.get("book")?.cards).toHaveLength(1);
    storage.db.prepare("UPDATE workspace_entities SET value=? WHERE book_id=? AND id=?")
      .run(JSON.stringify({ id: "card", kind: "note", title: "Note", x: "not a coordinate" }), "book", "card");
    expect(() => storage.workspaces.get("book")).toThrow();
  } finally {
    storage.close();
    if (directory.startsWith(tmpdir() + sep)) await rm(directory, { recursive: true, force: true });
  }
});

test("workspace metadata reads are book-scoped and asset IDs cannot be reassigned", async () => {
  const directory = await mkdtemp(join(tmpdir(), "aireader-workspace-metadata-"));
  const storage = new Storage(directory);
  try {
    const repo = storage.workspaces;
    repo.saveLegacyReceipt("book-a", "command", { version: 1, payloadHash: "digest" });
    repo.savePageBounds("book-a", 2, [10, 20, 300, 400]);
    const asset = { id: "asset", bookId: "book-a", width: 2, height: 3, bytes: 16, sha256: "digest" };
    repo.saveAsset(asset);
    expect(repo.legacyReceipt("book-a", "command")).toEqual({ version: 1, payloadHash: "digest" });
    expect(repo.pageBounds("book-a", 2)).toEqual([10, 20, 300, 400]);
    expect(repo.asset("book-a", "asset")).toEqual(asset);
    expect(repo.legacyReceipt("book-b", "command")).toBeUndefined();
    expect(repo.pageBounds("book-b", 2)).toBeUndefined();
    expect(repo.asset("book-b", "asset")).toBeUndefined();
    expect(() => repo.saveAsset({ ...asset, bookId: "book-b" })).toThrow();
    expect(repo.asset("book-a", "asset")).toEqual(asset);
  } finally {
    storage.close();
    if (directory.startsWith(tmpdir() + sep)) await rm(directory, { recursive: true, force: true });
  }
});
