import { QuestionMetadataSchema, type QuestionMetadata } from "../../../packages/protocol/src/questions";
import type { Storage } from "./storage";
import type { MaterialReviewPlan } from "../../../packages/protocol/src/questions";

export type ReviewReceipt = { digest: string; latestId: string; plan: Omit<MaterialReviewPlan, "baseline"> };

/** Owns lightweight question projections and navigation history, never rich-text bodies. */
export class QuestionRepository {
  constructor(private readonly store: Storage) {}
  list(): { id: string; bookId: string; title: string; updatedAt: string; question: QuestionMetadata }[] {
    return this.store.db.prepare(`SELECT id,book_id,json_extract(value,'$.title') AS title,
      json_extract(value,'$.updatedAt') AS updated_at,json_extract(value,'$.question') AS question
      FROM records WHERE kind='note' AND json_type(value,'$.question')='object'
      AND json_extract(value,'$.deletedAt') IS NULL`).all().map((row) => ({
        id: String(row.id), bookId: String(row.book_id), title: String(row.title), updatedAt: String(row.updated_at),
        question: QuestionMetadataSchema.parse(JSON.parse(String(row.question))),
      }));
  }
  title(bookId: string, id?: string): string | undefined {
    if (!id) return;
    const row = this.store.db.prepare(`SELECT json_extract(value,'$.title') AS title FROM records
      WHERE kind='note' AND book_id=? AND id=? AND json_extract(value,'$.deletedAt') IS NULL`).get(bookId, id);
    return row ? String(row.title) : undefined;
  }
  visits() {
    return this.store.list<{ bookId: string; questionId: string; openedAt: string }>("question-navigation");
  }
  visit(bookId: string, questionId: string) {
    const value = { bookId, questionId, openedAt: new Date().toISOString() };
    this.store.put("question-navigation", `${bookId}:${questionId}`, bookId, value);
    return value;
  }
  review(bookId: string, requestId: string) {
    return this.store.getForBook<ReviewReceipt>("question-material-review", `${bookId}:${requestId}`, bookId);
  }
  saveReview(bookId: string, requestId: string, value: ReviewReceipt) {
    this.store.put("question-material-review", `${bookId}:${requestId}`, bookId, value);
  }
}
