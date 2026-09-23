import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import * as pdfjs from "pdfjs-dist";
import workerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";
import "pdfjs-dist/web/pdf_viewer.css";
import type {
  Annotation,
  ReadingSelection,
  SourceAnchor,
  PdfAnchor,
  AnnotationInputSchema,
} from "../../../packages/protocol/src";
import type { z } from "zod";
import { fileUrl } from "./api";
import { zoomWorkspaceAtPointer } from "./WorkspaceViewport";
import type { InkPoint } from "./InkGeometry";
import {
  WORKSPACE_DOCUMENT_X,
  type WorkspaceCamera,
} from "../../../packages/protocol/src/workspace";
pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;
export type AnnotationMode = "pointer" | "select" | "sticky" | "region" | "pen" | "highlighter" | "eraser";
export type QuestionRegion = {
  page: number;
  rect: [number, number, number, number];
  image: string;
  operationId?: string;
};
export type RegionAction = "card" | "question" | "annotation";
type View = ReturnType<pdfjs.PDFPageProxy["getViewport"]>;
type Rect = [number, number, number, number];
const ordered = (r: number[]): Rect => [
  Math.min(r[0], r[2]),
  Math.min(r[1], r[3]),
  Math.max(r[0], r[2]),
  Math.max(r[1], r[3]),
];
function pdfRect(view: View, r: Rect): Rect {
  return ordered([
    ...view.convertToPdfPoint(r[0], r[1]),
    ...view.convertToPdfPoint(r[2], r[3]),
  ]);
}
function rectStyle(r: number[]) {
  const b = ordered(r);
  return { left: b[0], top: b[1], width: b[2] - b[0], height: b[3] - b[1] };
}
function AnnotationStroke({
  view,
  rect,
  kind,
}: {
  view: View;
  rect: Rect;
  kind: "underline" | "strike";
}) {
  const y = kind === "underline" ? rect[1] : (rect[1] + rect[3]) / 2;
  const start = view.convertToViewportPoint(rect[0], y),
    end = view.convertToViewportPoint(rect[2], y),
    box = ordered(view.convertToViewportRectangle(rect));
  return (
    <svg
      width="100%"
      height="100%"
      style={{ overflow: "visible", display: "block" }}
    >
      <line
        x1={start[0] - box[0]}
        y1={start[1] - box[1]}
        x2={end[0] - box[0]}
        y2={end[1] - box[1]}
        stroke="var(--annotation-color)"
        strokeWidth="2"
      />
    </svg>
  );
}
const colors = {
  yellow: "#f5d549",
  green: "#60c88c",
  blue: "#65a8ed",
  pink: "#eb88b4",
};
function Page({
  proxy,
  view,
  annotations,
  highlight,
  mode,
  onCreate,
  onAnnotation,
  onQuestionRegion,
  onRegionAction,
  placement,
  sourceFocus,
}: {
  proxy: pdfjs.PDFPageProxy;
  view: View;
  annotations: Annotation[];
  highlight?: SourceAnchor;
  mode: AnnotationMode | "ask-region";
  onCreate: (input: z.infer<typeof AnnotationInputSchema>) => void | Promise<void | boolean>;
  onAnnotation: (id: string) => void;
  onQuestionRegion?: (region: QuestionRegion) => void;
  onRegionAction?: (region: QuestionRegion, action: RegionAction, includePersonalMarks: boolean) => void | Promise<void>;
  placement?: { left: number; top: number };
  sourceFocus?: PdfAnchor[];
}) {
  const outer = useRef<HTMLDivElement>(null),
    canvas = useRef<HTMLCanvasElement>(null),
    text = useRef<HTMLDivElement>(null),
    regionOperationId = useRef(crypto.randomUUID());
  const [visible, setVisible] = useState(false),
    [renderedView, setRenderedView] = useState<View>(),
    [drag, setDrag] = useState<Rect>();
  const [pendingRegion, setPendingRegion] = useState<Rect>();
  const [includePersonalMarks, setIncludePersonalMarks] = useState(false);
  const [regionBusy, setRegionBusy] = useState(false);
  const [regionError, setRegionError] = useState("");
  const resizing = useRef<{ corner: number; original: Rect } | undefined>(undefined);
  const start = useRef<{ point: [number, number]; view: View } | undefined>(
    undefined,
  );
  const ready = renderedView === view;
  useLayoutEffect(() => {
    start.current = undefined;
    setDrag(undefined);
    setPendingRegion(undefined);
    resizing.current = undefined;
  }, [view, mode]);
  useEffect(() => {
    const observer = new IntersectionObserver(
      ([e]) => setVisible(e.isIntersecting),
      { rootMargin: "300px" },
    );
    observer.observe(outer.current!);
    return () => observer.disconnect();
  }, []);
  useEffect(() => {
    let cancelled = false;
    let render: ReturnType<pdfjs.PDFPageProxy["render"]> | undefined,
      layer: pdfjs.TextLayer | undefined;
    setRenderedView(undefined);
    if (!visible) {
      canvas.current!.width = 0;
      canvas.current!.height = 0;
      text.current!.replaceChildren();
      return;
    }
    void (async () => {
      const c = canvas.current!,
        ratio = window.devicePixelRatio || 1;
      c.width = Math.floor(view.width * ratio);
      c.height = Math.floor(view.height * ratio);
      render = proxy.render({
        canvas: c,
        canvasContext: c.getContext("2d")!,
        viewport: view,
        transform: [ratio, 0, 0, ratio, 0, 0],
      });
      await render.promise;
      if (cancelled) return;
      setRenderedView(view);
      const content = await proxy.getTextContent();
      if (cancelled) return;
      text.current!.replaceChildren();
      text.current!.style.setProperty("--scale-factor", String(view.scale));
      layer = new pdfjs.TextLayer({
        textContentSource: content,
        container: text.current!,
        viewport: view,
      });
      await layer.render();
    })().catch((e) => {
      if (!cancelled && e?.name !== "RenderingCancelledException")
        console.error(e);
    });
    return () => {
      cancelled = true;
      render?.cancel();
      layer?.cancel();
    };
  }, [proxy, view, visible]);
  const point = (e: React.PointerEvent) => {
    const b = outer.current!.getBoundingClientRect();
    return [
      Math.max(0, Math.min(view.width, e.clientX - b.left)),
      Math.max(0, Math.min(view.height, e.clientY - b.top)),
    ] as [number, number];
  };
  const page = proxy.pageNumber;
  function captureRegion(rect: Rect, withMarks: boolean): QuestionRegion {
    const source = canvas.current!;
    const [left, top, right, bottom] = rect;
    const width = right - left, height = bottom - top;
    const scale = Math.min(2, 2048 / Math.max(width, height));
    const crop = document.createElement("canvas");
    crop.width = Math.ceil(width * scale);
    crop.height = Math.ceil(height * scale);
    const context = crop.getContext("2d")!;
    context.drawImage(source,
      left * source.width / view.width, top * source.height / view.height,
      width * source.width / view.width, height * source.height / view.height,
      0, 0, crop.width, crop.height);
    if (withMarks) {
      context.save();
      context.scale(scale, scale);
      context.translate(-left, -top);
      for (const annotation of annotations)
        for (const anchor of annotation.anchors.filter((item) => item.page === page))
          for (const pdf of anchor.rects) {
            const box = ordered(view.convertToViewportRectangle(pdf));
            context.strokeStyle = context.fillStyle = colors[annotation.color];
            context.lineWidth = 2;
            if (annotation.kind === "highlight") {
              context.globalAlpha = 0.3;
              context.fillRect(box[0], box[1], box[2] - box[0], box[3] - box[1]);
              context.globalAlpha = 1;
            } else if (annotation.kind === "underline" || annotation.kind === "strike") {
              const y = annotation.kind === "underline" ? box[3] : (box[1] + box[3]) / 2;
              context.beginPath(); context.moveTo(box[0], y); context.lineTo(box[2], y); context.stroke();
            } else if (annotation.kind === "sticky") {
              context.fillRect(box[0], box[1], box[2] - box[0], box[3] - box[1]);
            }
          }
      context.restore();
    }
    return { page, rect: pdfRect(view, rect), image: crop.toDataURL("image/png"),
      operationId: regionOperationId.current };
  }
  async function submitRegion(action: RegionAction) {
    if (!pendingRegion || !onRegionAction || regionBusy) return;
    setRegionBusy(true);
    setRegionError("");
    try {
      await onRegionAction(captureRegion(pendingRegion, includePersonalMarks), action, includePersonalMarks);
      setPendingRegion(undefined);
      setIncludePersonalMarks(false);
    } catch (error) {
      setRegionError(error instanceof Error ? error.message : String(error));
    } finally {
      setRegionBusy(false);
    }
  }
  return (
    <div
      ref={outer}
      id={`page-${page}`}
      className="pdf-page"
      data-page={page}
      data-render-ready={ready}
      style={
        {
          width: view.width,
          height: view.height,
          ...(placement
            ? { position: "absolute", ...placement, margin: 0 }
            : {}),
          "--total-scale-factor": view.scale * proxy.userUnit,
        } as React.CSSProperties
      }
    >
      <canvas ref={canvas} style={{ width: "100%", height: "100%" }} />
      <div ref={text} className="textLayer" />
      <div className="annotation-layer">
        {sourceFocus
          ?.filter((anchor) => anchor.page === page)
          .flatMap((anchor) =>
            anchor.rects.map((rect, index) => (
              <span
                key={`source-${index}`}
                className="workspace-source-focus"
                style={rectStyle(view.convertToViewportRectangle(rect))}
              />
            )),
          )}
        {annotations.flatMap((a) =>
          a.anchors
            .filter((x) => x.page === page)
            .flatMap((anchor) =>
              anchor.rects.map((r, i) => (
                <button
                  key={`${a.id}-${i}`}
                  title={a.quote || "打开批注笔记"}
                  aria-label="打开批注笔记"
                  className={`annotation annotation-${a.kind}`}
                  style={
                    {
                      ...rectStyle(view.convertToViewportRectangle(r)),
                      "--annotation-color": colors[a.color],
                    } as React.CSSProperties
                  }
                  onClick={() => onAnnotation(a.noteId)}
                >
                  {a.kind === "sticky" ? "▤" : null}
                  {(a.kind === "underline" || a.kind === "strike") && (
                    <AnnotationStroke view={view} rect={r} kind={a.kind} />
                  )}
                </button>
              )),
            ),
        )}
      </div>
      {highlight?.page === page && (
        <div className="highlights">
          {highlight.rects.map((r, i) => {
            const natural = proxy.getViewport({ scale: 1 });
            const p = pdfRect(natural, [
              r[0] * natural.width,
              r[1] * natural.height,
              (r[0] + r[2]) * natural.width,
              (r[1] + r[3]) * natural.height,
            ]);
            return (
              <i
                key={i}
                style={rectStyle(view.convertToViewportRectangle(p))}
              />
            );
          })}
        </div>
      )}
      {(mode === "sticky" || mode === "region" || mode === "ask-region") && (
        <div
          className="annotation-capture"
          aria-busy={!ready}
          title={
            ready
              ? mode === "ask-region"
                ? "拖动框选图表，松开后加入问题"
                : "在页面上拖动或点击添加批注"
              : "页面绘制中，请稍候"
          }
          onPointerDown={(e) => {
            if (e.button !== 0 || !ready || (e.target as HTMLElement).closest(".region-preview")) return;
            e.preventDefault();
            setPendingRegion(undefined);
            setIncludePersonalMarks(false);
            setRegionError("");
            start.current = { point: point(e), view };
            e.currentTarget.setPointerCapture(e.pointerId);
          }}
          onPointerMove={(e) => {
            if (start.current) setDrag([...start.current.point, ...point(e)]);
          }}
          onPointerCancel={() => {
            start.current = undefined;
            setDrag(undefined);
          }}
          onPointerUp={(e) => {
            const origin = start.current;
            start.current = undefined;
            setDrag(undefined);
            if (!origin || origin.view !== view || !ready) return;
            const p = point(e),
              r = ordered([...origin.point, ...p]);
            if (mode === "sticky") {
              const size = 22 * view.scale;
              r[2] = Math.min(view.width, r[0] + size);
              r[3] = Math.min(view.height, r[1] + size);
            }
            if (r[2] - r[0] < 3 || r[3] - r[1] < 3) return;
            if (mode === "region" && onRegionAction) {
              regionOperationId.current = crypto.randomUUID();
              setPendingRegion(r);
              return;
            }
            let image: string | undefined;
            if (mode === "region" || mode === "ask-region") {
              const c = canvas.current!,
                ratioX = c.width / view.width,
                ratioY = c.height / view.height,
                w = r[2] - r[0],
                h = r[3] - r[1],
                scale = Math.min(2, 2048 / Math.max(w, h));
              const crop = document.createElement("canvas");
              crop.width = Math.ceil(w * scale);
              crop.height = Math.ceil(h * scale);
              crop
                .getContext("2d")!
                .drawImage(
                  c,
                  r[0] * ratioX,
                  r[1] * ratioY,
                  w * ratioX,
                  h * ratioY,
                  0,
                  0,
                  crop.width,
                  crop.height,
                );
              image = crop.toDataURL("image/png");
            }
            if (mode === "ask-region") {
              onQuestionRegion?.({
                page,
                rect: pdfRect(view, r),
                image: image!,
              });
              return;
            }
            onCreate({
              kind: mode,
              color: "yellow",
              quote: "",
              anchors: [{ page, rects: [pdfRect(view, r)] }],
              image,
            });
          }}
        >
          {drag && <i className="capture-rectangle" style={rectStyle(drag)} />}
          {pendingRegion && mode === "region" && onRegionAction && (
            <div className="region-preview" style={rectStyle(pendingRegion)}>
              {[0, 1, 2, 3].map((corner) => (
                <button
                  key={corner}
                  className={`region-handle corner-${corner}`}
                  aria-label={["调整区域左上角", "调整区域右上角", "调整区域右下角", "调整区域左下角"][corner]}
                  onPointerDown={(event) => {
                    event.stopPropagation(); event.preventDefault();
                    resizing.current = { corner, original: pendingRegion };
                    event.currentTarget.setPointerCapture(event.pointerId);
                  }}
                  onPointerMove={(event) => {
                    if (!resizing.current || !event.currentTarget.hasPointerCapture(event.pointerId)) return;
                    const p = point(event), r = resizing.current.original;
                    setPendingRegion(ordered([
                      corner === 0 || corner === 3 ? p[0] : r[0],
                      corner === 0 || corner === 1 ? p[1] : r[1],
                      corner === 1 || corner === 2 ? p[0] : r[2],
                      corner === 2 || corner === 3 ? p[1] : r[3],
                    ]));
                  }}
                  onPointerUp={(event) => {
                    event.stopPropagation();
                    regionOperationId.current = crypto.randomUUID();
                    resizing.current = undefined;
                  }}
                  onPointerCancel={(event) => {
                    event.stopPropagation();
                    if (resizing.current) setPendingRegion(resizing.current.original);
                    resizing.current = undefined;
                  }}
                />
              ))}
              <div className="reader-context-bar region-actions" role="toolbar" aria-label="区域摘录操作"
                style={{ left: Math.max(8, Math.min(view.width - Math.min(430, view.width - 16) - 8, pendingRegion[0])) - pendingRegion[0],
                  top: (pendingRegion[3] + 56 < view.height ? pendingRegion[3] + 8 : Math.max(0, pendingRegion[1] - 52)) - pendingRegion[1],
                  maxWidth: view.width - 16 }}>
                <button disabled={regionBusy} onClick={() => void submitRegion("card")}>创建图片卡片</button>
                <button disabled={regionBusy} onClick={() => void submitRegion("question")}>加入提问</button>
                <label><input type="checkbox" checked={includePersonalMarks} onChange={(event) => setIncludePersonalMarks(event.target.checked)} />包含个人标注</label>
                <button disabled={regionBusy} title="保留旧区域批注和笔记能力" onClick={() => void submitRegion("annotation")}>批注</button>
                <button onClick={() => setPendingRegion(undefined)}>取消</button>
                {regionError && <span role="alert">{regionError}</span>}
              </div>
            </div>
          )}
        </div>
      )}
      <span className="page-number">{page}</span>
    </div>
  );
}
export type WorkspacePage = {
  page: number;
  x: number;
  y: number;
  width: number;
  height: number;
  locate: (rect: Rect) => { x: number; y: number };
  toPdf: (point: InkPoint) => InkPoint;
  toWorld: (point: InkPoint) => InkPoint;
};
export interface PdfReaderProps {
  id: string;
  initialPage: number;
  zoom: number;
  onZoom?: (zoom: number) => void;
  rotation?: number;
  onPage: (page: number) => void;
  onSelection: (selection: ReadingSelection | undefined) => void;
  highlight?: SourceAnchor;
  annotations?: Annotation[];
  mode?: AnnotationMode;
  onCreate: (input: z.infer<typeof AnnotationInputSchema>) => void | Promise<void | boolean>;
  onAnnotation: (id: string) => void;
  onQuestionRegion?: (region: QuestionRegion) => void;
  onRegionAction?: (region: QuestionRegion, action: RegionAction, includePersonalMarks: boolean) => void | Promise<void>;
  workspace?: {
    ready: boolean;
    onDocumentWidth: (width: number) => void;
    camera?: WorkspaceCamera;
    onCamera: (camera: WorkspaceCamera) => void;
    navigation?: { key: number; x: number; y: number; zoom: number };
    width: number;
    height: number;
    render: (
      pages: WorkspacePage[],
      viewport: HTMLDivElement | null,
    ) => ReactNode;
    sourceFocus?: PdfAnchor[];
    onInkStart?: (point: InkPoint) => void;
    onInkMove?: (points: InkPoint[]) => void;
    onInkEnd?: (point: InkPoint) => void;
    onInkCancel?: () => void;
  };
}
export function PdfReader({
  id,
  initialPage,
  zoom,
  onZoom,
  rotation = 0,
  onPage,
  onSelection,
  highlight,
  annotations = [],
  mode = "select",
  onCreate,
  onAnnotation,
  onQuestionRegion,
  onRegionAction,
  workspace,
}: PdfReaderProps) {
  const [pages, setPages] = useState<pdfjs.PDFPageProxy[]>([]),
    [error, setError] = useState("");
  const scroll = useRef<HTMLDivElement>(null),
    position = useRef({ page: initialPage, x: 0, y: 0 }),
    views = useRef<View[]>([]);
  const pan = useRef<
    | {
        x: number;
        y: number;
        left: number;
        top: number;
        button: number;
        moved: boolean;
      }
    | undefined
  >(undefined);
  const space = useRef(false);
  const inkPointer = useRef<number | undefined>(undefined);
  const inkLast = useRef<{ x: number; y: number; point: InkPoint } | undefined>(undefined);
  const inkCallbacks = useRef(workspace);
  inkCallbacks.current = workspace;
  const suppressContextMenu = useRef(false);
  const suppressSelection = useRef(false);
  const [panReady, setPanReady] = useState(false);
  const [panning, setPanning] = useState(false);
  const restoredCamera = useRef(false);
  const navigationKey = useRef<number | undefined>(undefined);
  const worldCamera = useRef<
    { left: number; top: number; zoom: number } | undefined
  >(undefined);
  const wheelPosition = useRef<{ left: number; top: number } | undefined>(
    undefined,
  );
  const wheelState = useRef({ zoom, onZoom });
  wheelState.current = { zoom, onZoom };
  useEffect(() => {
    const el = scroll.current;
    if (!el) return;
    let frame = 0;
    let next: ReturnType<typeof zoomWorkspaceAtPointer> | undefined;
    const wheel = (event: WheelEvent) => {
      const current = wheelState.current;
      if (!event.ctrlKey || !current.onZoom) return;
      event.preventDefault();
      const bounds = el.getBoundingClientRect();
      next = zoomWorkspaceAtPointer({
        zoom: next?.zoom ?? current.zoom,
        left: next?.left ?? el.scrollLeft,
        top: next?.top ?? el.scrollTop,
        x: event.clientX - bounds.left,
        y: event.clientY - bounds.top,
        deltaY: event.deltaY,
        deltaMode: event.deltaMode,
        viewportHeight: el.clientHeight,
      });
      if (!frame)
        frame = requestAnimationFrame(() => {
          frame = 0;
          if (next && next.zoom !== wheelState.current.zoom) {
            wheelPosition.current = { left: next.left, top: next.top };
            wheelState.current.onZoom?.(next.zoom);
          }
          next = undefined;
        });
    };
    // React wheel listeners are passive; this must suppress browser/page zoom.
    el.addEventListener("wheel", wheel, { passive: false });
    return () => {
      el.removeEventListener("wheel", wheel);
      cancelAnimationFrame(frame);
    };
  }, []);
  useEffect(() => {
    const keydown = (event: KeyboardEvent) => {
      if (!workspace || event.code !== "Space" || event.isComposing || event.repeat) return;
      if ((event.target as HTMLElement)?.closest("input,textarea,select,[contenteditable],[aria-modal='true']")) return;
      event.preventDefault();
      space.current = true;
      setPanReady(true);
      if (inkPointer.current !== undefined && inkLast.current && scroll.current) {
        inkCallbacks.current?.onInkEnd?.(inkLast.current.point);
        inkPointer.current = undefined;
        pan.current = { x: inkLast.current.x, y: inkLast.current.y,
          left: scroll.current.scrollLeft, top: scroll.current.scrollTop,
          button: 0, moved: false };
      }
    };
    const keyup = (event: KeyboardEvent) => {
      if (event.code !== "Space") return;
      space.current = false;
      setPanReady(false);
    };
    const clear = () => {
      if (inkPointer.current !== undefined) inkCallbacks.current?.onInkCancel?.();
      inkPointer.current = undefined;
      space.current = false;
      setPanReady(false);
      pan.current = undefined;
      setPanning(false);
    };
    window.addEventListener("keydown", keydown);
    window.addEventListener("keyup", keyup);
    window.addEventListener("blur", clear);
    return () => {
      window.removeEventListener("keydown", keydown);
      window.removeEventListener("keyup", keyup);
      window.removeEventListener("blur", clear);
    };
  }, [!!workspace]);
  useEffect(() => {
    // PDF.js can clear its text selection after mouseup has already fired.
    const syncSelection = () => {
      const selection = getSelection();
      if (
        !selection?.rangeCount ||
        !selection.toString().trim() ||
        !scroll.current?.contains(
          selection.getRangeAt(0).commonAncestorContainer,
        )
      )
        onSelection(undefined);
    };
    document.addEventListener("selectionchange", syncSelection);
    return () => document.removeEventListener("selectionchange", syncSelection);
  }, [onSelection]);
  // All page dimensions are known before mounting: later lazy rendering cannot move earlier pages.
  useEffect(() => {
    let active = true;
    const task = pdfjs.getDocument({
      url: fileUrl(id),
      withCredentials: true,
      isEvalSupported: false,
    });
    void (async () => {
      const doc = await task.promise;
      const result: pdfjs.PDFPageProxy[] = [];
      for (let i = 1; i <= doc.numPages; i += 16) {
        result.push(
          ...(await Promise.all(
            Array.from({ length: Math.min(16, doc.numPages - i + 1) }, (_, n) =>
              doc.getPage(i + n),
            ),
          )),
        );
        if (!active) return;
      }
      setPages(result);
    })().catch((e) => {
      if (active) setError(e.message);
    });
    return () => {
      active = false;
      void task.destroy().catch(() => {});
    };
  }, [id]);
  const cache = useRef<
    | {
        pages: pdfjs.PDFPageProxy[];
        zoom: number;
        rotation: number;
        value: View[];
      }
    | undefined
  >(undefined);
  if (
    !cache.current ||
    cache.current.pages !== pages ||
    cache.current.zoom !== zoom ||
    cache.current.rotation !== rotation
  )
    cache.current = {
      pages,
      zoom,
      rotation,
      value: pages.map((p) =>
        p.getViewport({ scale: zoom, rotation: (p.rotate + rotation) % 360 }),
      ),
    };
  views.current = cache.current.value;
  const documentWidth = Math.max(
    0,
    ...views.current.map((view) => view.width / zoom),
  );
  useLayoutEffect(() => {
    if (documentWidth) workspace?.onDocumentWidth(documentWidth);
  }, [documentWidth]);
  let bottom = 40;
  const worldPages = views.current.map((view, index) => {
    const page = {
      page: index + 1,
      x: WORKSPACE_DOCUMENT_X + (documentWidth - view.width / zoom) / 2,
      y: bottom,
      width: view.width / zoom,
      height: view.height / zoom,
      locate: (rect: Rect) => {
        const box = ordered(view.convertToViewportRectangle(rect));
        return { x: page.x + box[0] / zoom, y: page.y + box[1] / zoom };
      },
      toPdf: (point: InkPoint): InkPoint => view.convertToPdfPoint(
        (point[0] - page.x) * zoom, (point[1] - page.y) * zoom) as InkPoint,
      toWorld: (point: InkPoint): InkPoint => {
        const [x, y] = view.convertToViewportPoint(point[0], point[1]);
        return [page.x + x / zoom, page.y + y / zoom];
      },
    };
    bottom += page.height + 24;
    return page;
  });
  function worldPoint(event: { clientX: number; clientY: number }): InkPoint {
    const rect = scroll.current?.querySelector(".pdf-world")?.getBoundingClientRect();
    if (!rect) return [0, 0];
    return [Math.max(0, (event.clientX - rect.left) / zoom),
      Math.max(0, (event.clientY - rect.top) / zoom)];
  }
  function captureCamera(el: HTMLDivElement) {
    worldCamera.current = { left: el.scrollLeft, top: el.scrollTop, zoom };
    if (workspace && restoredCamera.current)
      workspace.onCamera({
        x: el.scrollLeft / zoom,
        y: el.scrollTop / zoom,
        zoom,
      });
  }
  useLayoutEffect(() => {
    const el = scroll.current,
      p = position.current,
      node = el?.querySelector<HTMLElement>(`[data-page="${p.page}"]`);
    if (workspace && (!workspace.ready || !pages.length)) return;
    if (el && workspace && !restoredCamera.current) {
      const camera = workspace.camera;
      if (camera && Math.abs(camera.zoom - zoom) > 0.001 && onZoom) {
        onZoom(camera.zoom);
        return;
      }
      restoredCamera.current = true;
      el.scrollTo({
        left: camera
          ? camera.x * zoom
          : (WORKSPACE_DOCUMENT_X + documentWidth / 2) * zoom -
            el.clientWidth / 2,
        top: camera
          ? camera.y * zoom
          : (worldPages[initialPage - 1]?.y ?? 40) * zoom - 20,
      });
      captureCamera(el);
      return;
    }
    const navigation = workspace?.navigation;
    if (el && navigation && navigation.key !== navigationKey.current) {
      if (Math.abs(navigation.zoom - zoom) > 0.001) return;
      navigationKey.current = navigation.key;
      el.scrollTo({ left: navigation.x * zoom, top: navigation.y * zoom });
      captureCamera(el);
      return;
    }
    if (el && wheelPosition.current) {
      el.scrollTo(wheelPosition.current);
      wheelPosition.current = undefined;
      captureCamera(el);
      return;
    }
    if (el && workspace && worldCamera.current) {
      const previous = worldCamera.current;
      const ratio = zoom / previous.zoom;
      // Use today's viewport width, not the center cached before a sidebar resized it.
      // A rotation at the same zoom must not translate the workspace camera.
      el.scrollTo({
        left: (previous.left + el.clientWidth / 2) * ratio - el.clientWidth / 2,
        top: (previous.top + 20) * ratio - 20,
      });
      captureCamera(el);
      return;
    }
    if (node && el) {
      el.scrollTop = node.offsetTop + p.y * node.offsetHeight - 20;
      el.scrollLeft = Math.max(
        0,
        node.offsetLeft + p.x * node.offsetWidth - el.clientWidth / 2,
      );
    }
  }, [pages, zoom, rotation, workspace?.ready, workspace?.navigation]);
  const report = () => {
    const el = scroll.current;
    if (!el) return;
    if (workspace) captureCamera(el);
    const top = el.scrollTop + 20,
      node = Array.from(el.querySelectorAll<HTMLElement>("[data-page]")).find(
        (p) => p.offsetTop + p.offsetHeight > top,
      );
    if (node) {
      position.current = {
        page: Number(node.dataset.page),
        x:
          (el.scrollLeft + el.clientWidth / 2 - node.offsetLeft) /
          node.offsetWidth,
        y: Math.max(0, (top - node.offsetTop) / node.offsetHeight),
      };
      onPage(position.current.page);
    }
  };
  return (
    <div
      ref={scroll}
      className={`pdf-scroll${workspace ? " workspace-scroll" : ""}${mode === "pointer" ? " pointer-tool" : ""}${panReady ? " pan-ready" : ""}${panning ? " panning" : ""}`}
      tabIndex={-1}
      onPointerDownCapture={(event) => {
        if (!workspace) return;
        const target = event.target as HTMLElement;
        suppressContextMenu.current = false;
        suppressSelection.current = false;
        if (inkPointer.current !== undefined && (event.button === 1 || event.button === 2)) {
          inkCallbacks.current?.onInkEnd?.(inkLast.current?.point ?? worldPoint(event));
          inkPointer.current = undefined;
        }
        if ((mode === "pen" || mode === "highlighter" || mode === "eraser") &&
            event.button === 0 && !space.current && workspace.onInkStart &&
            !target.closest(".workspace-card,.workspace-toolbar,.region-preview,button,input,textarea,select,[contenteditable]")) {
          event.preventDefault();
          event.stopPropagation();
          const point = worldPoint(event);
          inkPointer.current = event.pointerId;
          inkLast.current = { x: event.clientX, y: event.clientY, point };
          scroll.current!.setPointerCapture(event.pointerId);
          workspace.onInkStart(point);
          return;
        }
        if (
          event.button === 1 ||
          space.current ||
          (event.button === 2 &&
            !target.closest(
              "button:not(.workspace-resize),input,textarea,select,[contenteditable]",
            )) ||
          (event.button === 0 &&
            (target === scroll.current ||
              target.classList.contains("pdf-world") ||
              (mode === "pointer" &&
                !!target.closest(".pdf-page") &&
                !target.closest("button,input,textarea,select,[contenteditable]"))))
        ) {
          if (event.button !== 2) event.preventDefault();
          event.stopPropagation();
          const el = scroll.current!;
          el.focus({ preventScroll: true });
          el.setPointerCapture(event.pointerId);
          setPanning(event.button !== 2);
          pan.current = {
            x: event.clientX,
            y: event.clientY,
            left: el.scrollLeft,
            top: el.scrollTop,
            button: event.button,
            moved: false,
          };
        }
      }}
      onPointerMove={(event) => {
        if (inkPointer.current === event.pointerId) {
          if ((event.buttons & 2) || space.current) {
            workspace?.onInkEnd?.(inkLast.current?.point ?? worldPoint(event));
            inkPointer.current = undefined;
            const el = scroll.current!;
            pan.current = { x: event.clientX, y: event.clientY,
              left: el.scrollLeft, top: el.scrollTop,
              button: event.buttons & 2 ? 2 : 0, moved: false };
            return;
          }
          event.preventDefault();
          const samples = event.nativeEvent.getCoalescedEvents?.() ?? [event.nativeEvent];
          const points = samples.map(worldPoint);
          inkLast.current = { x: event.clientX, y: event.clientY, point: worldPoint(event) };
          workspace?.onInkMove?.(points);
          return;
        }
        if (pan.current && scroll.current) {
          const distance = Math.hypot(
            event.clientX - pan.current.x,
            event.clientY - pan.current.y,
          );
          if (distance < 5 && !pan.current.moved) return;
          pan.current.moved = true;
          suppressSelection.current = true;
          if (pan.current.button === 2) suppressContextMenu.current = true;
          setPanning(true);
          event.preventDefault();
          scroll.current.scrollTo({
            left: pan.current.left + pan.current.x - event.clientX,
            top: pan.current.top + pan.current.y - event.clientY,
          });
        }
      }}
      onContextMenu={(event) => {
        if (suppressContextMenu.current) {
          event.preventDefault();
          suppressContextMenu.current = false;
        }
      }}
      onPointerUp={(event) => {
        if (inkPointer.current === event.pointerId) {
          inkPointer.current = undefined;
          workspace?.onInkEnd?.(worldPoint(event));
          return;
        }
        pan.current = undefined;
        setPanning(false);
      }}
      onPointerCancel={(event) => {
        if (inkPointer.current === event.pointerId) {
          inkPointer.current = undefined;
          workspace?.onInkCancel?.();
        }
        pan.current = undefined;
        setPanning(false);
      }}
      onScroll={report}
      onMouseUp={(e) => {
        if (e.button !== 0 || suppressSelection.current) return;
        if (mode !== "select" || onQuestionRegion) return;
        const s = getSelection();
        if (!s?.rangeCount || !s.toString().trim()) {
          onSelection(undefined);
          return;
        }
        const range = s.getRangeAt(0);
        if (!scroll.current?.contains(range.commonAncestorContainer)) return;
        const anchors: PdfAnchor[] = [];
        const selectedText: string[] = [];
        for (const node of scroll.current.querySelectorAll<HTMLElement>(
          "[data-page]",
        )) {
          if (!range.intersectsNode(node)) continue;
          const page = Number(node.dataset.page),
            box = node.getBoundingClientRect(),
            view = views.current[page - 1];
          const rects: Rect[] = [];
          const selectedRects: DOMRect[] = [];
          const textLayer = node.querySelector(".textLayer");
          if (!textLayer) continue;
          const walker = document.createTreeWalker(
            textLayer,
            NodeFilter.SHOW_TEXT,
          );
          let textNode: Node | null;
          while ((textNode = walker.nextNode())) {
            if (!range.intersectsNode(textNode)) continue;
            const fragment = document.createRange();
            fragment.selectNodeContents(textNode);
            if (fragment.compareBoundaryPoints(Range.START_TO_START, range) < 0)
              fragment.setStart(range.startContainer, range.startOffset);
            if (fragment.compareBoundaryPoints(Range.END_TO_END, range) > 0)
              fragment.setEnd(range.endContainer, range.endOffset);
            if (fragment.toString()) selectedText.push(fragment.toString());
            selectedRects.push(...fragment.getClientRects());
          }
          for (const r of selectedRects) {
            if (
              r.width < 1 ||
              r.height < 1 ||
              r.left < box.left - 1 ||
              r.right > box.right + 1 ||
              r.top < box.top - 1 ||
              r.bottom > box.bottom + 1
            )
              continue;
            const converted = pdfRect(view, [
              r.left - box.left,
              r.top - box.top,
              r.right - box.left,
              r.bottom - box.top,
            ]);
            if (
              !rects.some((v) =>
                v.every((n, i) => Math.abs(n - converted[i]) < 0.5),
              )
            )
              rects.push(converted);
          }
          if (rects.length) anchors.push({ page, rects });
        }
        if (anchors.length)
          onSelection({
            text: selectedText.join(" ").slice(0, 12000),
            page: anchors[0].page,
            anchors,
            screen: { x: e.clientX, y: e.clientY },
          });
        else onSelection(undefined);
      }}
    >
      {error ? (
        <p className="error">PDF 无法打开：{error}</p>
      ) : pages.length ? (
        <div
          className={workspace ? "pdf-world" : undefined}
          style={
            workspace
              ? {
                  position: "relative",
                  width:
                    Math.max(
                      workspace.width,
                      WORKSPACE_DOCUMENT_X * 2 + documentWidth,
                    ) * zoom,
                  height: Math.max(workspace.height, bottom + 40) * zoom,
                }
              : undefined
          }
        >
          {pages.map((p, i) => (
            <Page
              key={p.pageNumber}
              proxy={p}
              view={views.current[i]}
              annotations={annotations}
              highlight={highlight}
              mode={onQuestionRegion ? "ask-region" : mode}
              onCreate={onCreate}
              onAnnotation={onAnnotation}
              onQuestionRegion={onQuestionRegion}
              onRegionAction={onRegionAction}
              sourceFocus={workspace?.sourceFocus}
              placement={
                workspace
                  ? {
                      left: worldPages[i].x * zoom,
                      top: worldPages[i].y * zoom,
                    }
                  : undefined
              }
            />
          ))}
          {workspace?.render(worldPages, scroll.current)}
        </div>
      ) : (
        <p className="loading">正在打开 PDF…</p>
      )}
    </div>
  );
}
