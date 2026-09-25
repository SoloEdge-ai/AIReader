import type { Note, RichNode } from "../../../../../packages/protocol/src";
import type { BookNotes } from "./useBookNotes";
import { NoteEditor } from "./NoteEditor";

const text = (node: RichNode): string => (node.text ?? "") + (node.content ?? []).map(text).join("") +
  (["paragraph", "heading", "listItem", "codeBlock"].includes(node.type) ? "\n" : "");

/** Inactive placements stay lightweight; only the selected card mounts an editor. */
export function NoteCardContent({ note, state, editing, compact = false }: {
  note?: Note; state: BookNotes; editing: boolean; compact?: boolean;
}) {
  if (!note) return <p role="status">笔记正在加载或已删除，请刷新工作区。</p>;
  return <div className="workspace-note-content">
    {note.origin && <small>AI 回答笔记 · 可编辑</small>}
    {editing ? <NoteEditor key={note.id} note={note} state={state} /> : <>
      {!compact && <strong>{note.title}</strong>}
      <p className="workspace-note-preview">{text(note.document) || "点击编辑笔记…"}</p>
    </>}
  </div>;
}
