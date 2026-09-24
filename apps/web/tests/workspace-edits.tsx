import React, { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { useWorkspace } from "../src/WorkspaceState";
import { post } from "../src/api";

function Editor({ bookId }: { bookId: string }) {
  const state = useWorkspace(bookId);
  return <main>
    <p role="status">{state.status}</p><p role="alert">{state.error}</p>
    {state.value && <input aria-label="卡片正文" value={state.value.cards.find((card) => card.id === "draft-card")?.text ?? ""}
      onChange={(event) => state.change((value) => ({ ...value, cards: [
        ...value.cards.filter((card) => card.id !== "draft-card"),
        { id: "draft-card", kind: "note", title: "Draft", text: event.target.value, comment: "", x: 20, y: 40, width: 300, height: 240 },
      ] }))} />}
    <button onClick={() => void state.flush()}>重试保存</button>
    <button onClick={() => void state.reload(true)}>刷新工作区</button>
  </main>;
}
function Harness() {
  const [ready, setReady] = useState(false);
  useEffect(() => { void post("session", {}).then(() => setReady(true)); }, []);
  return ready && <Editor bookId={new URLSearchParams(location.search).get("book")!} />;
}
createRoot(document.getElementById("root")!).render(<Harness />);
