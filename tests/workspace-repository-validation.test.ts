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
    expect(() => storage.workspaces.save({ bookId: "book", revision: 0, formatVersion: 4,
      layoutVersion: 2, cards: [], objects: [], links: [], unexpected: true } as unknown as BookWorkspace))
      .toThrow();
    storage.workspaces.save({ bookId: "book", revision: 0, formatVersion: 4,
      layoutVersion: 2, cards: [{ id: "card", kind: "note", title: "Note", text: "", comment: "",
        x: 50, y: 60, width: 250, height: 170 }], objects: [], links: [] });
    expect(storage.workspaces.get("book")?.cards).toHaveLength(1);
    storage.db.prepare("UPDATE workspace_entities SET value=? WHERE book_id=? AND id=?")
      .run(JSON.stringify({ id: "card", kind: "note", title: "Note", x: "not a coordinate" }), "book", "card");
    expect(() => storage.workspaces.get("book")).toThrow();
  } finally {
    storage.close();
    if (directory.startsWith(tmpdir() + sep)) await rm(directory, { recursive: true, force: true });
  }
});
