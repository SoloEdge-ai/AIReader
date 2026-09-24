import { useEffect, useRef, useState } from "react";
import type { Note } from "../../../../../packages/protocol/src";
import type { BookNotes } from "./useBookNotes";
import { NoteEditor } from "./NoteEditor";
import { Icon } from "../../ui/Icon";
import "./notes.css";

/** Non-modal workspace editor: chat remains usable and shares the same book session. */
export function ExpandedNote({ note, state, onClose }: { note: Note; state: BookNotes; onClose: () => void }) {
  const panel = useRef<HTMLElement>(null);
  const [closing, setClosing] = useState(false);
  useEffect(() => {
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : undefined;
    panel.current?.querySelector<HTMLInputElement>(".note-title")?.focus({ preventScroll: true });
    return () => { if (previous?.isConnected) previous.focus({ preventScroll: true }); };
  }, [note.id]);
  async function close() {
    if (closing) return;
    setClosing(true);
    try { if (await state.flush()) onClose(); }
    finally { setClosing(false); }
  }
  return <section className="expanded-note" ref={panel} role="dialog" aria-modal="false" aria-label="展开笔记编辑"
    onKeyDown={(event) => {
      if (event.nativeEvent.isComposing || event.key !== "Escape") return;
      // Link entry has a nearer cancel action; do not discard it by closing the editor.
      if ((event.target as HTMLElement).closest(".note-link-form")) return;
      event.preventDefault(); event.stopPropagation(); void close();
    }}>
    <header><span>笔记</span><button title="收起笔记编辑" aria-label="收起笔记编辑" disabled={closing} onClick={() => void close()}>
      <Icon name="close" />
    </button></header>
    <div className="expanded-note-content"><NoteEditor key={note.id} note={note} state={state} /></div>
    <footer><span role="status">{state.status}</span>
      {state.status.startsWith("保存失败") && <button onClick={() => void state.flush()}>重试保存</button>}
    </footer>
  </section>;
}
