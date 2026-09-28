import { useEffect, useMemo, useRef, useState } from "react";
import * as pdfjs from "pdfjs-dist";
import workerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";
import "pdfjs-dist/web/pdf_viewer.css";
import type { PdfAnchor } from "../../../../../packages/protocol/src/anchors";
import { fileUrl } from "../../api";
import { FocusReadingView } from "./FocusReadingView";
import type { FocusRegion, PdfRect } from "./focus-model";
import { projectNativeRegion } from "./native-projection";

pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;

/** A clipped original PDF canvas with its selectable PDF.js text layer. */
export function NativePdfRegion({ page, region, rotation = 0 }: {
  page: pdfjs.PDFPageProxy; region: FocusRegion; rotation?: number;
}) {
  const outer = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const text = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(false);
  const [availableWidth, setAvailableWidth] = useState(700);
  const totalRotation = (page.rotate + rotation) % 360;
  const unit = useMemo(() => page.getViewport({ scale: 1, rotation: totalRotation }), [page, totalRotation]);
  const scale = Math.max(.25, Math.min(2, availableWidth / unit.width));
  const viewport = useMemo(() => page.getViewport({ scale, rotation: totalRotation }), [page, scale, totalRotation]);
  const clip = projectNativeRegion(region.pdfRect, viewport);

  useEffect(() => {
    const node = outer.current;
    if (!node) return;
    const observer = new ResizeObserver(([entry]) => {
      if (entry?.contentRect.width > 0) setAvailableWidth(entry.contentRect.width);
    });
    observer.observe(node.parentElement ?? node);
    return () => observer.disconnect();
  }, []);
  useEffect(() => {
    const node = outer.current;
    if (!node) return;
    const observer = new IntersectionObserver(([entry]) => setVisible(entry.isIntersecting), { rootMargin: "250px" });
    observer.observe(node);
    return () => observer.disconnect();
  }, []);
  useEffect(() => {
    const c = canvas.current, layerNode = text.current;
    if (!c || !layerNode) return;
    if (!visible) { c.width = c.height = 0; layerNode.replaceChildren(); return; }
    let cancelled = false;
    let render: ReturnType<pdfjs.PDFPageProxy["render"]> | undefined;
    let layer: pdfjs.TextLayer | undefined;
    void (async () => {
      const ratio = Math.min(2, window.devicePixelRatio || 1);
      c.width = Math.ceil(viewport.width * ratio);
      c.height = Math.ceil(viewport.height * ratio);
      render = page.render({ canvas: c, canvasContext: c.getContext("2d")!, viewport,
        transform: [ratio, 0, 0, ratio, 0, 0] });
      await render.promise;
      if (cancelled) return;
      const content = await page.getTextContent();
      if (cancelled) return;
      layerNode.replaceChildren();
      layerNode.style.setProperty("--scale-factor", String(viewport.scale));
      layer = new pdfjs.TextLayer({ textContentSource: content, container: layerNode, viewport });
      await layer.render();
    })().catch((error) => {
      if (!cancelled && error?.name !== "RenderingCancelledException") console.error(error);
    });
    return () => { cancelled = true; render?.cancel(); layer?.cancel(); };
  }, [page, viewport, visible]);

  return <div ref={outer} className="focus-native-region" style={{ height: clip.height }}>
    <div className="focus-native-region-page" style={{ left: -clip.left, top: -clip.top,
      width: viewport.width, height: viewport.height }}>
      <canvas ref={canvas} style={{ width: viewport.width, height: viewport.height }} />
      <div ref={text} className="textLayer" />
    </div>
  </div>;
}

export type FocusPdfDocumentProps = {
  bookId: string;
  anchors: readonly PdfAnchor[];
  pageLabels?: readonly string[];
  rotation?: number;
  onGoToOriginal: (region: FocusRegion) => void;
  onClose: () => void;
};

/** Book-scoped focus viewer, ready to mount in place of the ordinary PDF pane. */
export function FocusPdfDocument({ bookId, anchors, pageLabels, rotation, onGoToOriginal, onClose }: FocusPdfDocumentProps) {
  const [pages, setPages] = useState<ReadonlyMap<number, pdfjs.PDFPageProxy>>(() => new Map());
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const wantedPages = [...new Set(anchors.map((anchor) => anchor.page))].sort((a, b) => a - b);
  const wantedKey = wantedPages.join(",");
  useEffect(() => {
    let cancelled = false;
    setPages(new Map());
    setError("");
    setLoading(true);
    const task = pdfjs.getDocument({ url: fileUrl(bookId), withCredentials: true, isEvalSupported: false });
    void (async () => {
      const document = await task.promise;
      const loaded = await Promise.all(wantedPages.filter((page) => page >= 1 && page <= document.numPages)
        .map((page) => document.getPage(page)));
      if (!cancelled) { setPages(new Map(loaded.map((page) => [page.pageNumber, page]))); setLoading(false); }
    })().catch((cause) => { if (!cancelled) { setError(String(cause)); setLoading(false); } });
    return () => { cancelled = true; void task.destroy().catch(() => {}); };
  }, [bookId, wantedKey]);
  const pageBoxes = [...pages.values()].map((page) => ({ page: page.pageNumber, rect: page.view as PdfRect }));
  if (error) return <div className="focus-reading-load">原文聚焦无法打开 PDF：{error}
    <button type="button" onClick={onClose}>返回阅读</button></div>;
  if (loading) return <div className="focus-reading-load">正在打开原文聚焦…</div>;
  return <FocusReadingView key={JSON.stringify(anchors)} anchors={anchors} pageBoxes={pageBoxes} pageLabels={pageLabels}
    onGoToOriginal={onGoToOriginal} onClose={onClose}
    renderPdfRegion={(region) => {
      const page = pages.get(region.page);
      return page ? <NativePdfRegion page={page} region={region} rotation={rotation} /> : null;
    }} />;
}
