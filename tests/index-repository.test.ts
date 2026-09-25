import { test, expect } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { IndexJob } from "../packages/protocol/src/indexing";
import { IndexRepository } from "../apps/core/src/index-repository";
import { Storage } from "../apps/core/src/storage";

test("index targets and batches stay book scoped and job creation rolls back together", async () => {
  const directory = await mkdtemp(join(tmpdir(), "aireader-index-repository-"));
  const store = new Storage(directory);
  const repository = new IndexRepository(store);
  const job: IndexJob = {
    id: "job-a", bookId: "book-a", kind: "semantic", status: "queued",
    completed: [], full: false,
  };
  const targets = [{ id: "chapter-a", title: "A", page: 1, endPage: 2, inferred: false }];
  try {
    store.db.exec(`CREATE TRIGGER fail_job BEFORE INSERT ON records
      WHEN NEW.kind='index' AND NEW.id='job-a'
      BEGIN SELECT RAISE(ABORT, 'job failed'); END`);
    expect(() => repository.createJob(job, targets)).toThrow("job failed");
    expect(repository.jobs("book-a")).toEqual([]);
    expect(repository.targets(job)).toEqual([]);
    store.db.exec("DROP TRIGGER fail_job");

    repository.createJob(job, targets);
    expect(repository.targets(job)).toEqual(targets);
    expect(repository.targets({ ...job, bookId: "book-b" })).toEqual([]);
    repository.saveBatch("book-a", "chapter-a", 0, 2,
      { summary: "A summary", concepts: ["cache"] });
    expect(repository.batch("book-a", "chapter-a", 0, 2)?.summary).toBe("A summary");
    expect(repository.batch("book-b", "chapter-a", 0, 2)).toBeUndefined();
    repository.saveNode({ id: "node-a", bookId: "book-a", title: "A", summary: "A summary",
      concepts: [], sourcePassageIds: [], indexVersion: 2 });
    expect(repository.nodes("book-a", 2)).toHaveLength(1);
    expect(repository.nodes("book-a", 3)).toEqual([]);
    expect(repository.nodes("book-b", 2)).toEqual([]);
  } finally {
    store.close();
    await rm(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }
});
