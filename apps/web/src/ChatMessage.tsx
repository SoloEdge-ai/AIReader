import { createContext, useContext, useId, useState, type ComponentProps } from "react";
import ReactMarkdown, { type Components } from "react-markdown";
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
import { IconButton } from "./ui/IconButton";
import { Popover } from "./ui/Popover";
import { Icon } from "./ui/Icon";
import { effortLabel } from "./ModelControl";
import { ChatImageList } from "./ChatImageList";
import { CitationPreview, citationSnapshots } from "./CitationPreview";
import { base, post } from "./api";

const AnswerSourcesContext = createContext<{
  sources: ReturnType<typeof citationSnapshots>;
  onCitation: (page: number, anchor: SourceAnchor) => void;
} | null>(null);

function AnswerLink({ href, children }: ComponentProps<"a">) {
  const context = useContext(AnswerSourcesContext);
  if (href?.startsWith("#source-")) {
    const source = context?.sources.find((candidate) =>
      "#source-" + encodeURIComponent(candidate.anchor.passageId) === href,
    );
    return source && context ? (
      <CitationPreview source={source} onCitation={context.onCitation} />
    ) : <span>{children}</span>;
  }
  return <a href={href} target="_blank" rel="noopener noreferrer">{children}</a>;
}

// Stable component identities preserve an open preview across turn polling.
const answerComponents: Components = { img: () => null, a: AnswerLink };

export function ChatMessage({
  turn,
  onCitation,
  savedNote,
  onNoteSaved,
  onSaveAnswer,
  onLocateAnswer,
  answerPlaced,
  onMaterialLocate,
}: {
  turn: ChatTurn;
  onCitation: (page: number, anchor: SourceAnchor) => void;
  savedNote?: Note;
  onNoteSaved: (note: Note) => Promise<void>;
  onSaveAnswer?: (turn: ChatTurn) => Promise<void>;
  onLocateAnswer?: (note: Note) => void;
  answerPlaced?: boolean;
  onMaterialLocate: (anchors: PdfAnchor[]) => void;
}) {
  const [copyStatus, setCopyStatus] = useState("");
  const [savingNote, setSavingNote] = useState(false),
    [noteError, setNoteError] = useState("");
  const [reasoningExpanded, setReasoningExpanded] = useState<boolean>();
  const [savedOnCanvas, setSavedOnCanvas] = useState(false);
  const reasoningId = useId();
  const showReasoning = reasoningExpanded ?? turn.status === "running";
  const sources = citationSnapshots(turn);
  const markdown = turn.answer.replace(/\[\[([^\]]+)\]\]/g, (_, id: string) => {
    const source = sources.find((c) => c.anchor.passageId === id);
    return source
      ? `[原文](#source-${encodeURIComponent(id)})`
      : turn.status === "running"
        ? "〔引用校验中〕"
        : "〔未验证引用〕";
  });
  async function copy() {
    try {
      await navigator.clipboard.writeText(
        turn.answer.replace(/\[\[([^\]]+)\]\]/g, (_, id: string) => {
          const source = sources.find((c) => c.anchor.passageId === id);
          return source ? `〔第 ${source.anchor.label} 页〕` : "〔未验证引用〕";
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
  async function saveOnCanvas() {
    if (!onSaveAnswer || savingNote) return;
    setSavingNote(true); setNoteError("");
    try { await onSaveAnswer(turn); setSavedOnCanvas(true); }
    catch (error) { setNoteError(String(error)); }
    finally { setSavingNote(false); }
  }
  return (
    <article className="turn">
      <div className="question"><span>{turn.question}</span>
        {turn.context.reading.selection && <Popover label="本轮引用"
          triggerLabel={`本轮引用 · 第 ${turn.context.reading.page} 页起`}
          triggerClass="question-source-trigger" className="question-source"
          trigger={<><Icon name="outward" />{turn.context.reading.page}</>}>
          {() => <><strong>本轮引用 · 第 {turn.context.reading.page} 页起</strong><p>{turn.context.reading.selection}</p></>}
        </Popover>}
      </div>
      <ChatImageList
        images={(turn.images ?? []).map((image) => ({
          ...image,
          url: `${base}/api/books/${turn.bookId}/chat-images/${image.id}`,
        }))}
      />
      {!!turn.context.materials?.length && <details className="sent-materials">
        <summary>本轮选定材料 · {turn.context.materials.reduce((count, material) => count + material.itemCount, 0)} 项</summary>
        {turn.context.materials.map((material) => {
          const anchors = material.sections.flatMap((section) => section.anchors ?? []);
          return <div className="sent-material" key={material.id}>
            <strong>{material.title}</strong>
            {anchors.length > 0 && <button onClick={() => onMaterialLocate(anchors)}>返回位置</button>}
            {material.sections.map((section, index) => <p key={index}>
              <small>{section.kind === "book-excerpt" ? "原文摘录" : section.kind === "book-region" ? "PDF 区域" :
                section.provenance ? (section.provenance.edited ? "AI 内容 · 已编辑" : "AI 内容") :
                  section.kind === "relation" ? "用户声明的关系" : "个人材料"}</small>
              {section.text}
            </p>)}
            {material.images.map((image) => <figure key={image.id}>
              <img src={`${base}/api/books/${turn.bookId}/question-materials/${material.id}/images/${image.id}?session=${encodeURIComponent(turn.sessionId)}`}
                alt={`${material.title}的本轮冻结图片`} />
              <figcaption>{image.includesPdfBackground ? `包含 PDF 第 ${image.page} 页背景` : "仅所选个人对象"}
                {image.userRendered && " · 个人预览"}</figcaption>
            </figure>)}
          </div>;
        })}
      </details>}
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
            </div>
          )}
        </section>
      )}
      <div className="answer markdown" aria-label="AI 回答">
        <AnswerSourcesContext.Provider value={{ sources, onCitation }}>
        <ReactMarkdown
          skipHtml
          remarkPlugins={[remarkGfm, remarkMath]}
          rehypePlugins={[[rehypeKatex, { throwOnError: false, trust: false }]]}
          components={answerComponents}
        >
          {markdown ||
            (turn.status === "running"
              ? "正在等待模型回答…"
              : "尚无回答内容。")}
        </ReactMarkdown>
        </AnswerSourcesContext.Provider>
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
      <div className="answer-actions">
      {!!sources.length && (
        <details className="answer-sources">
          <summary aria-label={`回答引用 · ${sources.length} 处原文`} title="查看回答引用的原文">
            <Icon name="outward" />
            {[...new Set(sources.map((source) => source.anchor.label))].slice(0, 3).join("、")}
            {new Set(sources.map((source) => source.anchor.label)).size > 3 && "…"}
          </summary>
          <div className="source-excerpts">
            {sources.map((source) => <div key={source.anchor.passageId}>
              {!!turn.context.materials?.length && <small>{turn.context.reading.scope === "materials" ||
                turn.context.materials.some((material) => material.sections.some((section) =>
                  section.kind === "book-excerpt" && section.text.trim() === source.text.trim() &&
                  section.anchors?.some((anchor) => anchor.page === source.anchor.page))) ? "所选材料" : "补充检索"}</small>}
              <CitationPreview source={source} onCitation={onCitation} excerpt />
            </div>)}
          </div>
        </details>
      )}

        <IconButton label="复制回答" icon={copyStatus === "已复制" ? "check" : "copy"}
          disabled={!turn.answer || turn.status === "running"} onClick={() => void copy()} />
        {onSaveAnswer ? <button className="save-answer-canvas" disabled={turn.status !== "complete" || !turn.answer || savingNote}
          onClick={() => answerPlaced && savedNote ? onLocateAnswer?.(savedNote) : void saveOnCanvas()}>
          {savingNote ? "保存中…" : answerPlaced ? "查看卡片" : "保存到此处"}
        </button> : <IconButton className="save-answer-note" label={savingNote ? "保存中…" : savedNote ? "打开笔记" : "存为笔记"}
          icon={savedNote ? "check" : "note"} disabled={turn.status !== "complete" || !turn.answer || savingNote} onClick={() => void saveNote()} />}
        {savedOnCanvas && answerPlaced && <span role="status">已保存到画布 · 可在工作台撤销</span>}
        <details className="answer-details">
          <summary aria-label="回答详情" title="回答详情"><Icon name="more" /></summary>
          <div className="answer-metadata">
            {onSaveAnswer && <button disabled={turn.status !== "complete" || !turn.answer || savingNote}
              onClick={() => void saveNote()}>{savedNote ? "打开笔记" : "存为笔记"}</button>}
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
              <summary>本轮证据 · {turn.context.evidence.length} 段原文</summary>
              <p>
                问题范围：
                {
                  {
                    auto: "当前阅读位置",
                    materials: "仅所选材料",
                    search: "结合本书检索",
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
