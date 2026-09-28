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
    const ids = new Set(cards.filter((card) => card.kind === "note").map((card) => card.id));
    const links = workspace.links.filter((link) => ids.has(link.from) || ids.has(link.to));
    const groups = workspace.groups.filter((group) => group.memberIds.some((id) => ids.has(id)));
    library.store.put("note-removed-placement", key, bookId, { cards, links, groups });
    new Workspaces(library).save(bookId, { ...workspace,
      cards: workspace.cards.filter((card) => !ids.has(card.id))
        .map((card) => card.noteId === noteId ? { ...card, noteId: undefined } : card),
      groups: workspace.groups.map((group) => ({ ...group,
        memberIds: group.memberIds.filter((id) => !ids.has(id)) })),
      links: workspace.links.filter((link) => !ids.has(link.from) && !ids.has(link.to)) }, true);
  } else {
    const removed = library.store.getForBook<Pick<BookWorkspace, "cards" | "links" | "groups">>(
      "note-removed-placement", key, bookId);
    if (!removed) return false;
    const placements = removed.cards.filter((card) => card.kind === "note");
    const sources = removed.cards.filter((card) => card.kind !== "note");
    if (workspace.cards.some((card) => card.noteId === noteId || placements.some((old) => old.id === card.id)) ||
      workspace.links.some((link) => removed.links.some((old) => old.id === link.id)))
      throw new Error("卡片或关系已变化，无法恢复笔记；内容未修改");
    const source = sources[0] && workspace.cards.find((card) => card.id === sources[0].id);
    const relink = source && !source.noteId;
    const placementIds = new Set(placements.map((card) => card.id));
    const restoredGroups = workspace.groups.map((group) => {
      const before = removed.groups.find((entry) => entry.id === group.id);
      if (!before) return group;
      const current = new Set(group.memberIds);
      return { ...group, memberIds: [
        ...before.memberIds.filter((id) => placementIds.has(id) || current.has(id)),
        ...group.memberIds.filter((id) => !before.memberIds.includes(id)),
      ] };
    });
    if (removed.groups.some((group) => !workspace.groups.some((entry) => entry.id === group.id)))
      throw new Error("主题组已变化，无法恢复笔记；内容未修改");
    if (placements.length || relink) new Workspaces(library).save(bookId, { ...workspace,
      cards: [...workspace.cards.map((card) => relink && card.id === source!.id
        ? { ...card, noteId } : card), ...placements],
      groups: restoredGroups,
      links: [...workspace.links, ...removed.links] }, true);
    library.store.remove("note-removed-placement", key);
    return Boolean(placements.length || relink);
  }
  return true;
}
