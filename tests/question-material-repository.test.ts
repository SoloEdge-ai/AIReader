import { test, expect } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { QuestionMaterialSnapshot } from "../packages/protocol/src/question-materials";
import { QuestionMaterialRepository } from "../apps/core/src/question-material-repository";
import { Storage } from "../apps/core/src/storage";

test("material receipts are book scoped, atomic and removed with expired drafts", async () => {
  const directory = await mkdtemp(join(tmpdir(), "aireader-material-records-"));
  const store = new Storage(directory);
  const records = new QuestionMaterialRepository(store);
  const snapshot = (bookId: string, id: string): QuestionMaterialSnapshot => ({
    id, bookId, sessionId: "session", createdAt: "2026-01-01T00:00:00.000Z",
    title: "个人笔记", itemCount: 1,
    targets: [{ kind: "card", id: "card" }], sections: [{ kind: "user-note", title: "个人笔记", text: "草稿" }], images: [],
  });
  try {
    const first = snapshot("book-a", "material-a");
    const created = records.create(first, "request", "digest-a", () => {});
    expect(created).toEqual({ snapshot: first, created: true });
    expect(records.create(snapshot("book-a", "material-b"), "request", "digest-a", () => {
      throw new Error("A retry must not validate a changed workspace");
    })).toEqual({ snapshot: first, created: false });
    expect(() => records.create(snapshot("book-a", "material-c"), "request", "different", () => {}))
      .toThrow("材料操作标识已被其他内容使用");
    expect(records.get("book-b", "session", first.id)).toBeUndefined();
    expect(records.request("book-b", "request")).toBeUndefined();

    store.db.exec(`CREATE TRIGGER fail_material_request BEFORE INSERT ON records
      WHEN NEW.kind='question-material-request' AND NEW.id='book-a:rollback'
      BEGIN SELECT RAISE(ABORT, 'request failed'); END`);
    expect(() => records.create(snapshot("book-a", "rolled-back"), "rollback", "digest", () => {}))
      .toThrow("request failed");
    expect(records.get("book-a", "session", "rolled-back")).toBeUndefined();
    store.db.exec("DROP TRIGGER fail_material_request");

    const other = snapshot("book-b", "material-b");
    expect(records.create(other, "request", "digest-b", () => {}).created).toBe(true);
    records.removeUncommitted(first);
    expect(records.get("book-a", "session", first.id)).toBeUndefined();
    expect(records.request("book-a", "request")).toBeUndefined();
    expect(records.get("book-b", "session", other.id)).toEqual(other);
    expect(records.request("book-b", "request")?.materialId).toBe(other.id);
  } finally {
    store.close();
    await rm(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }
});
