import type { BookWorkspace } from "../../../packages/protocol/src/workspace";
import type { Library } from "./library";
import { Workspaces } from "./workspace";

/** Called inside the Note lifecycle transaction; an invalid inverse rolls everything back. */
export function changeNotePlacement(library: Library, bookId: string, noteId: string, restore: boolean) {
  const workspace = library.store.workspaces.get(bookId);
  if (!workspace) return false;
  const key = `${bookId}:${noteId}`;
  if (!restore) {
    const cards = workspace.cards.filter((card) => card.noteId === noteId);
    if (!cards.length) return false;
    const ids = new Set(cards.map((card) => card.id));
    const links = workspace.links.filter((link) => ids.has(link.from) || ids.has(link.to));
    library.store.put("note-removed-placement", key, bookId, { cards, links });
    new Workspaces(library).save(bookId, { ...workspace,
      cards: workspace.cards.filter((card) => !ids.has(card.id)),
      links: workspace.links.filter((link) => !ids.has(link.from) && !ids.has(link.to)) });
  } else {
    const removed = library.store.get<Pick<BookWorkspace, "cards" | "links">>("note-removed-placement", key);
    if (!removed) return false;
    if (workspace.cards.some((card) => card.noteId === noteId || removed.cards.some((old) => old.id === card.id)) ||
      workspace.links.some((link) => removed.links.some((old) => old.id === link.id)))
      throw new Error("卡片或关系已变化，无法恢复笔记；内容未修改");
    new Workspaces(library).save(bookId, { ...workspace,
      cards: [...workspace.cards, ...removed.cards], links: [...workspace.links, ...removed.links] });
    library.store.remove("note-removed-placement", key);
  }
  return true;
}
