import type {
  Annotation, Note, QuestionMaterialSection, QuestionMaterialSnapshot, RichNode,
} from "../../../../../packages/protocol/src";
import type { BookWorkspace, WorkspaceCard, WorkspaceObject } from "../../../../../packages/protocol/src/workspace";

export type MaterialSourceContext = {
  bookId: string;
  catalog?: Pick<BookWorkspace, "cards" | "objects" | "links">;
  notes?: readonly Note[];
  annotations?: readonly Annotation[];
};

export type MaterialSourceStatus = {
  kind: "current" | "updated" | "removed" | "unavailable";
  updatedCount: number;
  removedCount: number;
};

const plainText = (node: RichNode): string => {
  const content = (node.content ?? []).map(plainText).join("");
  return (node.text ?? "") + content +
    (["paragraph", "heading", "blockquote", "listItem", "codeBlock"].includes(node.type) ? "\n" : "");
};

type ComparableSection = Pick<QuestionMaterialSection, "kind" | "title" | "text" | "anchors">;
const comparable = (section: ComparableSection) => JSON.stringify({
  kind: section.kind, title: section.title, text: section.text, anchors: section.anchors ?? [],
});

function cardSections(card: WorkspaceCard, notes?: readonly Note[]): ComparableSection[] | undefined {
  let primary: ComparableSection;
  if (card.kind === "excerpt") {
    primary = { kind: "book-excerpt", title: card.title, text: card.text,
      anchors: card.source?.anchors };
  } else if (card.kind === "region" && card.region) {
    primary = { kind: "book-region", title: card.title,
      text: card.region.includePersonalMarks ? "PDF 区域截图，含个人标注" : "PDF 区域截图",
      anchors: [{ page: card.region.page, rects: [card.region.rect] }] };
  } else if (card.noteId) {
    if (!notes) return undefined;
    const note = notes.find((item) => item.id === card.noteId && !item.deletedAt);
    if (!note) return undefined;
    primary = { kind: "user-note", title: note.title, text: plainText(note.document) };
  } else {
    primary = { kind: "user-note", title: card.title, text: card.text };
  }
  return card.comment ? [primary, { kind: "user-note", title: `${card.title} · 个人评论`,
    text: card.comment }] : [primary];
}

function objectSections(object: WorkspaceObject): ComparableSection[] {
  if (object.kind === "text")
    return [{ kind: "user-note", title: "画布文字", text: object.text }];
  return [{ kind: "user-mark", title: object.kind === "ink" ? "个人笔迹" : "个人形状",
    text: object.kind === "shape" ? `形状：${object.shape}；颜色：${object.color}` :
      `画笔：${object.brush}；颜色：${object.color}` }];
}

/** Compare the live, book-scoped source with Core's frozen question projection.
 * The snapshot is never rewritten: even when a source disappears, sending still
 * uses the exact content displayed under “查看将发送的内容”. */
export function questionMaterialSourceStatus(material: QuestionMaterialSnapshot,
  context: MaterialSourceContext): MaterialSourceStatus {
  if (material.bookId !== context.bookId)
    return { kind: "unavailable", updatedCount: 0, removedCount: 0 };
  let updatedCount = 0;
  let removedCount = 0;
  let unavailableCount = 0;
  for (const target of material.targets) {
    let current: ComparableSection[] | undefined;
    let currentRevision: number | undefined;
    if (target.kind === "note") {
      if (!context.notes) { unavailableCount++; continue; }
      const note = context.notes.find((item) => item.id === target.id && !item.deletedAt);
      if (!note) { removedCount++; continue; }
      current = [{ kind: "user-note", title: note.title, text: plainText(note.document) }];
      currentRevision = note.revision;
    } else if (target.kind === "annotation") {
      if (!context.annotations) { unavailableCount++; continue; }
      const annotation = context.annotations.find((item) => item.id === target.id && !item.deletedAt);
      if (!annotation) { removedCount++; continue; }
      current = [{ kind: "user-mark", title: "个人批注",
        text: `${annotation.kind}；颜色：${annotation.color}；选中文字：${annotation.quote}`,
        anchors: annotation.anchors }];
      currentRevision = annotation.revision;
    } else {
      if (!context.catalog) { unavailableCount++; continue; }
      if (target.kind === "card") {
        const card = context.catalog.cards.find((item) => item.id === target.id);
        if (!card) { removedCount++; continue; }
        if (card.noteId && context.notes) {
          const note = context.notes.find((item) => item.id === card.noteId && !item.deletedAt);
          if (!note) { removedCount++; continue; }
          currentRevision = note.revision;
        }
        current = cardSections(card, context.notes);
      } else if (target.kind === "object") {
        const object = context.catalog.objects.find((item) => item.id === target.id);
        if (!object) { removedCount++; continue; }
        current = objectSections(object);
      } else {
        const link = context.catalog.links.find((item) => item.id === target.id);
        if (!link) { removedCount++; continue; }
        current = [{ kind: "relation", title: link.label || "对象关系",
          text: `关系 ${link.from} ${link.directed ? "→" : "—"} ${link.to}${link.label ? `：${link.label}` : ""}` }];
      }
      if (!current) { unavailableCount++; continue; }
    }
    const frozen = material.sections.filter((section) => section.targetId === target.id);
    if ((target.revision !== undefined && currentRevision !== undefined &&
      target.revision !== currentRevision) ||
      frozen.length !== current.length ||
      frozen.some((section, index) => comparable(section) !== comparable(current[index])))
      updatedCount++;
  }
  return { kind: removedCount ? "removed" : updatedCount ? "updated" : unavailableCount ?
    "unavailable" : "current", updatedCount, removedCount };
}
