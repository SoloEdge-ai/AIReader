import React, { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { useWorkspace } from "../src/WorkspaceState";
import { useBookEditing } from "../src/features/book/useBookEditing";
import { post } from "../src/api";

function Editor({ bookId }: { bookId: string }) {
  const editing = useBookEditing(bookId);
  const state = useWorkspace(editing.workspace!);
  const [combinedSave, setCombinedSave] = useState("");
  const saveWithoutCanvas = async () => {
    const note = await editing.notes.create();
    if (!note || !state.value) throw new Error("书籍编辑会话尚未加载");
    editing.notes.edit(note.id, "同一书籍的笔记", {
      type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "笔记和位置一起保存" }] }],
    });
    state.change({ ...state.value, cards: [...state.value.cards, {
      id: "book-session-card", kind: "note", noteId: note.id,
      title: "", text: "", comment: "", x: 20, y: 40, width: 300, height: 240,
    }] });
    setCombinedSave((await editing.flush()) ? "已保存笔记和位置" : "保存失败");
  };
  return <main>
    <p role="status">{state.status}</p><p role="alert">{state.error}</p>
    {state.value && <input aria-label="卡片正文" value={state.value.cards.find((card) => card.id === "draft-card")?.text ?? ""}
      onChange={(event) => state.change((value) => ({ ...value, cards: [
        ...value.cards.filter((card) => card.id !== "draft-card"),
        { id: "draft-card", kind: "note", title: "Draft", text: event.target.value, comment: "", x: 20, y: 40, width: 300, height: 240 },
      ] }))} />}
    <button onClick={() => void state.flush()}>重试保存</button>
    <button onClick={() => void state.reload(true)}>刷新工作区</button>
    <button onClick={() => void saveWithoutCanvas()}>保存未挂载画布的书籍草稿</button>
    <span aria-label="书籍保存结果">{combinedSave}</span>
  </main>;
}
function Harness() {
  const [ready, setReady] = useState(false);
  useEffect(() => { void post("session", {}).then(() => setReady(true)); }, []);
  return ready && <Editor bookId={new URLSearchParams(location.search).get("book")!} />;
}
createRoot(document.getElementById("root")!).render(<Harness />);
