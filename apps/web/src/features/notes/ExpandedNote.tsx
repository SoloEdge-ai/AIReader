import { useEffect, useRef, useState } from "react";
import type { Note, PdfAnchor, SourceAnchor } from "../../../../../packages/protocol/src";
import type { BookNotes } from "./useBookNotes";
import { NoteEditor, type NoteEditorHandle } from "./NoteEditor";
import { Icon } from "../../ui/Icon";
import { base } from "../../api";
import "./notes.css";

interface NoteSourceItem {
  key: string;
  kind: string;
  title?: string;
  page?: number;
  label: string;
  text?: string;
  anchor?: SourceAnchor;
  pdfAnchor?: PdfAnchor;
  deleted?: boolean;
  referenceId?: string;
  imageUrl?: string;
}

function noteSources(note: Note): NoteSourceItem[] {
  const items: NoteSourceItem[] = [];
  const frozenTargets = new Set(note.sourceReferences.map((reference) =>
    `${reference.kind}:${reference.targetId}`));
  for (const reference of note.sourceReferences) {
    const kind = reference.kind === "annotation" ? "原文标记" :
      reference.region ? (reference.region.includePersonalMarks ? "图片摘录 · 含个人标记" : "图片摘录") :
        "材料卡片";
    const imageUrl = reference.region ? `${base}/api/books/${note.bookId}/${
      reference.regionAssetKind === "annotation" ? "annotation-assets" : "workspace-assets"
    }/${reference.region.assetId}` : undefined;
    if (reference.source)
      for (const [index, pdfAnchor] of reference.source.anchors.entries())
        items.push({ key: `reference-${reference.id}-${index}`, kind, page: pdfAnchor.page,
          label: String(pdfAnchor.page), title: reference.title,
          text: index === 0 ? reference.text : undefined,
          referenceId: index === 0 ? reference.id : undefined,
          imageUrl: index === 0 ? imageUrl : undefined,
          pdfAnchor });
    else if (reference.region)
      items.push({ key: `reference-${reference.id}`, kind, page: reference.region.page,
        label: String(reference.region.page), title: reference.title,
        text: reference.text, referenceId: reference.id, imageUrl,
        pdfAnchor: { page: reference.region.page, rects: [reference.region.rect] } });
    else items.push({ key: `reference-${reference.id}`, kind, title: reference.title, label: "工作台",
      text: reference.text, referenceId: reference.id });
  }
  for (const [index, anchor] of (note.annotationSource?.anchors ?? []).entries())
    if (!note.annotationSource || !frozenTargets.has(`annotation:${note.annotationSource.id}`))
    items.push({
      key: `annotation-${index}-${anchor.page}`,
      kind: "原文标记",
      page: anchor.page,
      label: String(anchor.page),
      text: index === 0 ? note.annotationSource?.quote : undefined,
      deleted: Boolean(note.annotationSource?.deletedAt),
      imageUrl: index === 0 && note.annotationSource?.assetId
        ? `${base}/api/books/${note.bookId}/annotation-assets/${note.annotationSource.assetId}` : undefined,
      pdfAnchor: anchor,
    });
  if (note.sourceCard?.source)
    if (!frozenTargets.has(`card:${note.sourceCard.cardId}`))
    for (const [index, anchor] of note.sourceCard.source.anchors.entries())
      items.push({
        key: `card-${index}-${anchor.page}`,
        kind: "原文摘录",
        title: note.sourceCard?.title,
        page: anchor.page,
        label: String(anchor.page),
        text: index === 0 ? note.sourceCard?.text : undefined,
        pdfAnchor: anchor,
      });
  if (note.sourceCard?.region)
    if (!frozenTargets.has(`card:${note.sourceCard.cardId}`))
    items.push({
      key: `region-${note.sourceCard.region.page}`,
      kind: note.sourceCard.region.includePersonalMarks ? "图片摘录 · 含个人标记" : "图片摘录",
      title: note.sourceCard.title,
      page: note.sourceCard.region.page,
      label: String(note.sourceCard.region.page),
      imageUrl: `${base}/api/books/${note.bookId}/workspace-assets/${note.sourceCard.region.assetId}`,
      pdfAnchor: { page: note.sourceCard.region.page, rects: [note.sourceCard.region.rect] },
    });
  for (const [index, source] of (note.origin?.sources ?? []).entries())
    items.push({
      key: `answer-${index}-${source.anchor.passageId}`,
      kind: "AI 回答引用",
      title: `来源 ${index + 1}`,
      page: source.anchor.page,
      label: source.anchor.label,
      text: source.text,
      anchor: source.anchor,
    });
  return items;
}

/** The only rich-text editing surface. PDF and chat stay usable around this workspace layer. */
export function ExpandedNote({ note, state, onClose, onJump, onJumpPdf, onRemoveSource }: {
  note: Note;
  state: BookNotes;
  onClose: () => void;
  onJump?: (page: number, anchor?: SourceAnchor) => void;
  onJumpPdf?: (anchor: PdfAnchor) => void;
  onRemoveSource?: (referenceId: string) => Promise<void>;
}) {
  const panel = useRef<HTMLElement>(null);
  const editor = useRef<NoteEditorHandle>(null);
  const [closing, setClosing] = useState(false);
  const [sourceError, setSourceError] = useState("");
  const sources = noteSources(note);
  const jumpSource = (source: NoteSourceItem) => {
    if (source.pdfAnchor && onJumpPdf) onJumpPdf(source.pdfAnchor);
    else if (source.page) onJump?.(source.page, source.anchor);
  };
  useEffect(() => {
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : undefined;
    panel.current?.querySelector<HTMLInputElement>(".note-title")?.focus({ preventScroll: true });
    return () => { if (previous?.isConnected) previous.focus({ preventScroll: true }); };
  }, [note.id]);
  async function close() {
    if (closing) return;
    setClosing(true);
    try { if (await state.flush()) onClose(); }
    finally { setClosing(false); }
  }
  const statusKind = state.status.startsWith("保存失败") ? "error"
    : state.status === "保存中…" ? "saving" : "saved";
  return <section className="expanded-note" ref={panel} role="dialog" aria-modal="false"
    aria-label="展开笔记编辑" data-note-id={note.id}
    onKeyDown={(event) => {
      if (event.nativeEvent.isComposing || event.key !== "Escape") return;
      // Link and formula entry have nearer cancel actions.
      if ((event.target as HTMLElement).closest(".note-link-form,.note-math-form")) return;
      event.preventDefault(); event.stopPropagation(); void close();
    }}>
    <header className="expanded-note-header">
      <button type="button" title="收起笔记编辑" aria-label="收起笔记编辑"
        disabled={closing} onClick={() => void close()}>
        <Icon name="close" />
      </button>
      <div>
        <span className="expanded-note-eyebrow">{note.origin ? "AI 回答笔记" : "个人笔记"}</span>
        <strong>编辑理解</strong>
      </div>
    </header>
    <div className="expanded-note-scroll">
      <article className="expanded-note-content">
        {note.origin && <p className="expanded-note-origin-note">
          AI 生成内容可以修改；下方来源保持只读，修改正文不会改变原文证据。
        </p>}
        <NoteEditor key={note.id} ref={editor} note={note} state={state}
          onOpenSource={(referenceId) => {
            const source = sources.find((item) => item.referenceId === referenceId);
            if (source) jumpSource(source);
          }} />
        {sources.length > 0 && <details className="expanded-note-sources">
          <summary>
            <span>来源 · {sources.length} 处</span>
            <small>只读，可随时回到原文</small>
          </summary>
          <div className="expanded-note-source-list">
            {sources.map((source) => <section key={source.key} className="expanded-note-source">
              <div>
                <span>{source.kind}</span>
                {source.title && <strong>{source.title}</strong>}
                {source.deleted && <small>源标记已删除，位置快照仍保留</small>}
              </div>
              {(onJump || onJumpPdf) && source.page
                ? <button type="button" onClick={() => jumpSource(source)}>
                    第 {source.label} 页原文 <Icon name="outward" />
                  </button>
                : <span className="expanded-note-source-page">
                    {source.page ? `第 ${source.label} 页` : source.label}
                  </span>}
              {source.text && <blockquote>{source.text}</blockquote>}
              {source.imageUrl && <img className="expanded-note-source-image" src={source.imageUrl}
                alt={`${source.kind}来源图片`} />}
              {source.referenceId && <div className="expanded-note-source-actions">
                <button type="button" onClick={() =>
                  editor.current?.insertSourceReference(source.referenceId!)}>
                  插入正文
                </button>
                {onRemoveSource && <button type="button" onClick={() => {
                  setSourceError("");
                  void onRemoveSource(source.referenceId!).catch((error) => setSourceError(String(error)));
                }}>移除来源</button>}
              </div>}
            </section>)}
            {sourceError && <p className="expanded-note-source-error" role="alert">{sourceError}</p>}
          </div>
        </details>}
      </article>
    </div>
    <footer className="expanded-note-footer">
      <span role="status" data-status={statusKind}>{state.status}</span>
      <small>{sources.length ? `已关联 ${sources.length} 处只读来源` : "个人笔记 · 无原文来源"}</small>
      {state.status.startsWith("保存失败") &&
        <button type="button" onClick={() => void state.flush()}>重试保存</button>}
    </footer>
  </section>;
}
