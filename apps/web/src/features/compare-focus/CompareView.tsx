import { useEffect, useRef, useState } from "react";
import type { PdfAnchor } from "../../../../../packages/protocol/src/anchors";
import type { WorkspaceCard } from "../../../../../packages/protocol/src/workspace";
import type { ComparisonNoteLink } from "./comparison-notes";
import "./compare-focus.css";

export type ComparisonItem = WorkspaceCard & { kind: "excerpt" | "region" };

export function comparisonItems(cards: readonly WorkspaceCard[]): ComparisonItem[] {
  const seen = new Set<string>();
  return cards.filter((card): card is ComparisonItem => {
    if (seen.has(card.id) || card.kind !== "excerpt" && card.kind !== "region") return false;
    seen.add(card.id);
    return Boolean(card.source?.anchors.length || card.region);
  }).slice(0, 3);
}

export function comparisonAnchors(card: ComparisonItem): PdfAnchor[] {
  return card.region ? [{ page: card.region.page, rects: [card.region.rect] }] : card.source?.anchors ?? [];
}

export type CompareViewProps = {
  cards: readonly WorkspaceCard[];
  pageLabels?: readonly string[];
  /** Resolve a book-scoped, authenticated workspace asset URL. */
  imageUrl: (assetId: string) => string;
  notesForCard?: (cardId: string) => readonly ComparisonNoteLink[];
  onOpenNote?: (noteId: string) => void;
  onSource: (anchors: PdfAnchor[]) => void;
  onClose: () => void;
};

/** Temporary comparison: cards and source records are read without creating copies. */
export function CompareView({ cards, pageLabels, imageUrl, notesForCard, onOpenNote, onSource, onClose }: CompareViewProps) {
  const items = comparisonItems(cards);
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(() => new Set());
  const [zoomedImage, setZoomedImage] = useState<ComparisonItem>();
  const imageOpener = useRef<HTMLButtonElement>(null);
  const closeImageButton = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (zoomedImage) closeImageButton.current?.focus({ preventScroll: true });
    else if (imageOpener.current?.isConnected) imageOpener.current.focus({ preventScroll: true });
  }, [zoomedImage]);
  useEffect(() => {
    if (!zoomedImage) return;
    const close = (event: KeyboardEvent) => { if (event.key === "Escape" && !event.isComposing) setZoomedImage(undefined); };
    window.addEventListener("keydown", close);
    return () => window.removeEventListener("keydown", close);
  }, [zoomedImage]);
  const pageLabel = (page: number) => pageLabels?.[page - 1] ?? String(page);
  return <section className="comparison-view" aria-label="并排比较">
    <header className="comparison-view-header">
      <div><span className="comparison-view-eyebrow">工作台 / 比较</span><h2>并排比较</h2>
        <p>同时核对摘录、图表及其原文来源</p></div>
      <button type="button" onClick={onClose} aria-label="关闭比较并返回工作台">返回工作台</button>
    </header>
    {items.length < 2 ? <p className="comparison-view-empty">请选择 2–3 份原文或图片摘录。</p> :
      <div className="comparison-view-columns" data-count={items.length}>
        {items.map((card, index) => {
          const anchors = comparisonAnchors(card);
          const pages = [...new Set(anchors.map((anchor) => anchor.page))];
          const isExpanded = expanded.has(card.id);
          const notes = notesForCard?.(card.id) ?? [];
          return <article className="comparison-view-card" key={card.id}>
            <header><span className="comparison-view-index">{String(index + 1).padStart(2, "0")}</span>
              <span>{card.kind === "region" ? "图片摘录" : "原文摘录"}</span></header>
            <h3>{card.title || (card.kind === "region" ? "图表" : "未命名摘录")}</h3>
            {card.kind === "region" && card.region ? <button type="button" className="comparison-view-image-button"
                onClick={(event) => { imageOpener.current = event.currentTarget; setZoomedImage(card); }}
                aria-label={`放大${card.title || "图片摘录"}`}>
                <img src={imageUrl(card.region.assetId)} alt={card.title || `第 ${pageLabel(card.region.page)} 页图片摘录`} />
                <span>放大图表</span></button> : <div className="comparison-view-quote">
                <blockquote className={isExpanded ? "expanded" : ""}>{card.text}</blockquote>
                {card.text.length > 400 && <button type="button" onClick={() => setExpanded((old) => {
                  const next = new Set(old); if (next.has(card.id)) next.delete(card.id); else next.add(card.id); return next;
                })}>{isExpanded ? "收起文字" : "展开全文"}</button>}</div>}
            {card.region?.includePersonalMarks && <p className="comparison-view-marks">图中包含个人标记</p>}
            <footer><div className="comparison-view-pages"><span>原文来源</span>
              {pages.map((page) => <button type="button" key={page} onClick={() => onSource(anchors.filter((anchor) => anchor.page === page))}>
                第 {pageLabel(page)} 页 ↗</button>)}</div>
              {onOpenNote && <details className="comparison-view-notes"><summary>关联笔记 · {notes.length}</summary>
                <div>{notes.length ? notes.map((note) => <button type="button" key={note.id}
                  onClick={() => onOpenNote(note.id)}>{note.title || "未命名笔记"}</button>) :
                  <span>暂无关联笔记</span>}</div>
              </details>}
            </footer>
          </article>;
        })}
      </div>}
    {zoomedImage?.region && <div className="comparison-view-image-scrim" role="presentation" onClick={() => setZoomedImage(undefined)}>
      <div className="comparison-view-image-dialog" role="dialog" aria-modal="true" aria-label="放大图表"
        onClick={(event) => event.stopPropagation()}
        onKeyDown={(event) => { if (event.key === "Tab") { event.preventDefault(); closeImageButton.current?.focus(); } }}>
        <button ref={closeImageButton} type="button" onClick={() => setZoomedImage(undefined)} aria-label="关闭放大图表">关闭</button>
        <img src={imageUrl(zoomedImage.region.assetId)} alt={zoomedImage.title || "图片摘录"} />
      </div>
    </div>}
  </section>;
}
