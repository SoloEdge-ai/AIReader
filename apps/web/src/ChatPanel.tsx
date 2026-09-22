import { useEffect, useState } from "react";
import type {
  Book,
  ChatTurn,
  ReadingSnapshot,
  SourceAnchor,
} from "../../../packages/protocol/src";
import { api, post } from "./api";
import { IndexPanel } from "./IndexPanel";
import { ToolPanel } from "./ToolPanel";
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
  const [goal, setGoal] = useState("");
  const [question, setQuestion] = useState("");
  const [scope, setScope] = useState<ReadingSnapshot["scope"]>("auto");
  const [session, setSession] = useState(
    () => localStorage.getItem("session-" + book.id) ?? crypto.randomUUID(),
  );
  const [turns, setTurns] = useState<ChatTurn[]>([]);
  const [account, setAccount] = useState<any>({ connected: false });
  const [error, setError] = useState("");
  const [model, setModel] = useState("");
  const [models, setModels] = useState<any[]>([]);
  const [settings, setSettings] = useState(false);
  const [path, setPath] = useState("");
  const refresh = () =>
    api<ChatTurn[]>("books/" + book.id + "/turns?session=" + session).then(
      setTurns,
    );
  useEffect(() => {
    localStorage.setItem("session-" + book.id, session);
    let active = true;
    const update = () =>
      void api<ChatTurn[]>("books/" + book.id + "/turns?session=" + session)
        .then((t) => {
          if (active) setTurns(t);
        })
        .catch(() => {});
    update();
    const timer = setInterval(update, 1000);
    return () => {
      active = false;
      clearInterval(timer);
    };
  }, [book.id, session]);
  useEffect(() => {
    let active = true;
    const update = () =>
      void api("ai/status").then((a) => {
        if (active) setAccount(a);
      });
    update();
    const timer = setInterval(update, 4000);
    return () => {
      active = false;
      clearInterval(timer);
    };
  }, []);
  useEffect(() => {
    if (action) {
      setScope("selection");
      setQuestion(action.name === "提问" ? "" : `请${action.name}选中的原文。`);
    }
  }, [action?.nonce]);
  async function connect() {
    setError("");
    try {
      setAccount(await post("ai/connect", {}));
      setModels(await api<any[]>("ai/models"));
    } catch (e) {
      setError(String(e));
    }
  }
  async function ask() {
    if (!question.trim()) return;
    setError("");
    try {
      const reading = {
        bookId: book.id,
        page: selection?.page ?? page,
        selection: selection?.text ?? "",
        scope,
      };
      await post("books/" + book.id + "/turns", {
        reading,
        question,
        sessionId: session,
        model: model || undefined,
      });
      if (book.status === "ready")
        void post("books/" + book.id + "/index", {
          page: reading.page,
          full: false,
        }).catch(() => {});
      setQuestion("");
      await refresh();
    } catch (e) {
      setError(String(e));
    }
  }
  const running = turns.find((t) => t.status === "running");
  function answer(turn: ChatTurn) {
    return turn.answer.split(/(\[\[[^\]]+\]\])/g).map((part, i) => {
      if (part.startsWith("[[")) {
        const cite = turn.citations.find(
          (c) => c.passageId === part.slice(2, -2),
        );
        return cite ? (
          <button
            className="citation"
            key={i}
            onClick={() => onCitation(cite.page, cite)}
          >
            p.{cite.label}
          </button>
        ) : (
          <span key={i}>
            {turn.status === "running" ? "〔引用校验中〕" : "〔未验证引用〕"}
          </span>
        );
      }
      return <span key={i}>{part}</span>;
    });
  }
  return (
    <aside className="chat">
      <div className="chat-heading">
        <strong>阅读助手</strong>
        <button onClick={() => setSettings((v) => !v)}>设置</button>
        <button
          onClick={() => {
            if (!running) {
              setTurns([]);
              setSession(crypto.randomUUID());
            }
          }}
          disabled={!!running}
        >
          新会话
        </button>
      </div>
      {settings && (
        <div className="ai-settings">
          <p>{account.connected ? account.version : "尚未连接 Codex"}</p>
          <input
            placeholder="Codex 原生 EXE 绝对路径（可选）"
            value={path}
            onChange={(e) => setPath(e.target.value)}
          />
          <button
            onClick={() =>
              void post("ai/path", { path })
                .then(connect)
                .catch((e) => setError(String(e)))
            }
          >
            保存并连接
          </button>
          <button
            onClick={() => void post("ai/disconnect", {}).then(setAccount)}
          >
            断开
          </button>
          {models.length > 0 && (
            <select value={model} onChange={(e) => setModel(e.target.value)}>
              <option value="">Codex 默认模型</option>
              {models.map((m) => (
                <option key={m.id} value={m.model ?? m.id}>
                  {m.displayName ?? m.id}
                </option>
              ))}
            </select>
          )}
        </div>
      )}
      {!account.connected ? (
        <button className="connect" onClick={() => void connect()}>
          连接本机 Codex
        </button>
      ) : !account.account ? (
        <button
          onClick={() =>
            void post<any>("ai/login", {})
              .then((result) => {
                if (result.authUrl) {
                  const target = new URL(result.authUrl);
                  if (
                    target.protocol === "https:" &&
                    (target.hostname === "auth.openai.com" ||
                      target.hostname.endsWith(".openai.com"))
                  )
                    window.open(target.href, "_blank", "noopener");
                }
              })
              .catch((e) => setError(String(e)))
          }
        >
          通过 ChatGPT 登录
        </button>
      ) : (
        <p className="connection">● 已连接 ChatGPT · 复用本机登录</p>
      )}
      <div className="messages">
        {!turns.length && (
          <div className="chat-welcome">
            <p className="eyebrow">READ WITH UNDERSTANDING</p>
            <h2>一起读懂。</h2>
            <p>
              选中一段文字，或针对当前页面提问。
              <br />
              从原文出发，带着依据继续阅读。
            </p>
          </div>
        )}
        {turns.map((turn) => (
          <article className="turn" key={turn.id}>
            <div className="question">{turn.question}</div>
            <div className="answer">{answer(turn) || "正在阅读原文…"}</div>
            {turn.error && <p className="error">{turn.error}</p>}
            <details>
              <summary>
                本轮上下文 · 约 {turn.context.estimatedTokens.toLocaleString()}{" "}
                tokens
              </summary>
              <p>{turn.context.coverage}</p>
              <p>发送时位于第 {turn.context.reading.page} 页</p>
              {turn.context.evidence.map((p) => (
                <button
                  className="evidence"
                  key={p.id}
                  onClick={() => onCitation(p.page, p.anchor)}
                >
                  p.{p.anchor.label} · {p.text.slice(0, 160)}
                </button>
              ))}
              {turn.usage !== undefined && (
                <p>运行时用量：{JSON.stringify(turn.usage)}</p>
              )}
            </details>
          </article>
        ))}
      </div>
      <IndexPanel book={book} page={page} />
      <ToolPanel
        bookId={book.id}
        turn={turns.filter((t) => t.status === "complete").at(-1)}
      />
      <details className="index-panel">
        <summary>会话学习目标</summary>
        <input
          value={goal}
          maxLength={600}
          onChange={(e) => setGoal(e.target.value)}
          placeholder="例如：理解推理优化，偏好代码示例"
        />
        <button
          onClick={() =>
            void post("books/" + book.id + "/memory", {
              sessionId: session,
              goal,
            }).catch((e) => setError(String(e)))
          }
        >
          保存目标
        </button>
      </details>
      {selection && (
        <blockquote title={selection.text}>
          选区 · 第 {selection.page} 页<br />
          {selection.text.slice(0, 160)}
          {selection.text.length > 160 ? "…" : ""}
        </blockquote>
      )}
      {error && <p className="error">{error}</p>}
      <div className="composer">
        <select
          aria-label="提问范围"
          value={scope}
          onChange={(e) => setScope(e.target.value as ReadingSnapshot["scope"])}
        >
          <option value="auto">自动 · 结合阅读位置</option>
          <option value="selection">当前选区</option>
          <option value="chapter">当前章节</option>
          <option value="book">整本书</option>
        </select>
        <textarea
          aria-label="问题"
          placeholder="这里为什么这样设计？"
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
        <div>
          <small>原文按需发送至 AI 服务</small>
          {running ? (
            <button
              onClick={() =>
                void post(
                  "books/" + book.id + "/turns/" + running.id + "/cancel",
                  {},
                )
              }
            >
              停止生成
            </button>
          ) : (
            <button
              className="primary"
              disabled={!account.connected || !question.trim()}
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
