import { useEffect, useRef, useState } from "react";
import type {
  Book,
  ChatTurn,
  ReadingSnapshot,
  SourceAnchor,
} from "../../../packages/protocol/src";
import { api, post } from "./api";
import { useAi, ModelPicker, AccountControls } from "./AiState";
import { Icon } from "./Icon";
import { Popover } from "./Popover";
import { ChatMessage } from "./ChatMessage";
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
  const currentSession = useRef(session),
    drafts = useRef(new Map<string, string>()),
    submitting = useRef(false);
  const [sending, setSending] = useState(false),
    [creating, setCreating] = useState(false);
  const followBottom = useRef(true);
  const [awayFromBottom, setAwayFromBottom] = useState(false);
  currentSession.current = session;
  useEffect(
    () => () => {
      currentSession.current = "";
    },
    [],
  );
  function switchSession(id: string) {
    drafts.current.set(session, question);
    currentSession.current = id;
    setSession(id);
    setRenaming(false);
    followBottom.current = true;
    setQuestion(drafts.current.get(id) ?? "");
    setTurns([]);
    setError("");
  }
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
  useEffect(() => {
    if (followBottom.current && messages.current)
      messages.current.scrollTop = messages.current.scrollHeight;
  }, [turns]);
  const running = turns.find((t) => t.status === "running");
  const chosen = ai.models.find((m) => m.model === ai.choice?.model);
  const valid = chosen?.supportedReasoningEfforts.some(
    (e) => e.reasoningEffort === ai.choice?.effort,
  );
  async function ask() {
    if (
      !question.trim() ||
      !session ||
      !valid ||
      !ai.account.account ||
      submitting.current ||
      creating ||
      ai.selecting ||
      !!running ||
      (scope === "selection" && !selection)
    )
      return;
    submitting.current = true;
    setSending(true);
    const requestedSession = session;
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
      if (currentSession.current === requestedSession) {
        setTurns((old) =>
          old.some((t) => t.id === turn.id) ? old : [...old, turn],
        );
        setQuestion((old) => (old === question ? "" : old));
      }
      if (book.status === "ready")
        void post(`books/${book.id}/index`, {
          page: reading.page,
          full: false,
          model: turn.model,
          effort: turn.effort,
        }).catch(() => {});
      requestAnimationFrame(() => {
        if (currentSession.current === requestedSession) {
          followBottom.current = true;
          messages.current?.scrollTo({ top: messages.current.scrollHeight });
        }
      });
    } catch (e) {
      if (currentSession.current === requestedSession) setError(String(e));
    } finally {
      submitting.current = false;
      setSending(false);
    }
  }
  return (
    <aside className="chat">
      <div className="chat-heading">
        <Popover
          label="历史会话"
          triggerClass="session-trigger"
          className="session-menu"
          disabled={!sessions.length}
          trigger={
            <>
              <span>
                {sessions.find((s) => s.id === session)?.title ?? "新会话"}
              </span>
              <Icon name="down" />
            </>
          }
        >
          {(close) => (
            <>
              <p className="menu-caption">本书会话</p>
              {sessions.map((s) => (
                <button
                  key={s.id}
                  aria-pressed={s.id === session}
                  onClick={() => {
                    close();
                    switchSession(s.id);
                  }}
                >
                  <span>{s.title}</span>
                  {s.id === session && <Icon name="check" />}
                </button>
              ))}
            </>
          )}
        </Popover>
        <button
          className="chat-icon"
          aria-label="新建会话"
          title="新建会话"
          disabled={!!running || sending || creating}
          onClick={async () => {
            const requested = session;
            setCreating(true);
            try {
              const s = await post<Session>(`books/${book.id}/sessions`, {});
              if (currentSession.current === requested) {
                setSessions((old) => [s, ...old]);
                switchSession(s.id);
                input.current?.focus();
              }
            } catch (e) {
              if (currentSession.current === requested) setError(String(e));
            } finally {
              setCreating(false);
            }
          }}
        >
          <Icon name="newChat" />
        </button>
        <Popover
          label="会话操作"
          triggerClass="chat-icon"
          className="session-menu"
          width={180}
          disabled={!session}
          trigger={<Icon name="more" />}
        >
          {(close) => (
            <button
              onClick={() => {
                close();
                setTitle(sessions.find((s) => s.id === session)?.title ?? "");
                setRenaming(true);
              }}
            >
              <Icon name="pen" />
              重命名会话
            </button>
          )}
        </Popover>
      </div>
      {renaming && (
        <form
          className="rename-session"
          onSubmit={(e) => {
            e.preventDefault();
            void post(`books/${book.id}/sessions/${session}`, { title })
              .then(() => {
                setSessions((old) =>
                  old.map((s) =>
                    s.id === session ? { ...s, title: title.trim() } : s,
                  ),
                );
                setRenaming(false);
              })
              .catch((e) => setError(e.message));
          }}
        >
          <input
            autoFocus
            aria-label="会话名称"
            value={title}
            maxLength={100}
            onChange={(e) => setTitle(e.target.value)}
          />
          <button disabled={!title.trim()}>保存</button>
          <button type="button" onClick={() => setRenaming(false)}>
            取消
          </button>
        </form>
      )}
      {!ai.account.account && (
        <div className="chat-account">
          <AccountControls />
        </div>
      )}
      <div
        className="messages"
        ref={messages}
        onScroll={(e) => {
          const node = e.currentTarget;
          const near =
            node.scrollHeight - node.scrollTop - node.clientHeight < 80;
          followBottom.current = near;
          setAwayFromBottom(!near);
        }}
      >
        {!turns.length && ai.account.account && (
          <div className="chat-welcome">
            <h3>从正在读的地方开始</h3>
            <p>选中一段原文，或直接写下你的问题。</p>
            {["解释当前页面的核心概念", "这段内容和上一节有什么联系？"].map(
              (prompt) => (
                <button
                  key={prompt}
                  onClick={() => {
                    setQuestion(prompt);
                    setScope("auto");
                    input.current?.focus();
                  }}
                >
                  {prompt}
                  <Icon name="outward" />
                </button>
              ),
            )}
          </div>
        )}
        {turns.map((turn) => (
          <ChatMessage key={turn.id} turn={turn} onCitation={onCitation} />
        ))}
      </div>
      {awayFromBottom && (
        <button
          className="latest-message"
          onClick={() => {
            followBottom.current = true;
            messages.current?.scrollTo({ top: messages.current.scrollHeight });
          }}
        >
          回到最新消息
          <Icon name="down" />
        </button>
      )}
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
        <div className="composer-scope">
          <Icon name="book" />
          <select
            aria-label="提问范围"
            value={scope}
            onChange={(e) =>
              setScope(e.target.value as ReadingSnapshot["scope"])
            }
          >
            <option value="auto">当前阅读位置</option>
            <option value="selection" disabled={!selection}>
              选中原文
            </option>
            <option value="chapter">当前章节</option>
            <option value="book">整本书</option>
          </select>
          <span>
            第 {scope === "selection" ? (selection?.page ?? page) : page} 页
          </span>
        </div>
        <textarea
          ref={input}
          aria-label="问题"
          placeholder="继续追问，或选中原文提问…"
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
        <div className="composer-actions">
          <ModelPicker />
          {running ? (
            <button
              className="composer-send"
              aria-label="停止回答"
              title="停止回答"
              onClick={() =>
                void post(
                  `books/${book.id}/turns/${running.id}/cancel`,
                  {},
                ).catch((e) => setError(String(e)))
              }
            >
              <Icon name="stop" />
            </button>
          ) : (
            <button
              className="composer-send"
              aria-label="发送问题"
              title="发送问题（Enter）"
              disabled={
                sending ||
                creating ||
                ai.selecting ||
                (scope === "selection" && !selection) ||
                !valid ||
                !ai.account.account ||
                !question.trim() ||
                !session
              }
              onClick={() => void ask()}
            >
              <Icon name="arrow" />
            </button>
          )}
        </div>
      </div>
      <p className="composer-hint">Enter 发送 · Shift + Enter 换行</p>
    </aside>
  );
}
