import { useEffect, useRef, useState } from "react";
import type { Annotation, Note, PdfAnchor, SourceAnchor } from "../../../packages/protocol/src";
import type { BookWorkspace as WorkspaceSnapshot } from "../../../packages/protocol/src/workspace";
import { base } from "./api";
import { ChatImageList } from "./ChatImageList";
import { NoteCardContent } from "./features/notes/NoteCardContent";
import type { BookNotes } from "./features/notes/useBookNotes";
import { MaterialCatalog } from "./features/materials/MaterialCatalog";

const kindNames = {
  highlight: "高亮",
  underline: "下划线",
  strike: "删除线",
  sticky: "便签",
  region: "区域摘录",
};
function notePlainText(node: Note["document"]): string {
  const own = node.text ?? (node.type === "inlineMath" || node.type === "blockMath"
    ? String(node.attrs?.latex ?? "") : "");
  return [own, ...(node.content ?? []).map(notePlainText)].filter(Boolean).join(" ");
}
function noteSearchText(note: Note, annotation?: Annotation): string {
  return [
    note.title,
    notePlainText(note.document),
    annotation?.quote,
    note.sourceCard?.title,
    note.sourceCard?.text,
    ...note.sourceReferences.flatMap((reference) => [reference.title, reference.text]),
    ...(note.origin?.sources.map((source) => source.text) ?? []),
  ].filter(Boolean).join(" ");
}
export function NotesPanel({
  bookId,
  state,
  onJump,
  onJumpPdf,
  onAddToQuestion,
  onAddAnnotation,
  onAssociateAnnotation,
  onExpand,
  onPlace,
  catalog,
  onLocateItem,
  onRestoreItem,
  onAddItemToQuestion,
  beforeWorkspaceChange,
}: {
  bookId: string;
  state: BookNotes;
  onJump: (page: number, anchor?: SourceAnchor) => void;
  onJumpPdf?: (anchors: PdfAnchor[]) => void;
  onAddToQuestion?: (note: Note) => Promise<void>;
  onAddAnnotation?: (annotation: Annotation) => Promise<void>;
  onAssociateAnnotation?: (note: Note, annotation: Annotation) => Promise<void>;
  onExpand?: (note: Note) => void;
  onPlace?: (note: Note) => Promise<void>;
  catalog?: Pick<WorkspaceSnapshot, "cards" | "objects" | "links" | "groups">;
  onLocateItem?: (id: string) => void;
  onRestoreItem?: (id: string) => void;
  onAddItemToQuestion?: (id: string) => Promise<void>;
  beforeWorkspaceChange?: () => Promise<boolean>;
}) {
  const [query, setQuery] = useState(""),
    [kind, setKind] = useState(""),
    [color, setColor] = useState(""),
    [sourceNoteId, setSourceNoteId] = useState(""),
    [exporting, setExporting] = useState(false),
    [exportMessage, setExportMessage] = useState("");
  const exportController = useRef<AbortController | undefined>(undefined);
  useEffect(() => {
    setExporting(false);
    setExportMessage("");
    return () => exportController.current?.abort();
  }, [bookId]);
  const selected = state.notes.find((n) => n.id === state.selected),
    annotation = state.annotations.find((a) => a.id === selected?.annotationId) ?? selected?.annotationSource;
  const unlinked = state.annotations.filter((a) => !state.notes.some((n) => n.id === a.noteId));
  const selectedAnnotation = unlinked.find((a) => a.id === state.selectedAnnotation);
  const associationNotes = selectedAnnotation ? state.notes.filter((note) =>
    !note.sourceReferences.some((reference) =>
      reference.kind === "annotation" && reference.targetId === selectedAnnotation.id)) : [];
  const materialImageIds = new Set(selected?.origin?.materials?.flatMap((material) =>
    material.images.map((image) => image.id)) ?? []);
  const questionImages = selected?.origin?.images?.filter((image) => !materialImageIds.has(image.id)) ?? [];
  const run = (fn: () => Promise<unknown>) =>
    void fn().catch((e) => window.alert(String(e)));
  const jumpPdf = (anchors: PdfAnchor[]) => {
    if (onJumpPdf) onJumpPdf(anchors);
    else if (anchors[0]) onJump(anchors[0].page);
  };
  const workspaceChange = async (fn: () => Promise<unknown>) => {
    if (beforeWorkspaceChange && !(await beforeWorkspaceChange())) throw new Error("画板草稿尚未保存，请先重试");
    return fn();
  };
  async function exportNote(note: Note) {
    if (exporting) return;
    const controller = new AbortController();
    exportController.current = controller;
    setExporting(true);
    setExportMessage("");
    try {
      if (!(await state.flush()))
        throw new Error("当前修改未保存，草稿仍保留。请重试保存后再导出。");
      controller.signal.throwIfAborted();
      const response = await fetch(
        `${base}/api/books/${bookId}/notes/${note.id}/export`,
        {
          credentials: "include",
          signal: controller.signal,
        },
      );
      if (!response.ok)
        throw new Error((await response.json()).error ?? "导出失败");
      const url = URL.createObjectURL(await response.blob());
      const link = document.createElement("a");
      link.href = url;
      link.download = `AIReader-Note-${note.id}.zip`;
      link.click();
      setTimeout(() => URL.revokeObjectURL(url), 10000);
      setExportMessage("已生成 Markdown 与图片压缩包");
    } catch (error) {
      if (!controller.signal.aborted) setExportMessage(String(error));
    } finally {
      if (!controller.signal.aborted) setExporting(false);
    }
  }
  return (
    <section className="notes-panel">
      <div className="notes-actions">
        <button onClick={() => run(async () => {
          const note = await state.create();
          if (note) onExpand?.(note);
        })}>新建笔记</button>
        <button
          onClick={() => run(() => workspaceChange(state.undoLast))}
          disabled={!state.canUndo}
        >
          撤销批注操作
        </button>
      </div>
      <div className="note-filters">
        <input
          aria-label="搜索材料"
          placeholder="搜索本书材料"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        <select
          aria-label="批注类型筛选"
          value={kind}
          onChange={(e) => setKind(e.target.value)}
        >
          <option value="">全部类型</option>
          {Object.entries(kindNames).map(([k, n]) => (
            <option key={k} value={k}>
              {n}
            </option>
          ))}
          <option value="note">独立笔记</option>
          <option value="chat">AI 回答笔记</option>
        </select>
        <select
          aria-label="批注颜色筛选"
          value={color}
          onChange={(e) => setColor(e.target.value)}
        >
          <option value="">全部颜色</option>
          {["yellow", "green", "blue", "pink"].map((c, i) => (
            <option key={c} value={c}>
              {["黄", "绿", "蓝", "粉"][i]}
            </option>
          ))}
        </select>
      </div>
      <MaterialCatalog bookId={bookId} catalog={catalog} notes={state.notes} query={query}
        onLocate={(id) => {
          if (state.notes.some((note) => note.id === id) && !catalog?.cards.some((card) => card.id === id))
            state.setSelected(id);
          else onLocateItem?.(id);
        }} onRestore={async (id) => {
          const note = state.notes.find((item) => item.id === id);
          if (note && !catalog?.cards.some((card) => card.id === id)) {
            if (!onPlace) throw new Error("工作台尚未准备好");
            await onPlace(note);
          } else if (onRestoreItem) onRestoreItem(id);
          else throw new Error("工作台尚未准备好");
        }} onAdd={async (id) => {
          const note = state.notes.find((item) => item.id === id);
          if (note && !catalog?.cards.some((card) => card.id === id)) {
            if (!onAddToQuestion) throw new Error("材料操作不可用");
            await onAddToQuestion(note);
            return;
          }
          if (!onAddItemToQuestion) throw new Error("材料操作不可用");
          await onAddItemToQuestion(id);
        }} />
      <h3 className="material-notes-heading">批注与笔记</h3>
      <div className="notes-list">
        {unlinked.filter((a) => (!kind || a.kind === kind) && (!color || a.color === color) &&
          a.quote.toLowerCase().includes(query.toLowerCase())).sort((a, b) => a.anchors[0].page - b.anchors[0].page)
          .map((a) => <button key={a.id} className={a.id === selectedAnnotation?.id ? "chosen" : ""}
            data-annotation-id={a.id}
            onClick={() => run(async () => { if (await state.flush()) state.selectAnnotation(a.id); })}>
            <span>{a.quote || kindNames[a.kind]}</span><small>{kindNames[a.kind]} · 第 {a.anchors[0].page} 页 · 无评论</small>
          </button>)}
        {[...state.notes]
          .sort(
            (a, b) =>
              (state.annotations.find((x) => x.id === a.annotationId)
                ?.anchors[0].page ?? Infinity) -
              (state.annotations.find((x) => x.id === b.annotationId)
                ?.anchors[0].page ?? Infinity),
          )
          .filter((n) => {
            const a = state.annotations.find((a) => a.id === n.annotationId);
            return (
              (!kind || (a?.kind ?? (n.origin ? "chat" : "note")) === kind) &&
              (!color || a?.color === color) &&
              noteSearchText(n, a).toLowerCase().includes(query.toLowerCase())
            );
          })
          .map((n) => {
            const a = state.annotations.find((a) => a.id === n.annotationId);
            return (
              <button
                className={n.id === selected?.id ? "chosen" : ""}
                key={n.id}
                data-note-id={n.id}
                onClick={() =>
                  run(async () => {
                    if (await state.flush()) state.setSelected(n.id);
                  })
                }
              >
                <span>{n.title}</span>
                <small>
                  {a
                    ? `${kindNames[a.kind]} · ${a.anchors.map((x) => x.page).join("、")} 页`
                    : n.origin
                      ? "AI 回答笔记"
                      : n.sourceCard
                        ? `摘录评论 · 第 ${n.sourceCard.region?.page ?? n.sourceCard.source?.anchors[0].page} 页`
                        : "独立笔记"}
                </small>
              </button>
            );
          })}
      </div>
      {selectedAnnotation && <div className="note-source">
        <button onClick={() => jumpPdf(selectedAnnotation.anchors)}>第 {selectedAnnotation.anchors[0].page} 页原文 ↗</button>
        <blockquote>{selectedAnnotation.quote}</blockquote>
        {selectedAnnotation.assetId && <img alt="区域摘录" src={`${base}/api/books/${bookId}/annotation-assets/${selectedAnnotation.assetId}`} />}
        <button onClick={() => run(async () => {
          const note = await state.comment(selectedAnnotation.id);
          if (note) onExpand?.(note);
        })}>写评论</button>
        {onAssociateAnnotation && associationNotes.length > 0 && <div className="note-source-association">
          <select aria-label="关联标记到笔记" value={sourceNoteId}
            onChange={(event) => setSourceNoteId(event.target.value)}>
            <option value="">选择已有笔记</option>
            {associationNotes.map((note) => <option key={note.id} value={note.id}>{note.title}</option>)}
          </select>
          <button disabled={!sourceNoteId} onClick={() => run(async () => {
            const note = state.notes.find((item) => item.id === sourceNoteId);
            if (!note) throw new Error("请选择要关联的笔记");
            if (!(await state.flush())) throw new Error("笔记尚未保存，请先重试");
            await onAssociateAnnotation(note, selectedAnnotation);
            setSourceNoteId("");
          })}>关联到笔记</button>
        </div>}
        <button onClick={() => run(() => state.removeAnnotation(selectedAnnotation))}>删除批注</button>
      </div>}
      {selected ? (
        <div className="note-detail" data-note-id={selected.id}>
          {selected.origin && (
            <div className="note-origin">
              <p className="note-origin-label">AI 生成 · 可编辑的回答笔记</p>
              <p>
                下方正文可以修改；出处保留保存时的原文，不代表你的修改已获核验。
              </p>
              <details>
                <summary>
                  原问题与出处 · {selected.origin.sources.length} 处原文
                </summary>
                <p>{selected.origin.question}</p>
                {selected.origin.sources.map(({ anchor, text }) => (
                  <div className="note-origin-source" key={anchor.passageId}>
                    <button onClick={() => onJump(anchor.page, anchor)}>
                      第 {anchor.label} 页原文
                    </button>
                    <blockquote>{text}</blockquote>
                  </div>
                ))}
                {!selected.origin.sources.length && (
                  <p>此回答没有已校验的书中出处，请自行核对。</p>
                )}
                {!!questionImages.length && (
                  <>
                    <p>原问题附图 · 用户提供的材料，不是已校验的书中引文</p>
                    <ChatImageList
                      images={questionImages.map((image) => ({
                        ...image,
                        url: `${base}/api/books/${bookId}/chat-images/${image.id}`,
                      }))}
                    />
                  </>
                )}
                {!!selected.origin.materials?.length && <div className="note-origin-materials">
                  <p>本轮选定材料 · 加入时的冻结内容；个人笔记和标注不是作者原文</p>
                  {selected.origin.materials.map((material, index) => <div key={index}>
                    <strong>{material.title}</strong>
                    {material.sections.map((section, sectionIndex) => <p key={sectionIndex}>
                      {section.title}：{section.text}
                    </p>)}
                    <ChatImageList images={material.images.map((image) => ({
                      ...image, url: `${base}/api/books/${bookId}/chat-images/${image.id}`,
                    }))} />
                  </div>)}
                </div>}
              </details>
            </div>
          )}
          {annotation && (
            <div className="note-source">
              {annotation.deletedAt && <p>源标注已删除，以下保留原文位置与摘录。</p>}
              <button onClick={() => jumpPdf(annotation.anchors)}>
                第 {annotation.anchors[0].page} 页原文 ↗
              </button>
              {annotation.quote && <blockquote>{annotation.quote}</blockquote>}
              {annotation.assetId && (
                <img
                  alt="区域摘录"
                  src={`${base}/api/books/${bookId}/annotation-assets/${annotation.assetId}`}
                />
              )}
              <label>
                颜色{" "}
                <select
                  aria-label="批注颜色"
                  disabled={Boolean(annotation.deletedAt)}
                  value={annotation.color}
                  onChange={(e) =>
                    run(() =>
                      state.color(
                        annotation,
                        e.target.value as Annotation["color"],
                      ),
                    )
                  }
                >
                  {["yellow", "green", "blue", "pink"].map((c, i) => (
                    <option key={c} value={c}>
                      {["黄色", "绿色", "蓝色", "粉色"][i]}
                    </option>
                  ))}
                </select>
              </label>
            </div>
          )}
          {selected.sourceCard && <div className="note-source">
            <p>摘录来源 · 下方评论是个人内容，不是书中原文</p>
            <button onClick={() => jumpPdf(selected.sourceCard!.region
              ? [{ page: selected.sourceCard!.region.page, rects: [selected.sourceCard!.region.rect] }]
              : selected.sourceCard!.source!.anchors)}>
              第 {selected.sourceCard.region?.page ?? selected.sourceCard.source?.anchors[0].page} 页原文 ↗
            </button>
            {selected.sourceCard.text && <blockquote>{selected.sourceCard.text}</blockquote>}
            {selected.sourceCard.region && <img alt="摘录图片"
              src={`${base}/api/books/${bookId}/workspace-assets/${selected.sourceCard.region.assetId}`} />}
          </div>}
          <div className="note-detail-preview">
            <NoteCardContent note={selected} state={state} editing={false} />
          </div>
          <footer>
            <span role="status">{state.status}</span>
            {onExpand && <button onClick={() => onExpand(selected)}>展开编辑笔记</button>}
            {onPlace && <button onClick={() => run(() => onPlace(selected))}>放到画布</button>}
            {onAddToQuestion && <button onClick={() => run(async () => {
              if (!(await state.flush())) throw new Error("笔记尚未保存，请先重试");
              const latest = state.notes.find((note) => note.id === selected.id) ?? selected;
              await onAddToQuestion(latest);
            })}>加入提问</button>}
            {annotation && !annotation.deletedAt && onAddAnnotation && <button onClick={() => run(() => onAddAnnotation(annotation))}>
              加入批注到提问
            </button>}
            <button
              disabled={exporting}
              onClick={() => void exportNote(selected)}
            >
              {exporting ? "导出中…" : "导出笔记"}
            </button>
            {state.status.startsWith("保存失败") && (
              <>
                <button onClick={() => void state.flush()}>重试保存</button>
                <button
                  title="重新读取当前版本，并用保留的草稿替换它"
                  onClick={() => run(state.retryWithLatest)}
                >
                  用此草稿覆盖最新版本
                </button>
              </>
            )}
            <button onClick={() => run(() => workspaceChange(() => state.remove(selected)))}>
              删除笔记
            </button>
            {annotation && !annotation.deletedAt && <button onClick={() => run(() => state.removeAnnotation(annotation))}>删除批注</button>}
          </footer>
          {exportMessage && (
            <p className="export-status" role="status">
              {exportMessage}
            </p>
          )}
        </div>
      ) : (
        <p className="panel-empty muted">选择一条批注，或新建笔记</p>
      )}
    </section>
  );
}
