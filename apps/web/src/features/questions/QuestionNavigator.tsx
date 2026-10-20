import { useEffect, useState } from "react";
import { questionStateLabels, type QuestionSummary } from "../../../../../packages/protocol/src";
import { api } from "../../api";
import { Icon } from "../../ui/Icon";
import { ResearchWindow } from "./ResearchWindow";

export function QuestionNavigator({ currentBookId, onNavigate, revision }: {
  currentBookId?: string; revision: number;
  onNavigate: (question: QuestionSummary, action: "continue" | "locate" | "review") => Promise<void>;
}) {
  const [open, setOpen] = useState(false), [items, setItems] = useState<QuestionSummary[]>([]);
  const [query, setQuery] = useState(""), [bookId, setBookId] = useState(""), [status, setStatus] = useState("unfinished");
  const [error, setError] = useState(""), [loading, setLoading] = useState(false), [busy, setBusy] = useState(false);
  useEffect(() => {
    if (!open) return;
    let live = true;
    setLoading(true);
    void api<QuestionSummary[]>("questions").then((value) => { if (live) { setItems(value); setError(""); } })
      .catch((error) => { if (live) setError(String(error)); }).finally(() => { if (live) setLoading(false); });
    return () => { live = false; };
  }, [open, revision]);
  async function navigate(question: QuestionSummary, action: "continue" | "locate" | "review") {
    if (busy) return;
    setBusy(true); setError("");
    try { await onNavigate(question, action); setOpen(false); } catch (error) { setError(String(error)); }
    finally { setBusy(false); }
  }
  const books = [...new Map(items.map((item) => [item.bookId, item.bookTitle])).entries()];
  const recent = items.find((item) => item.lastOpenedAt && (!bookId || item.bookId === bookId));
  const visible = items.filter((item) => (!bookId || item.bookId === bookId) &&
    (status === "all" || (status === "unfinished" ? item.status !== "concluded" : item.status === status)) &&
    `${item.title} ${item.bookTitle} ${item.conclusionTitle ?? ""}`.toLocaleLowerCase().includes(query.toLocaleLowerCase()));
  return <>
    <button aria-label="问题导航" title="问题导航" onClick={() => { setBookId(currentBookId ?? ""); setOpen(true); }}><Icon name="workspace" /></button>
    {open && <ResearchWindow title="全局问题导航" onClose={() => setOpen(false)}>
      <p>按书籍继续研究；提问材料始终属于打开的那本书。</p>
      {recent && <div className="question-resume"><strong>上次探究 · {recent.title}</strong>
        <button disabled={busy} onClick={() => void navigate(recent, "continue")}>继续上次问题</button></div>}
      <div className="question-filters">
        <input aria-label="搜索问题" placeholder="搜索问题、书籍或结论" value={query} maxLength={200} onChange={(event) => setQuery(event.target.value)} />
        <select aria-label="问题所属书籍" value={bookId} onChange={(event) => setBookId(event.target.value)}>
          <option value="">全部书籍</option>{books.map(([id, title]) => <option key={id} value={id}>{title}</option>)}
        </select>
        <select aria-label="筛选问题状态" value={status} onChange={(event) => setStatus(event.target.value)}>
          <option value="unfinished">未完成问题</option><option value="all">全部状态</option>
          {Object.entries(questionStateLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
        </select>
      </div>
      {loading && <p role="status">正在读取问题…</p>}
      {error && <p role="alert" className="error">{error}</p>}
      {!loading && !visible.length && <p>没有符合条件的问题。</p>}
      <div className="question-directory">{visible.map((item) => <article key={`${item.bookId}:${item.id}`} data-question-id={item.id}>
        <strong>{item.title}</strong><small>{item.bookTitle} · {questionStateLabels[item.status]} · {item.placed ? "已放置" : "未放置在画布"}</small>
        <p>{item.conclusionTitle ? `当前结论：${item.conclusionTitle}` : item.currentConclusionId ? "当前结论已删除或不可用" : "尚未选定当前结论"}</p>
        <div><button disabled={busy} onClick={() => void navigate(item, "continue")}>继续探究</button>
          <button disabled={busy} onClick={() => void navigate(item, "locate")}>查看问题</button>
          <button disabled={busy} onClick={() => void navigate(item, "review")}>检查材料更新</button></div>
      </article>)}</div>
    </ResearchWindow>}
  </>;
}
