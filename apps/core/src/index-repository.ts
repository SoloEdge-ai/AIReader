import type { Chapter } from "../../../packages/protocol/src/library";
import type { IndexJob, SemanticNode } from "../../../packages/protocol/src/indexing";
import { Storage } from "./storage";

export interface IndexBatchSummary {
  summary: string;
  concepts: string[];
}

/** Owns persisted index jobs, source coverage and resumable model batches. */
export class IndexRepository {
  constructor(private readonly store: Storage) {}

  jobs(bookId?: string): IndexJob[] {
    return this.store.list<IndexJob>("index", bookId);
  }

  saveJob(job: IndexJob): void {
    this.store.put("index", job.id, job.bookId, job);
  }

  createJob(job: IndexJob, targets: Chapter[]): void {
    this.store.transaction(() => {
      this.store.put("index-target", job.id, job.bookId, targets);
      this.saveJob(job);
    });
  }

  targets(job: IndexJob): Chapter[] {
    return this.store.getForBook<Chapter[]>("index-target", job.id, job.bookId) ?? [];
  }

  nodes(bookId: string, version: number): SemanticNode[] {
    return this.store.list<SemanticNode>("semantic", bookId)
      .filter((node) => node.indexVersion === version);
  }

  saveNode(node: SemanticNode): void {
    this.store.put("semantic", node.id, node.bookId, node);
  }

  private batchKey(bookId: string, chapterId: string, batch: number, version: number): string {
    return `${bookId}:${chapterId}:${batch}:v${version}`;
  }

  batch(bookId: string, chapterId: string, batch: number, version: number): IndexBatchSummary | undefined {
    return this.store.getForBook<IndexBatchSummary>("index-batch",
      this.batchKey(bookId, chapterId, batch, version), bookId);
  }

  saveBatch(bookId: string, chapterId: string, batch: number, version: number,
    result: IndexBatchSummary): void {
    this.store.put("index-batch", this.batchKey(bookId, chapterId, batch, version), bookId, result);
  }

  discardStaleIndex(bookId: string): void {
    this.store.db.prepare(
      "DELETE FROM records WHERE book_id=? AND kind IN ('semantic','index','index-target','index-batch')",
    ).run(bookId);
  }
}
