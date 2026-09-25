import type { QuestionMaterialSnapshot } from "../../../packages/protocol/src/question-materials";
import { Storage } from "./storage";

interface RequestReceipt {
  materialId: string;
  digest: string;
}

/** Owns frozen material records and their book-scoped idempotency receipts. */
export class QuestionMaterialRepository {
  constructor(private readonly store: Storage) {}

  get(bookId: string, sessionId: string, id: string): QuestionMaterialSnapshot | undefined {
    const value = this.store.getForBook<QuestionMaterialSnapshot>("question-material", id, bookId);
    return value?.sessionId === sessionId ? value : undefined;
  }

  request(bookId: string, requestId: string): RequestReceipt | undefined {
    return this.store.getForBook<RequestReceipt>("question-material-request",
      `${bookId}:${requestId}`, bookId);
  }

  /** A second request arriving during image I/O receives the original snapshot. */
  create(snapshot: QuestionMaterialSnapshot, requestId: string, digest: string,
    assertFresh: () => void): { snapshot: QuestionMaterialSnapshot; created: boolean } {
    let result: { snapshot: QuestionMaterialSnapshot; created: boolean } | undefined;
    const bookId = snapshot.bookId;
    this.store.transaction(() => {
      const existing = this.request(bookId, requestId);
      if (existing) {
        if (existing.digest !== digest) throw new Error("材料操作标识已被其他内容使用");
        const value = this.get(bookId, snapshot.sessionId, existing.materialId);
        if (!value) throw new Error("材料请求回执无效，请重新选择材料");
        result = { snapshot: value, created: false };
        return;
      }
      assertFresh();
      this.store.put("question-material", snapshot.id, bookId, snapshot);
      this.store.put("question-material-request", `${bookId}:${requestId}`, bookId,
        { materialId: snapshot.id, digest } satisfies RequestReceipt);
      result = { snapshot, created: true };
    });
    return result!;
  }

  commit(bookId: string, sessionId: string, ids: string[], turnId: string): void {
    for (const id of ids) {
      const value = this.get(bookId, sessionId, id);
      if (!value || value.committedTurnId)
        throw new Error("材料不存在、已提交或不属于当前书籍会话");
      this.store.put("question-material", id, bookId, { ...value, committedTurnId: turnId });
    }
  }

  expiredUncommitted(deadline: number): QuestionMaterialSnapshot[] {
    return this.store.list<QuestionMaterialSnapshot>("question-material")
      .filter((value) => !value.committedTurnId && Date.parse(value.createdAt) < deadline);
  }

  removeUncommitted(value: QuestionMaterialSnapshot): void {
    this.store.transaction(() => {
      const current = this.get(value.bookId, value.sessionId, value.id);
      if (!current || current.committedTurnId || current.createdAt !== value.createdAt) return;
      const receipts = this.store.db.prepare(
        "SELECT id,value FROM records WHERE kind='question-material-request' AND book_id=?",
      ).all(value.bookId) as { id: string; value: string }[];
      for (const receipt of receipts)
        if ((JSON.parse(receipt.value) as RequestReceipt).materialId === value.id)
          this.store.remove("question-material-request", receipt.id);
      this.store.remove("question-material", value.id);
    });
  }
}
