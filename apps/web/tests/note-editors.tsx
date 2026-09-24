import React, { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { NoteEditor } from "../src/features/notes/NoteEditor";
import { useBookNotes } from "../src/features/notes/useBookNotes";
import { post } from "../src/api";
import "../src/style.css";

function Harness() {
  const [bookId, setBookId] = useState<string>();
  const state = useBookNotes(bookId);
  useEffect(() => {
    void post("session", {}).then(() => setBookId(new URLSearchParams(location.search).get("book")!));
  }, []);
  const note = state.notes[0];
  return <main>
    <p role="status">{state.status}</p>
    <button onClick={() => void state.flush()}>重试保存</button>
    <button onClick={() => void state.refresh()}>刷新记录</button>
    <button onClick={() => void state.retryWithLatest()}>用草稿覆盖最新版本</button>
    {note && <div style={{ display: "flex", gap: 24 }}>
      <section aria-label="列表编辑器"><NoteEditor note={note} state={state} /></section>
      <section aria-label="展开编辑器"><NoteEditor note={note} state={state} /></section>
    </div>}
  </main>;
}
createRoot(document.getElementById("root")!).render(<Harness />);
