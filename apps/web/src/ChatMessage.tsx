import { useId, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import rehypeKatex from "rehype-katex";
import "katex/dist/katex.min.css";
import type {
  ChatTurn,
  Note,
  SourceAnchor,
  PdfAnchor,
} from "../../../packages/protocol/src";
import { Icon } from "./Icon";
import { effortLabel } from "./ModelControl";
import { ChatImageList } from "./ChatImageList";
import { base, post } from "./api";

export function ChatMessage({
  turn,
  onCitation,
  savedNote,
  onNoteSaved,
  onMaterialLocate,
}: {
  turn: ChatTurn;
  onCitation: (page: number, anchor: SourceAnchor) => void;
  savedNote?: Note;
  onNoteSaved: (note: Note) => Promise<void>;
  onMaterialLocate: (anchors: PdfAnchor[]) => void;
}) {
  const [copyStatus, setCopyStatus] = useState("");
  const [savingNote, setSavingNote] = useState(false),
    [noteError, setNoteError] = useState("");
  const [reasoningExpanded, setReasoningExpanded] = useState<boolean>();
  const reasoningId = useId();
  const showReasoning = reasoningExpanded ?? turn.status === "running";
  const sources = [
    ...new Map(turn.citations.map((c) => [c.passageId, c])).values(),
  ];
  const markdown = turn.answer.replace(/\[\[([^\]]+)\]\]/g, (_, id: string) => {
    const anchor = sources.find((c) => c.passageId === id);
    return anchor
      ? `[原文](#source-${encodeURIComponent(id)})`
      : turn.status === "running"
        ? "〔引用校验中〕"
        : "〔未验证引用〕";
  });
  async function copy() {
    try {
      await navigator.clipboard.writeText(
        turn.answer.replace(/\[\[([^\]]+)\]\]/g, (_, id: string) => {
          const anchor = sources.find((c) => c.passageId === id);
          return anchor ? `〔第 ${anchor.label} 页〕` : "〔未验证引用〕";
        }),
      );
      setCopyStatus("已复制");
    } catch {
      setCopyStatus("复制失败，请选中文字后复制。");
    }
  }
  async function saveNote() {
    if (savingNote) return;
    setSavingNote(true);
    setNoteError("");
    try {
      const { note } = await post<{ note: Note; created: boolean }>(
        `books/${turn.bookId}/turns/${turn.id}/note`,
        {},
      );
      await onNoteSaved(note);
    } catch (error) {
      setNoteError(String(error));
    } finally {
      setSavingNote(false);
    }
  }
  return (
    <article className="turn">
      <div className="question">{turn.question}</div>
      <ChatImageList
        images={(turn.images ?? []).map((image) => ({
          ...image,
          url: `${base}/api/books/${turn.bookId}/chat-images/${image.id}`,
        }))}
      />
      {turn.context.reading.selection && (
        <details className="question-source">
          <summary>本轮引用 · 第 {turn.context.reading.page} 页起</summary>
          <p>{turn.context.reading.selection}</p>
        </details>
      )}
      {!!turn.context.materials?.length && <details className="sent-materials">
        <summary>本轮选定材料 · {turn.context.materials.reduce((count, material) => count + material.itemCount, 0)} 项</summary>
        {turn.context.materials.map((material) => {
          const anchors = material.sections.flatMap((section) => section.anchors ?? []);
          return <div className="sent-material" key={material.id}>
            <strong>{material.title}</strong>
            {anchors.length > 0 && <button onClick={() => onMaterialLocate(anchors)}>返回位置</button>}
            {material.sections.map((section, index) => <p key={index}>
              <small>{section.kind === "book-excerpt" ? "原文摘录" : section.kind === "book-region" ? "PDF 区域" : "个人材料"}</small>
              {section.text}
            </p>)}
            {material.images.map((image) => <img key={image.id}
              src={`${base}/api/books/${turn.bookId}/question-materials/${material.id}/images/${image.id}?session=${encodeURIComponent(turn.sessionId)}`}
              alt={`${material.title}的本轮冻结图片`} />)}
          </div>;
        })}
      </details>}
      <div className="assistant-label">
        <Icon name="book" />
        <span>AIReader</span>
      </div>
      <details className="retrieval-details">
        <summary>
          本轮依据 · 已提供 {turn.context.evidence.length} 段原文
        </summary>
        <div>
          <p>{turn.context.coverage}</p>
          <p>这些是发送给模型的检索材料，不代表回答已经核实了每一段。</p>
          {turn.context.evidence.map((passage) => (
            <button
              className="evidence"
              key={passage.id}
              onClick={() => onCitation(passage.page, passage.anchor)}
            >
              第 {passage.anchor.label} 页 · {passage.text.slice(0, 180)}
            </button>
          ))}
        </div>
      </details>
      {turn.reasoning !== undefined && (
        <section className="reasoning">
          <button
            aria-label="思考摘要"
            aria-expanded={showReasoning}
            aria-controls={reasoningId}
            onClick={() => setReasoningExpanded(!showReasoning)}
          >
            <Icon name="chevron" />
            思考摘要
            <span>
              {turn.status === "running"
                ? "生成中"
                : !turn.reasoning
                  ? "未提供"
                  : ""}
            </span>
          </button>
          {showReasoning && (
            <div id={reasoningId}>
              <div className="reasoning-summary">
                <ReactMarkdown
                  skipHtml
                  components={{
                    img: () => null,
                    a: ({ children }) => <span>{children}</span>,
                  }}
                >
                  {turn.reasoning ||
                    (turn.status === "running"
                      ? "正在等待模型提供摘要…"
                      : "本轮未返回思考摘要。")}
                </ReactMarkdown>
              </div>
              <p className="reasoning-caption">
                模型提供的摘要；事实依据请查看原文。
              </p>
            </div>
          )}
        </section>
      )}
      <div className="answer markdown">
        <ReactMarkdown
          skipHtml
          remarkPlugins={[remarkGfm, remarkMath]}
          rehypePlugins={[[rehypeKatex, { throwOnError: false, trust: false }]]}
          components={{
            img: () => null,
            a: ({ href, children }) => {
              if (href?.startsWith("#source-")) {
                const anchor = sources.find(
                  (c) => "#source-" + encodeURIComponent(c.passageId) === href,
                );
                return anchor ? (
                  <button
                    className="citation"
                    aria-label={`返回第 ${anchor.label} 页原文`}
                    onClick={() => onCitation(anchor.page, anchor)}
                  >
                    {anchor.label}
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
          {markdown ||
            (turn.status === "running"
              ? "正在等待模型回答…"
              : "尚无回答内容。")}
        </ReactMarkdown>
      </div>
      {turn.status === "running" && (
        <p className="turn-status" role="status">
          正在回答…
        </p>
      )}
      {turn.status === "cancelled" && <p className="turn-status">已停止回答</p>}
      {turn.error && turn.status !== "cancelled" && (
        <p className="error" role="alert">
          {turn.error}
        </p>
      )}
      {!!sources.length && (
        <details className="answer-sources">
          <summary>
            <Icon name="book" />
            {sources.length} 处原文
            <Icon name="chevron" />
          </summary>
          <div className="source-excerpts">
            {sources.map((source) => (
              <button
                className="evidence"
                key={source.passageId}
                onClick={() => onCitation(source.page, source)}
              >
                <span>
                  第 {source.label} 页<Icon name="outward" />
                </span>
                <span>
                  {turn.context.evidence
                    .find((p) => p.id === source.passageId)
                    ?.text.slice(0, 200) ?? "返回原文查看"}
                </span>
              </button>
            ))}
          </div>
        </details>
      )}
      <div className="answer-actions">
        <button
          aria-label="复制回答"
          title="复制回答"
          disabled={!turn.answer || turn.status === "running"}
          onClick={() => void copy()}
        >
          <Icon name={copyStatus === "已复制" ? "check" : "copy"} />
        </button>
        <button
          className="save-answer-note"
          disabled={turn.status !== "complete" || !turn.answer || savingNote}
          onClick={() => void saveNote()}
        >
          <Icon name="note" />
          {savingNote ? "保存中…" : savedNote ? "打开笔记" : "存为笔记"}
        </button>
        <details className="answer-details">
          <summary>
            回答详情
            <Icon name="down" />
          </summary>
          <div className="answer-metadata">
            <p>
              {turn.model ?? "模型未记录"} ·{" "}
              {turn.effort ? effortLabel(turn.effort) : "强度未记录"}
            </p>
            <p>
              本轮阅读位置：第 {turn.context.reading.page} 页 · 约{" "}
              {turn.context.estimatedTokens.toLocaleString()} tokens
              {!!turn.images?.length &&
                `（文本估算，${turn.images.length} 张图片用量另计）`}
            </p>
            <p>{turn.context.coverage}</p>
            <details>
              <summary>本轮上下文</summary>
              <p>
                问题范围：
                {
                  {
                    auto: "当前阅读位置",
                    selection: "选中原文",
                    chapter: "当前章节",
                    book: "整本书",
                  }[turn.context.reading.scope]
                }
              </p>
              {turn.context.reading.selection && (
                <p>选区：{turn.context.reading.selection}</p>
              )}
              {turn.context.memory && <p>记忆：{turn.context.memory}</p>}
              {turn.context.recent && <p>近期对话：{turn.context.recent}</p>}
              {turn.context.evidence.map((p) => (
                <button
                  className="evidence"
                  key={p.id}
                  onClick={() => onCitation(p.page, p.anchor)}
                >
                  第 {p.anchor.label} 页 · {p.text}
                </button>
              ))}
            </details>
            {turn.usage !== undefined && (
              <p>运行时用量：{JSON.stringify(turn.usage)}</p>
            )}
          </div>
        </details>
      </div>
      {noteError && (
        <p className="error" role="alert">
          {noteError}
        </p>
      )}
      {copyStatus && (
        <p className="copy-status" role="status">
          {copyStatus}
        </p>
      )}
    </article>
  );
}
