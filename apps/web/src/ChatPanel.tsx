import { useEffect, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import rehypeKatex from "rehype-katex";
import "katex/dist/katex.min.css";
import type {
  Book,
  ChatTurn,
  ReadingSnapshot,
  SourceAnchor,
} from "../../../packages/protocol/src";
import { api, post } from "./api";
import { useAi, ModelPicker, AccountControls } from "./AiState";
type Session = { id: string; title: string; updatedAt: string };
export function ChatPanel({
  book,
  page,
  selection,
  action,
  onCitation,
}: {
  book: Book;
  page: number;
  selection?: { text: string; page: number };
  action?: { name: string; nonce: number };
  onCitation: (page: number, anchor: SourceAnchor) => void;
}) {
  const ai = useAi(),
    [question, setQuestion] = useState(""),
    [scope, setScope] = useState<ReadingSnapshot["scope"]>("auto");
  const [session, setSession] = useState(""),
    [sessions, setSessions] = useState<Session[]>([]),
    [turns, setTurns] = useState<ChatTurn[]>([]),
    [error, setError] = useState("");
  const [renaming, setRenaming] = useState(false),
    [title, setTitle] = useState("");
  const input = useRef<HTMLTextAreaElement>(null),
    messages = useRef<HTMLDivElement>(null);
  const currentSession=useRef(session), drafts=useRef(new Map<string,string>()), submitting=useRef(false);
  const [sending,setSending]=useState(false);
  currentSession.current=session;
  useEffect(()=>()=>{currentSession.current="";},[]);
  function switchSession(id:string){drafts.current.set(session,question);currentSession.current=id;setSession(id);setQuestion(drafts.current.get(id)??"");setTurns([]);setError("");}
  useEffect(() => {
    let live = true;
    void api<Session[]>(`books/${book.id}/sessions`)
      .then(async (list) => {
        if (!list.length)
          list = [await post<Session>(`books/${book.id}/sessions`, {})];
        if (live) {
          setSessions(list);
          const previous = localStorage.getItem("session-" + book.id);
          setSession(
            list.some((s) => s.id === previous) ? previous! : list[0].id,
          );
        }
      })
      .catch((e) => {
        if (live) setError(e.message);
      });
    return () => {
      live = false;
    };
  }, [book.id]);
  useEffect(() => {
    if (!session) return;
    localStorage.setItem("session-" + book.id, session);
    let live = true;
    let updating = false;
    const tick = async () => {
      if (updating) return;
      updating = true;
      try {
        const [values, list] = await Promise.all([
          api<ChatTurn[]>(
            `books/${book.id}/turns?session=${encodeURIComponent(session)}`,
          ),
          api<Session[]>(`books/${book.id}/sessions`),
        ]);
        if (live) {
          setTurns(values);
          setSessions(list);
        }
      } catch (e) {
        if (live) setError(String(e));
      } finally {
        updating = false;
      }
    };
    void tick();
    const timer = setInterval(() => void tick(), 1000);
    return () => {
      live = false;
      clearInterval(timer);
    };
  }, [book.id, session]);
  useEffect(() => {
    if (action) {
      setScope("selection");
      setQuestion(action.name === "提问" ? "" : `请${action.name}选中的原文。`);
      input.current?.focus();
    }
  }, [action?.nonce]);
  const running = turns.find((t) => t.status === "running");
  const chosen = ai.models.find((m) => m.model === ai.choice?.model);
  const valid = chosen?.supportedReasoningEfforts.some(
    (e) => e.reasoningEffort === ai.choice?.effort,
  );
  async function ask() {
    if (!question.trim() || !session || !valid || !ai.account.account || submitting.current) return;
    submitting.current=true;setSending(true);
    const requestedSession=session;
    setError("");
    try {
      const reading = {
        bookId: book.id,
        page: scope === "selection" ? (selection?.page ?? page) : page,
        selection: selection?.text ?? "",
        scope,
      };
      const turn = await post<ChatTurn>(`books/${book.id}/turns`, {
        reading,
        question,
        sessionId: session,
        ...ai.choice,
      });
      if(currentSession.current===requestedSession){
        setTurns((old) => old.some(t=>t.id===turn.id)?old:[...old, turn]);
        setQuestion(old=>old===question?"":old);
      }
      if (book.status === "ready")
        void post(`books/${book.id}/index`, {
          page: reading.page,
          full: false,
          model: turn.model,
          effort: turn.effort,
        }).catch(() => {});
      requestAnimationFrame(() =>
        messages.current?.scrollTo({ top: messages.current.scrollHeight }),
      );
    } catch (e) {
      if(currentSession.current===requestedSession)setError(String(e));
    }finally{submitting.current=false;setSending(false);}
  }
  const markdown = (turn: ChatTurn) =>
    turn.answer.replace(/\[\[([^\]]+)\]\]/g, (_, id: string) => {
      const anchor = turn.citations.find((c) => c.passageId === id);
      return anchor
        ? `[${anchor.label}](#source-${encodeURIComponent(id)})`
        : turn.status === "running"
          ? "〔引用校验中〕"
          : "〔未验证引用〕";
    });
  return (
    <aside className="chat">
      <div className="chat-heading">
        <select
          aria-label="历史会话"
          value={session}
          onChange={(e) => {
            switchSession(e.target.value);
          }}
        >
          {sessions.map((s) => (
            <option value={s.id} key={s.id}>
              {s.title}
            </option>
          ))}
        </select>
        <button
          title="重命名会话"
          onClick={() => {
            setTitle(sessions.find((s) => s.id === session)?.title ?? "");
            setRenaming(!renaming);
          }}
        >
          重命名
        </button>
        <button
          disabled={!!running}
          onClick={() =>
            void post<Session>(`books/${book.id}/sessions`, {}).then((s) => {
              setSessions((old) => [s, ...old]);
              switchSession(s.id);
            })
          }
        >
          新建
        </button>
      </div>
      {renaming && (
        <form
          className="rename-session"
          onSubmit={(e) => {
            e.preventDefault();
            void post(`books/${book.id}/sessions/${session}`, { title })
              .then(() => setRenaming(false))
              .catch((e) => setError(e.message));
          }}
        >
          <input
            aria-label="会话名称"
            value={title}
            maxLength={100}
            onChange={(e) => setTitle(e.target.value)}
          />
          <button disabled={!title.trim()}>保存</button>
        </form>
      )}
      {!ai.account.account && (
        <div className="chat-account">
          <AccountControls />
        </div>
      )}
      <div className="messages" ref={messages}>
        {!turns.length && ai.account.account && (
          <p className="chat-welcome">选中原文，或针对当前页面提问。</p>
        )}
        {turns.map((turn) => (
          <article className="turn" key={turn.id}>
            <div className="question">{turn.question}</div>
            <div className="answer markdown">
              <ReactMarkdown
                skipHtml
                remarkPlugins={[remarkGfm, remarkMath]}
                rehypePlugins={[
                  [rehypeKatex, { throwOnError: false, trust: false }],
                ]}
                components={{
                  img: () => null,
                  a: ({ href, children }) => {
                    if (href?.startsWith("#source-")) {
                      const anchor = turn.citations.find(
                        (c) => "#source-"+encodeURIComponent(c.passageId) === href,
                      );
                      return anchor ? (
                        <button
                          className="citation"
                          onClick={() => onCitation(anchor.page, anchor)}
                        >
                          第 {anchor.label} 页
                        </button>
                      ) : (
                        <span>{children}</span>
                      );
                    }
                    return (
                      <a href={href} target="_blank" rel="noopener noreferrer">
                        {children}
                      </a>
                    );
                  },
                }}
              >
                {markdown(turn) || "正在查找相关原文…"}
              </ReactMarkdown>
            </div>
            {turn.error && <p className="error">{turn.error}</p>}
            <details>
              <summary>来源与详情</summary>
              <p>
                {turn.model ?? "模型未记录"} · {turn.effort ?? "强度未记录"} ·
                约 {turn.context.estimatedTokens.toLocaleString()} tokens
              </p>
              <p>{turn.context.coverage}</p>
              {turn.context.evidence.map((p) => (
                <button
                  className="evidence"
                  key={p.id}
                  onClick={() => onCitation(p.page, p.anchor)}
                >
                  第 {p.anchor.label} 页 · {p.text.slice(0, 160)}
                </button>
              ))}
              {turn.usage !== undefined && (
                <p>运行时用量：{JSON.stringify(turn.usage)}</p>
              )}
            </details>
          </article>
        ))}
      </div>
      {selection && (
        <blockquote>
          选区 · 第 {selection.page} 页<br />
          {selection.text.slice(0, 140)}
        </blockquote>
      )}
      {(error || ai.error) && <p className="error">{error || ai.error}</p>}
      {ai.choice && ai.models.length > 0 && !valid && (
        <p className="error">所选模型或强度已不可用，请重新选择。</p>
      )}
      <div className="composer">
        <select
          aria-label="提问范围"
          value={scope}
          onChange={(e) => setScope(e.target.value as ReadingSnapshot["scope"])}
        >
          <option value="auto">当前阅读位置</option>
          <option value="selection" disabled={!selection}>
            选中原文
          </option>
          <option value="chapter">当前章节</option>
          <option value="book">整本书</option>
        </select>
        <textarea
          ref={input}
          aria-label="问题"
          placeholder="输入问题…"
          value={question}
          onChange={(e) => setQuestion(e.target.value)}
          onKeyDown={(e) => {
            if (
              e.key === "Enter" &&
              !e.shiftKey &&
              !e.nativeEvent.isComposing
            ) {
              e.preventDefault();
              if (!running) void ask();
            }
          }}
        />
        <ModelPicker />
        <div>
          <small>Shift + Enter 换行</small>
          {running ? (
            <button
              onClick={() =>
                void post(`books/${book.id}/turns/${running.id}/cancel`, {})
              }
            >
              停止
            </button>
          ) : (
            <button
              className="primary"
              disabled={
                !valid || !ai.account.account || !question.trim() || !session
              }
              onClick={() => void ask()}
            >
              发送 ↑
            </button>
          )}
        </div>
      </div>
    </aside>
  );
}
