import type { Note, RichNode } from "../../../../../packages/protocol/src";
import type { BookNotes } from "./useBookNotes";
import { MaterialKind } from "../../ui/MaterialKind";
import { IconButton } from "../../ui/IconButton";
import type { ReactNode } from "react";

const text = (node: RichNode): string => {
  if (node.type === "inlineMath") return String(node.attrs?.latex ?? "");
  if (node.type === "blockMath") return `${String(node.attrs?.latex ?? "")}\n`;
  if (node.type === "sourceReference") return "〔来源〕";
  const separator = node.type === "tableRow" ? " | " : "";
  const content = (node.content ?? []).map(text).join(separator);
  return (node.text ?? "") + content +
    (["paragraph", "heading", "listItem", "codeBlock", "blockMath", "tableRow"].includes(node.type)
      ? "\n" : "");
};

export const noteSourceCount = (note: Note) => {
  const targets = new Set(note.sourceReferences.map((reference) =>
    `${reference.kind}:${reference.targetId}`));
  return note.sourceReferences.reduce((count, reference) =>
    count + (reference.source?.anchors.length ?? 1), 0) +
    (note.annotationSource && !targets.has(`annotation:${note.annotationSource.id}`)
      ? note.annotationSource.anchors.length : 0) +
    (note.sourceCard && !targets.has(`card:${note.sourceCard.cardId}`)
      ? note.sourceCard.source?.anchors.length ?? 1 : 0) +
    (note.origin?.sources.length ?? 0);
};

/** Placements are always lightweight previews. Rich-text editing belongs to ExpandedNote. */
export function NoteCardContent({ note, state, editing: _editing, compact = false, showMeta = true, onExpand, materialLocations, questionControls }: {
  note?: Note;
  state?: BookNotes;
  /** Kept while callers migrate; selection never mounts a second editor. */
  editing?: boolean;
  compact?: boolean;
  showMeta?: boolean;
  onExpand?: (note: Note) => void;
  materialLocations?: Map<string, "placed" | "unplaced">;
  questionControls?: ReactNode;
}) {
  if (!note) return <p role="status">笔记正在加载或已删除，请刷新工作区。</p>;
  const sources = noteSourceCount(note);
  const failed = state?.selected === note.id && state.status.startsWith("保存失败");
  const used = [...new Map((note.origin?.materials ?? []).flatMap((material) => material.sections
    .filter((section) => section.kind !== "relation").map((section, index) =>
      [section.targetId ?? `${material.title}:${index}`, section] as const))).values()];
  return <div className="workspace-note-content">
    {!compact && <strong>{note.title || "未命名笔记"}</strong>}
    {questionControls}
    <p className="workspace-note-preview">{text(note.document).trim() || "还没有写下内容"}</p>
    {used.length > 0 && <details className="note-used-materials"><summary>使用材料 · {used.length} 项</summary>
      {used.map((section, index) => <div key={index}><strong>{section.title || "所选材料"}</strong>
        <p>{section.text}</p><small>提问时的冻结版本
          {section.targetId && materialLocations && (!materialLocations.has(section.targetId) ? " · 原对象已删除" :
            materialLocations.get(section.targetId) === "unplaced" ? " · 未放置在画布" : "")}
        </small></div>)}
    </details>}
    {failed && <small className="workspace-note-error">保存失败，草稿仍保留</small>}
    {showMeta && <div className="workspace-note-kind">
      <MaterialKind kind={note.origin ? "ai" : "personal"} />
      {sources > 0 && <small title={`关联 ${sources} 处来源`}>来源 {sources}</small>}
      {onExpand && <IconButton icon="outward" label="展开编辑笔记" onClick={() => onExpand(note)} />}
    </div>}
  </div>;
}
