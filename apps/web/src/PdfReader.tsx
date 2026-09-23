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
pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;
export type AnnotationMode = "select" | "sticky" | "region";
export type QuestionRegion = {
  page: number;
  rect: [number, number, number, number];
  image: string;
};
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
  placement,
  sourceFocus,
}: {
  proxy: pdfjs.PDFPageProxy;
  view: View;
  annotations: Annotation[];
  highlight?: SourceAnchor;
  mode: AnnotationMode | "ask-region";
  onCreate: (input: z.infer<typeof AnnotationInputSchema>) => void;
  onAnnotation: (id: string) => void;
  onQuestionRegion?: (region: QuestionRegion) => void;
  placement?: { left: number; top: number };
  sourceFocus?: PdfAnchor[];
}) {
  const outer = useRef<HTMLDivElement>(null),
    canvas = useRef<HTMLCanvasElement>(null),
    text = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(false),
    [renderedView, setRenderedView] = useState<View>(),
    [drag, setDrag] = useState<Rect>();
  const start = useRef<{ point: [number, number]; view: View } | undefined>(
    undefined,
  );
  const ready = renderedView === view;
  useLayoutEffect(() => {
    start.current = undefined;
    setDrag(undefined);
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
      {mode !== "select" && (
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
            if (e.button !== 0 || !ready) return;
            e.preventDefault();
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
  onCreate: (input: z.infer<typeof AnnotationInputSchema>) => void;
  onAnnotation: (id: string) => void;
  onQuestionRegion?: (region: QuestionRegion) => void;
  workspace?: {
    width: number;
    height: number;
    render: (
      pages: WorkspacePage[],
      viewport: HTMLDivElement | null,
    ) => ReactNode;
    sourceFocus?: PdfAnchor[];
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
  workspace,
}: PdfReaderProps) {
  const [pages, setPages] = useState<pdfjs.PDFPageProxy[]>([]),
    [error, setError] = useState("");
  const scroll = useRef<HTMLDivElement>(null),
    position = useRef({ page: initialPage, x: 0, y: 0 }),
    views = useRef<View[]>([]);
  const pan = useRef<
    { x: number; y: number; left: number; top: number } | undefined
  >(undefined);
  const space = useRef(false);
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
    const clear = () => {
      space.current = false;
    };
    window.addEventListener("keyup", clear);
    window.addEventListener("blur", clear);
    return () => {
      window.removeEventListener("keyup", clear);
      window.removeEventListener("blur", clear);
    };
  }, []);
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
  let bottom = 40;
  const worldPages = views.current.map((view, index) => {
    const page = {
      page: index + 1,
      x: 40,
      y: bottom,
      width: view.width / zoom,
      height: view.height / zoom,
      locate: (rect: Rect) => {
        const box = ordered(view.convertToViewportRectangle(rect));
        return { x: 40 + box[0] / zoom, y: page.y + box[1] / zoom };
      },
    };
    bottom += page.height + 24;
    return page;
  });
  useLayoutEffect(() => {
    const el = scroll.current,
      p = position.current,
      node = el?.querySelector<HTMLElement>(`[data-page="${p.page}"]`);
    if (el && wheelPosition.current) {
      el.scrollTo(wheelPosition.current);
      wheelPosition.current = undefined;
      worldCamera.current = { left: el.scrollLeft, top: el.scrollTop, zoom };
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
      worldCamera.current = { left: el.scrollLeft, top: el.scrollTop, zoom };
      return;
    }
    if (node && el) {
      el.scrollTop = node.offsetTop + p.y * node.offsetHeight - 20;
      el.scrollLeft = Math.max(
        0,
        node.offsetLeft + p.x * node.offsetWidth - el.clientWidth / 2,
      );
    }
  }, [pages, zoom, rotation]);
  const report = () => {
    const el = scroll.current;
    if (!el) return;
    if (workspace)
      worldCamera.current = {
        left: el.scrollLeft,
        top: el.scrollTop,
        zoom,
      };
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
      className={`pdf-scroll${workspace ? " workspace-scroll" : ""}`}
      tabIndex={-1}
      onKeyDown={(event) => {
        if (
          workspace &&
          event.code === "Space" &&
          !(event.target as HTMLElement).closest(
            "input,textarea,button,select,[contenteditable]",
          )
        ) {
          event.preventDefault();
          space.current = true;
        }
      }}
      onPointerDownCapture={(event) => {
        if (!workspace) return;
        const target = event.target as HTMLElement;
        if (
          event.button === 1 ||
          space.current ||
          (event.button === 0 &&
            (target === scroll.current ||
              target.classList.contains("pdf-world")))
        ) {
          event.preventDefault();
          event.stopPropagation();
          const el = scroll.current!;
          el.focus({ preventScroll: true });
          el.setPointerCapture(event.pointerId);
          pan.current = {
            x: event.clientX,
            y: event.clientY,
            left: el.scrollLeft,
            top: el.scrollTop,
          };
        }
      }}
      onPointerMove={(event) => {
        if (pan.current && scroll.current)
          scroll.current.scrollTo({
            left: pan.current.left + pan.current.x - event.clientX,
            top: pan.current.top + pan.current.y - event.clientY,
          });
      }}
      onPointerUp={() => {
        pan.current = undefined;
      }}
      onPointerCancel={() => {
        pan.current = undefined;
      }}
      onScroll={report}
      onMouseUp={(e) => {
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
                      ...worldPages.map((page) => page.width + 440),
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
