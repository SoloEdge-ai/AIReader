import { useMemo, useState, type ReactNode } from "react";
import type { PdfAnchor } from "../../../../../packages/protocol/src/anchors";
import { buildFocusPlan, DEFAULT_FOCUS_CONTEXT, FOCUS_BATCH_SIZE,
  type FocusRegion, type PdfPageBox } from "./focus-model";
import "./compare-focus.css";

export type FocusReadingViewProps = {
  anchors: readonly PdfAnchor[];
  pageBoxes: readonly PdfPageBox[];
  pageLabels?: readonly string[];
  /** Must render the original PDF page clipped to region.pdfRect; no text reflow. */
  renderPdfRegion: (region: FocusRegion) => ReactNode;
  onGoToOriginal: (region: FocusRegion) => void;
  onClose: () => void;
};

export function FocusReadingView({ anchors, pageBoxes, pageLabels, renderPdfRegion,
  onGoToOriginal, onClose }: FocusReadingViewProps) {
  const [extraContext, setExtraContext] = useState<ReadonlyMap<string, number>>(() => new Map());
  const [fullPages, setFullPages] = useState<ReadonlySet<number>>(() => new Set());
  const [visibleLimit, setVisibleLimit] = useState(FOCUS_BATCH_SIZE);
  const plan = useMemo(() => buildFocusPlan(anchors, pageBoxes, { extraContext, fullPages, visibleLimit }),
    [anchors, pageBoxes, extraContext, fullPages, visibleLimit]);
  const pageLabel = (page: number) => pageLabels?.[page - 1] ?? String(page);
  return <section className="focus-reading-view" aria-label="原文聚焦">
    <header className="focus-reading-header"><div><span className="comparison-view-eyebrow">阅读 / 原文聚焦</span>
      <h2>原文聚焦</h2><p>保留原始 PDF 页面与坐标；省略处可回到完整原文。</p></div>
      <button type="button" onClick={onClose}>返回阅读</button></header>
    <div className="focus-reading-regions">
      {plan.entries.length === 0 && <p className="comparison-view-empty">没有可显示的原文来源。</p>}
      {plan.entries.map((entry) => entry.kind === "omission"
        ? <div className="focus-reading-omission" key={entry.id} role="separator">
            <span>{entry.omittedPages > 0 ? `已省略 ${entry.omittedPages} 页及相邻内容` : "已省略内容"}</span>
          </div>
        : <article className="focus-reading-region" key={entry.id}>
            <header><span>第 {pageLabel(entry.page)} 页</span><div>
              <button type="button" disabled={entry.fullPage} onClick={() => setExtraContext((old) => {
                const next = new Map(old);
                for (const key of entry.sourceKeys) next.set(key, (next.get(key) ?? 0) + DEFAULT_FOCUS_CONTEXT);
                return next;
              })}>扩大上下文</button>
              <button type="button" disabled={entry.fullPage} onClick={() => setFullPages((old) => new Set(old).add(entry.page))}>
                展开整页</button>
              <button type="button" onClick={() => onGoToOriginal(entry)}>前往原文 ↗</button>
            </div></header>
            <div className="focus-reading-pdf-clip" data-page={entry.page}>{renderPdfRegion(entry)}</div>
          </article>)}
      {plan.hasMore && <button type="button" className="focus-reading-more"
        onClick={() => setVisibleLimit((limit) => limit + FOCUS_BATCH_SIZE)}>
        继续加载 · 还剩 {plan.totalRegions - plan.regions.length} 处
      </button>}
    </div>
  </section>;
}
