import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import type {
  Book,
  ChatTurn,
  ReadingSnapshot,
  ReadingSelection,
  SourceAnchor,
  Note,
  PdfAnchor,
} from "../../../packages/protocol/src";
import { MAX_QUESTION_MATERIALS, questionMaterialCount } from "../../../packages/protocol/src";
import { api, post, base } from "./api";
import { useAi, ModelPicker, AccountControls } from "./AiState";
import { Icon } from "./ui/Icon";
import { Popover } from "./ui/Popover";
import { ChatMessage } from "./ChatMessage";
import { SelectionContext } from "./SelectionContext";
import { ChatImageList } from "./ChatImageList";
import type { QuestionDraft, QuestionDraftStore } from "./QuestionDrafts";
export type SelectionAction = {
  name: string;
  nonce: number;
  selection: ReadingSelection;
};
type Session = { id: string; title: string; updatedAt: string };
export function ChatPanel({
  book,
  page,
  selection,
  action,
  savedDrafts,
  onActionConsumed,
  onClearSelection,
  onPickSelection,
  onCitation,
  notes,
  onNoteSaved,
  onStartRegion,
  onSessionChange,
  onMaterialLocate,
}: {
  book: Book;
  page: number;
  selection?: ReadingSelection;
  action?: SelectionAction;
  savedDrafts: QuestionDraftStore;
  onActionConsumed: () => void;
  onClearSelection: () => void;
  onPickSelection: () => void;
  onCitation: (page: number, anchor: SourceAnchor) => void;
  notes: Note[];
  onNoteSaved: (note: Note) => Promise<void>;
  onStartRegion: (sessionId: string) => void;
  onSessionChange: (sessionId: string) => void;
  onMaterialLocate: (anchors: PdfAnchor[]) => void;
}) {
  const ai = useAi();
  const [session, setSession] = useState(""),
    [sessions, setSessions] = useState<Session[]>([]),
    [turns, setTurns] = useState<ChatTurn[]>([]),
    [error, setError] = useState("");
  const draftKey = book.id + ":" + session;
  const draft = useSyncExternalStore(savedDrafts.subscribe, () =>
    savedDrafts.get(draftKey),
  );
  const { question, scope, attachment, images, materials, preparing, imageError, materialError } = draft;
  const imagePicker = useRef<HTMLInputElement>(null);
  function addImages(files: File[]) {
    if (session && files.length) void savedDrafts.addImages(draftKey, files);
  }
  const [renaming, setRenaming] = useState(false),
    [title, setTitle] = useState("");
  const input = useRef<HTMLTextAreaElement>(null),
    messages = useRef<HTMLDivElement>(null);
  const currentSession = useRef(session),
    submitting = useRef(false);
  const [sending, setSending] = useState(false),
    [creating, setCreating] = useState(false);
  const followBottom = useRef(true);
  const [awayFromBottom, setAwayFromBottom] = useState(false);
  currentSession.current = session;
  useEffect(() => {
    if (session) onSessionChange(session);
  }, [session, onSessionChange]);
  function updateDraft(patch: Partial<QuestionDraft>) {
    if (currentSession.current)
      savedDrafts.update(book.id + ":" + currentSession.current, patch);
  }
  const setQuestion = (question: string) => updateDraft({ question });
  function setScope(scope: ReadingSnapshot["scope"]) {
    updateDraft({
      scope,
      ...(scope !== "selection" ? { attachment: undefined } : {}),
    });
  }
  function attach(value: ReadingSelection) {
    updateDraft({ attachment: structuredClone(value), scope: "selection" });
    onClearSelection();
  }
  useEffect(
    () => () => {
      currentSession.current = "";
    },
    [],
  );
  function switchSession(id: string) {
    currentSession.current = id;
    setSession(id);
    setRenaming(false);
    followBottom.current = true;
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
          switchSession(
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
    if (action && session) {
      attach(action.selection);
      if (action.name !== "提问") setQuestion(`请${action.name}选中的原文。`);
      onActionConsumed();
      input.current?.focus();
    }
  }, [action?.nonce, session]);
  const latest = turns.at(-1);
  useEffect(() => {
    if (followBottom.current && messages.current)
      messages.current.scrollTop = messages.current.scrollHeight;
  }, [latest?.id, latest?.answer, latest?.reasoning, latest?.status]);
  const running = turns.find((t) => t.status === "running");
  const chosen = ai.models.find((m) => m.model === ai.choice?.model);
  const valid = chosen?.supportedReasoningEfforts.some(
    (e) => e.reasoningEffort === ai.choice?.effort,
  );
  const materialCount = questionMaterialCount(materials, images.length, Boolean(attachment));
  const canSubmit =
    (!!question.trim() || !!images.length || !!materials.length) &&
    materialCount <= MAX_QUESTION_MATERIALS &&
    !preparing &&
    !!session &&
    !!valid &&
    !!ai.account.account &&
    !sending &&
    !creating &&
    !ai.selecting &&
    !running &&
    (scope !== "selection" || !!attachment);
  async function ask() {
    if (!canSubmit || submitting.current) return;
    submitting.current = true;
    setSending(true);
    const requestedSession = session;
    const submittedDraft = draft;
    setError("");
    try {
      const reading = {
        bookId: book.id,
        page: scope === "selection" ? (attachment?.page ?? page) : page,
        selection: scope === "selection" ? (attachment?.text ?? "") : "",
        scope,
      };
      const turn = await post<ChatTurn>(`books/${book.id}/turns`, {
        reading,
        question: question.trim() || (materials.length ? "请解释本轮选定材料。" : "请解释这些图片。"),
        images: images.map(({ name, dataUrl, source }) => ({
          name,
          dataUrl,
          source,
        })),
        materialIds: materials.map((material) => material.id),
        sessionId: session,
        ...ai.choice,
      });
      savedDrafts.clearIfUnchanged(draftKey, submittedDraft);
      if (currentSession.current === requestedSession) {
        setTurns((old) =>
          old.some((t) => t.id === turn.id) ? old : [...old, turn],
        );
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
          <ChatMessage
            key={turn.id}
            turn={turn}
            onCitation={onCitation}
            savedNote={notes.find((note) => note.origin?.turnId === turn.id)}
            onNoteSaved={onNoteSaved}
            onMaterialLocate={onMaterialLocate}
          />
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
      {(error || ai.error) && <p className="error">{error || ai.error}</p>}
      {ai.choice && ai.models.length > 0 && !valid && (
        <p className="error">所选模型或强度已不可用，请重新选择。</p>
      )}
      <div
        className="composer"
        onDragOver={(event) => {
          if (event.dataTransfer.types.includes("Files")) {
            event.preventDefault();
            event.stopPropagation();
          }
        }}
        onDrop={(event) => {
          event.preventDefault();
          event.stopPropagation();
          addImages(Array.from(event.dataTransfer.files));
        }}
      >
        <div className="composer-materials">
          {(!!materials.length || !!images.length || !!attachment) &&
            <span className="question-material-heading">本轮材料 · {materialCount} 项</span>}
          {!!materials.length && <div className="question-material-list" aria-label="本轮材料">
            {materials.map((material) => {
              const anchors = material.sections.flatMap((section) => section.anchors ?? []);
              return <div className="question-material-item" key={material.id}>
                <div className="question-material-item-head">
                  <span>{material.title} · {material.itemCount} 项</span>
                  {anchors.length > 0 && <button onClick={() => onMaterialLocate(anchors)}>定位</button>}
                  <button aria-label={`移除材料 ${material.title}`} onClick={() => updateDraft({
                    materials: materials.filter((item) => item.id !== material.id), materialError: undefined,
                  })}>移除</button>
                </div>
                <details><summary>查看将发送的内容</summary>
                  {material.sections.map((section, index) => <p key={index}>
                    <small>{section.kind === "book-excerpt" ? "原文摘录" :
                      section.kind === "book-region" ? "PDF 区域" :
                        section.kind === "relation" ? "关系" : "用户材料"}</small>
                    {section.text}
                  </p>)}
                  {material.images.map((image) => <figure key={image.id}>
                    <img src={`${base}/api/books/${book.id}/question-materials/${material.id}/images/${image.id}?session=${encodeURIComponent(session)}`}
                      alt={`${material.title}的冻结预览`} />
                    <figcaption>{image.includesPdfBackground ? `包含 PDF 第 ${image.page} 页背景` : "仅所选个人对象"}
                      {image.userRendered && " · 用户选择的视觉预览，非核验原文"}</figcaption>
                  </figure>)}
                </details>
              </div>;
            })}
          </div>}
          {materialError && <p className="error" role="alert">{materialError}</p>}
          {materialCount > MAX_QUESTION_MATERIALS &&
            <p className="error" role="alert">本轮材料最多 20 项，请移除部分内容。</p>}
          <ChatImageList
            images={images.map((image) => ({
              ...image,
              url: image.dataUrl,
              pageLabel: image.source
                ? book.labels[image.source.page - 1]
                : undefined,
            }))}
            onRemove={(id) =>
              updateDraft({
                images: images.filter((image) => image.id !== id),
                imageError: undefined,
              })
            }
          />
          {!!images.length && (
            <p className="image-hint">
              图片仅随本轮发送；未填写问题时默认“请解释这些图片。”
            </p>
          )}
          {!!preparing && (
            <p className="image-hint" role="status">
              正在处理图片…
            </p>
          )}
          {imageError && (
            <p className="error" role="alert">
              {imageError}
            </p>
          )}
          <SelectionContext
            key={session}
            attached={attachment}
            candidate={selection}
            disabled={!session || creating}
            onAttach={attach}
            onRemove={() =>
              updateDraft({ attachment: undefined, scope: "auto" })
            }
            onPick={onPickSelection}
          />
        </div>
        <div className="composer-scope">
          <Icon name="book" />
          <select
            aria-label="提问范围"
            value={scope}
            onChange={(e) => {
              if (e.target.value === "selection" && !attachment && selection)
                attach(selection);
              else setScope(e.target.value as ReadingSnapshot["scope"]);
            }}
          >
            <option value="auto">当前阅读位置</option>
            <option value="selection" disabled={!attachment && !selection}>
              选中原文
            </option>
            <option value="chapter">当前章节</option>
            <option value="book">整本书</option>
          </select>
          <span>
            第 {scope === "selection" ? (attachment?.page ?? page) : page} 页
          </span>
        </div>
        <textarea
          ref={input}
          aria-label="问题"
          placeholder="继续追问，或选中原文提问…"
          value={question}
          disabled={!session || creating}
          onChange={(e) => setQuestion(e.target.value)}
          onPaste={(event) => {
            const files = Array.from(event.clipboardData.files);
            if (files.length) {
              event.preventDefault();
              addImages(files);
            }
          }}
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
          <input
            ref={imagePicker}
            type="file"
            accept="image/png,image/jpeg,image/webp"
            multiple
            hidden
            aria-label="选择图片"
            onChange={(event) => {
              addImages(Array.from(event.target.files ?? []));
              event.target.value = "";
            }}
          />
          <button
            className="add-image"
            aria-label="添加图片"
            title="添加图片（也可粘贴截图）"
            disabled={!session || creating || !!preparing || images.length >= 4}
            onClick={() => imagePicker.current?.click()}
          >
            <Icon name="image" />
          </button>
          <button
            className="add-image"
            aria-label="框选书中图表"
            title="框选书中图表或公式"
            disabled={!session || creating || !!preparing || images.length >= 4}
            onClick={() => onStartRegion(session)}
          >
            <Icon name="crop" />
          </button>
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
              disabled={!canSubmit}
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
