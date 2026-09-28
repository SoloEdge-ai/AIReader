import type { Note } from "../../../../../packages/protocol/src/notes";
import type { BookWorkspace, WorkspaceObject } from "../../../../../packages/protocol/src/workspace";

type Catalog = Pick<BookWorkspace, "cards" | "objects" | "links"> & Partial<Pick<BookWorkspace, "groups">>;
export type MaterialCategory = "all" | "excerpt" | "note" | "drawing";
export type MaterialSort = "page" | "type";
export type MaterialEntry = {
  id: string;
  category: Exclude<MaterialCategory, "all">;
  title: string;
  detail: string;
  page?: number;
  searchText: string;
  sourceOrder: number;
  placed?: boolean;
  noteId?: string;
  groupId?: string;
};

const categoryOrder: Record<MaterialEntry["category"], number> = {
  excerpt: 0, note: 1, drawing: 2,
};
const shapeNames = { rectangle: "矩形", ellipse: "椭圆", line: "直线", arrow: "箭头" } as const;

function documentText(node: Note["document"]): string {
  return [node.text ?? "", String(node.attrs?.latex ?? ""), ...(node.content ?? []).map(documentText)].join(" ");
}

function objectTitle(object: WorkspaceObject): string {
  if (object.kind === "ink") return object.brush === "pen" ? "画笔笔迹" : "荧光笔笔迹";
  if (object.kind === "text") return object.text.trim().slice(0, 40) || "文字";
  return shapeNames[object.shape];
}

function objectPage(object: WorkspaceObject): number | undefined {
  if (object.kind !== "ink") return object.surface.kind === "pdf" ? object.surface.page : undefined;
  const pdfPages = object.segments.flatMap((segment) => segment.surface.kind === "pdf" ? [segment.surface.page] : []);
  return pdfPages.length ? Math.min(...pdfPages) : undefined;
}

/** A read-only navigation projection. No sorting or filtering mutates persisted workspace arrays. */
export function buildMaterialCatalog(catalog: Catalog | undefined, notes: Note[]): MaterialEntry[] {
  if (!catalog) return [];
  const noteById = new Map(notes.map((note) => [note.id, note]));
  const entries: MaterialEntry[] = [];
  const representedNotes = new Set<string>();
  for (const card of catalog.cards) {
    const note = card.noteId ? noteById.get(card.noteId) : undefined;
    if (card.kind === "note" && card.noteId) representedNotes.add(card.noteId);
    const title = note?.title ?? (card.noteId ? "未命名笔记" : card.title || "未命名卡片");
    const page = card.region?.page ?? card.source?.anchors[0]?.page;
    const kind = card.kind === "note" ? "个人笔记" : card.kind === "region" ? "图片摘录" : "原文摘录";
    entries.push({ id: card.id, category: card.kind === "note" ? "note" : "excerpt", title,
      detail: `${page ? `第 ${page} 页 · ` : ""}${kind}${card.placed === false ? " · 未放置" : ""}`, page,
      placed: card.placed !== false, noteId: card.noteId,
      groupId: catalog.groups?.find((group) => group.memberIds.includes(card.id))?.id,
      searchText: `${title} ${card.text} ${note ? documentText(note.document) : card.comment} ${note?.sourceReferences.map((source) => `${source.title} ${source.text}`).join(" ") ?? ""}`,
      sourceOrder: entries.length });
  }
  for (const note of notes) if (!representedNotes.has(note.id) && !note.deletedAt) {
    entries.push({ id: note.id, category: "note", title: note.title,
      detail: note.origin ? "AI 笔记 · 仅在材料库" : "个人笔记 · 仅在材料库",
      noteId: note.id, placed: false,
      searchText: `${note.title} ${documentText(note.document)} ${note.sourceReferences.map((source) => `${source.title} ${source.text}`).join(" ")}`,
      sourceOrder: entries.length });
  }
  for (const object of catalog.objects) {
    const page = objectPage(object);
    const title = objectTitle(object);
    entries.push({ id: object.id, category: "drawing", title,
      detail: object.kind === "ink" ? `${page ? `第 ${page} 页 · ` : ""}个人笔迹`
        : page ? `第 ${page} 页` : "白板",
      page, groupId: catalog.groups?.find((group) => group.memberIds.includes(object.id))?.id,
      searchText: `${title} ${object.kind === "text" ? object.text : ""}`,
      sourceOrder: entries.length });
  }
  for (const link of catalog.links) {
    const title = link.label || "关系连线";
    entries.push({ id: link.id, category: "drawing", title, detail: "对象关系",
      searchText: title, sourceOrder: entries.length });
  }
  return entries;
}

export function selectMaterialCatalog(entries: MaterialEntry[], selection: {
  query: string; category: MaterialCategory; sort: MaterialSort; groupId?: string;
}): MaterialEntry[] {
  const query = selection.query.trim().toLocaleLowerCase();
  return entries.filter((entry) => (selection.category === "all" || entry.category === selection.category) &&
    (!selection.groupId || entry.groupId === selection.groupId) &&
    entry.searchText.toLocaleLowerCase().includes(query))
    .sort((left, right) => {
      const type = categoryOrder[left.category] - categoryOrder[right.category];
      const page = left.page === right.page ? 0 : left.page === undefined ? 1 :
        right.page === undefined ? -1 : left.page - right.page;
      return selection.sort === "type" ? type || page || left.sourceOrder - right.sourceOrder
        : page || type || left.sourceOrder - right.sourceOrder;
    });
}
