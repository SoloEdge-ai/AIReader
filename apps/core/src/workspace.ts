import {
  WorkspaceSchema,
  type BookWorkspace,
} from "../../../packages/protocol/src/workspace";
import { Library } from "./library";

/** Spatial state is book-scoped and independent of rebuildable search indexes. */
export class Workspaces {
  constructor(private readonly library: Library) {}
  get(bookId: string): BookWorkspace {
    this.library.book(bookId);
    return (
      this.library.store.get<BookWorkspace>("workspace", bookId) ?? {
        bookId,
        revision: 0,
        cards: [],
        links: [],
      }
    );
  }
  save(bookId: string, input: unknown): BookWorkspace {
    const book = this.library.book(bookId);
    const value = WorkspaceSchema.parse(input);
    if (value.bookId !== bookId) throw new Error("工作区与书籍不匹配");
    const current = this.get(bookId);
    if (current.revision !== value.revision)
      throw new Error(
        "工作区已在其他窗口更新；草稿已保留，请重新打开后处理冲突",
      );
    const ids = new Set(value.cards.map((card) => card.id));
    if (
      ids.size !== value.cards.length ||
      new Set(value.links.map((link) => link.id)).size !== value.links.length
    )
      throw new Error("卡片或连接标识重复");
    for (const card of value.cards) {
      if (card.source) {
        if (card.source.fingerprint !== book.fingerprint)
          throw new Error("摘录不属于此 PDF");
        for (const anchor of card.source.anchors) {
          if (
            anchor.page > book.pages ||
            anchor.rects.some(
              (rect) => rect[2] <= rect[0] || rect[3] <= rect[1],
            )
          )
            throw new Error("摘录位置无效");
        }
      }
      const previous = current.cards.find((old) => old.id === card.id);
      if (
        previous &&
        (previous.kind !== card.kind ||
          JSON.stringify(previous.source) !== JSON.stringify(card.source) ||
          (card.kind === "excerpt" && previous.text !== card.text))
      )
        throw new Error("原文来源不可修改，请重新摘录；个人理解请写在评论中");
    }
    for (const link of value.links)
      if (link.from === link.to || !ids.has(link.from) || !ids.has(link.to))
        throw new Error("连接的卡片不存在");
    const saved = { ...value, revision: current.revision + 1 };
    this.library.store.put("workspace", bookId, bookId, saved);
    return saved;
  }
}
