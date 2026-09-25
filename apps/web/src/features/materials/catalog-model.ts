import type { Note } from "../../../../../packages/protocol/src/notes";
import type { BookWorkspace, WorkspaceObject } from "../../../../../packages/protocol/src/workspace";

type Catalog = Pick<BookWorkspace, "cards" | "objects" | "links">;
export type MaterialCategory = "all" | "card" | "ink" | "text" | "shape" | "link";
export type MaterialSort = "page" | "type";
export type MaterialEntry = {
  id: string;
  category: Exclude<MaterialCategory, "all">;
  title: string;
  detail: string;
  page?: number;
  position: number;
  searchText: string;
  sourceOrder: number;
};

const categoryOrder: Record<MaterialEntry["category"], number> = {
  card: 0, ink: 1, text: 2, shape: 3, link: 4,
};
const shapeNames = { rectangle: "矩形", ellipse: "椭圆", line: "直线", arrow: "箭头" } as const;

function documentText(node: Note["document"]): string {
  return [node.text ?? "", ...(node.content ?? []).map(documentText)].join(" ");
}

function objectTitle(object: WorkspaceObject): string {
  if (object.kind === "ink") return object.brush === "pen" ? "画笔笔迹" : "荧光笔笔迹";
  if (object.kind === "text") return object.text.trim().slice(0, 40) || "文字";
  return shapeNames[object.shape];
}

function objectPosition(object: WorkspaceObject): { page?: number; position: number } {
  if (object.kind !== "ink") return {
    page: object.surface.kind === "pdf" ? object.surface.page : undefined,
    position: object.y,
  };
  const pdfPages = object.segments.flatMap((segment) => segment.surface.kind === "pdf" ? [segment.surface.page] : []);
  const page = pdfPages.length ? Math.min(...pdfPages) : undefined;
  const positions = object.segments.filter((segment) => page === undefined ||
    (segment.surface.kind === "pdf" && segment.surface.page === page))
    .flatMap((segment) => segment.points.map((point) => point[1]));
  return { page, position: Math.min(...positions) };
}

/** A read-only navigation projection. No sorting or filtering mutates persisted workspace arrays. */
export function buildMaterialCatalog(catalog: Catalog | undefined, notes: Note[]): MaterialEntry[] {
  if (!catalog) return [];
  const noteById = new Map(notes.map((note) => [note.id, note]));
  const entries: MaterialEntry[] = [];
  for (const card of catalog.cards) {
    const note = card.noteId ? noteById.get(card.noteId) : undefined;
    const title = note?.title ?? (card.noteId ? "未命名笔记" : card.title || "未命名卡片");
    const page = card.region?.page ?? card.source?.anchors[0]?.page;
    const kind = card.kind === "note" ? "个人笔记" : card.kind === "region" ? "图片摘录" : "原文摘录";
    entries.push({ id: card.id, category: "card", title,
      detail: `${page ? `第 ${page} 页 · ` : ""}${kind}`, page, position: card.y,
      searchText: `${title} ${card.text} ${note ? documentText(note.document) : card.comment}`,
      sourceOrder: entries.length });
  }
  for (const object of catalog.objects) {
    const { page, position } = objectPosition(object);
    const title = objectTitle(object);
    entries.push({ id: object.id, category: object.kind, title,
      detail: object.kind === "ink" ? `${page ? `第 ${page} 页 · ` : ""}个人笔迹`
        : page ? `第 ${page} 页` : "白板",
      page, position, searchText: `${title} ${object.kind === "text" ? object.text : ""}`,
      sourceOrder: entries.length });
  }
  for (const link of catalog.links) {
    const title = link.label || "关系连线";
    entries.push({ id: link.id, category: "link", title, detail: "对象关系",
      position: Number.POSITIVE_INFINITY, searchText: title, sourceOrder: entries.length });
  }
  return entries;
}

export function selectMaterialCatalog(entries: MaterialEntry[], selection: {
  query: string; category: MaterialCategory; sort: MaterialSort;
}): MaterialEntry[] {
  const query = selection.query.trim().toLocaleLowerCase();
  return entries.filter((entry) => (selection.category === "all" || entry.category === selection.category) &&
    entry.searchText.toLocaleLowerCase().includes(query))
    .sort((left, right) => {
      const type = categoryOrder[left.category] - categoryOrder[right.category];
      const page = (left.page ?? Infinity) - (right.page ?? Infinity);
      const position = left.position - right.position;
      // Infinity - Infinity is NaN; the source order is the deterministic final key.
      if (selection.sort === "type") return type || (Number.isNaN(page) ? 0 : page) ||
        (Number.isNaN(position) ? 0 : position) || left.sourceOrder - right.sourceOrder;
      return (Number.isNaN(page) ? 0 : page) || type ||
        (Number.isNaN(position) ? 0 : position) || left.sourceOrder - right.sourceOrder;
    });
}
