import { useEffect, useLayoutEffect, useRef, useState } from "react";
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
pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;
export type AnnotationMode = "select" | "sticky" | "region";
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
}: {
  proxy: pdfjs.PDFPageProxy;
  view: View;
  annotations: Annotation[];
  highlight?: SourceAnchor;
  mode: AnnotationMode;
  onCreate: (input: z.infer<typeof AnnotationInputSchema>) => void;
  onAnnotation: (id: string) => void;
}) {
  const outer = useRef<HTMLDivElement>(null),
    canvas = useRef<HTMLCanvasElement>(null),
    text = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(false),
    [ready, setReady] = useState(false),
    [drag, setDrag] = useState<Rect>();
  const start = useRef<[number, number] | undefined>(undefined);
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
    setReady(false);
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
      setReady(true);
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
      style={
        {
          width: view.width,
          height: view.height,
          "--total-scale-factor": view.scale * proxy.userUnit,
        } as React.CSSProperties
      }
    >
      <canvas ref={canvas} style={{ width: "100%", height: "100%" }} />
      <div ref={text} className="textLayer" />
      <div className="annotation-layer">
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
          onPointerDown={(e) => {
            if (!ready) return;
            e.preventDefault();
            start.current = point(e);
            e.currentTarget.setPointerCapture(e.pointerId);
          }}
          onPointerMove={(e) => {
            if (start.current) setDrag([...start.current, ...point(e)]);
          }}
          onPointerCancel={() => {
            start.current = undefined;
            setDrag(undefined);
          }}
          onPointerUp={(e) => {
            if (!start.current) return;
            const p = point(e),
              r = ordered([...start.current, ...p]);
            start.current = undefined;
            setDrag(undefined);
            if (mode === "sticky") {
              const size = 22 * view.scale;
              r[2] = Math.min(view.width, r[0] + size);
              r[3] = Math.min(view.height, r[1] + size);
            }
            if (r[2] - r[0] < 3 || r[3] - r[1] < 3) return;
            let image: string | undefined;
            if (mode === "region") {
              const c = canvas.current!,
                ratio = c.width / view.width,
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
                  r[0] * ratio,
                  r[1] * ratio,
                  w * ratio,
                  h * ratio,
                  0,
                  0,
                  crop.width,
                  crop.height,
                );
              image = crop.toDataURL("image/png");
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
export function PdfReader({
  id,
  initialPage,
  zoom,
  rotation = 0,
  onPage,
  onSelection,
  highlight,
  annotations = [],
  mode = "select",
  onCreate,
  onAnnotation,
}: {
  id: string;
  initialPage: number;
  zoom: number;
  rotation?: number;
  onPage: (page: number) => void;
  onSelection: (selection: ReadingSelection) => void;
  highlight?: SourceAnchor;
  annotations?: Annotation[];
  mode?: AnnotationMode;
  onCreate: (input: z.infer<typeof AnnotationInputSchema>) => void;
  onAnnotation: (id: string) => void;
}) {
  const [pages, setPages] = useState<pdfjs.PDFPageProxy[]>([]),
    [error, setError] = useState("");
  const scroll = useRef<HTMLDivElement>(null),
    position = useRef({ page: initialPage, x: 0, y: 0 }),
    views = useRef<View[]>([]);
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
  useLayoutEffect(() => {
    const el = scroll.current,
      p = position.current,
      node = el?.querySelector<HTMLElement>(`[data-page="${p.page}"]`);
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
      className="pdf-scroll"
      onScroll={report}
      onMouseUp={(e) => {
        if (mode !== "select") return;
        const s = getSelection();
        if (!s?.rangeCount || !s.toString().trim()) return;
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
      }}
    >
      {error ? (
        <p className="error">PDF 无法打开：{error}</p>
      ) : pages.length ? (
        pages.map((p, i) => (
          <Page
            key={p.pageNumber}
            proxy={p}
            view={views.current[i]}
            annotations={annotations}
            highlight={highlight}
            mode={mode}
            onCreate={onCreate}
            onAnnotation={onAnnotation}
          />
        ))
      ) : (
        <p className="loading">正在打开 PDF…</p>
      )}
    </div>
  );
}
