import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
  type CSSProperties,
} from "react";
import { createPortal } from "react-dom";
import type {
  Book,
  ReadingSelection,
  PdfAnchor,
} from "../../../packages/protocol/src";
import type { WorkspaceCard } from "../../../packages/protocol/src/workspace";
import { WORKSPACE_DOCUMENT_X } from "../../../packages/protocol/src/workspace";
import type { BookWorkspace as WorkspaceSnapshot } from "../../../packages/protocol/src/workspace";
import type { InkStroke } from "../../../packages/protocol/src/workspace";
import type { BrushStyle, ToolPreferences } from "../../../packages/protocol/src/reader-tools";
import {
  PdfReader,
  type PdfReaderProps,
  type WorkspacePage,
  type QuestionRegion,
  type RegionAction,
} from "./PdfReader";
import { useWorkspace } from "./WorkspaceState";
import { hitStroke, projectStroke, simplifyInk, splitStroke, type InkPoint, type ProjectedInk } from "./InkGeometry";
import { InkCanvas, type InkCanvasHandle } from "./InkCanvas";
import { dockBesideDocument } from "./WorkspaceLayout";
import { Icon } from "./Icon";
import { base, post } from "./api";
import "./workspace.css";

export interface BookWorkspaceHandle {
  flush(): Promise<boolean>;
  excerpt(selection: ReadingSelection): void;
}
export const BookWorkspace = forwardRef<
  BookWorkspaceHandle,
  PdfReaderProps & {
    book: Book;
    page: number;
    toolPreferences: ToolPreferences;
    beforeExport?: () => Promise<boolean>;
  }
>(function BookWorkspace(props, ref) {
  const state = useWorkspace(props.book.id);
  const [selected, setSelected] = useState<string>();
  const [linkFrom, setLinkFrom] = useState<string>();
  const [focus, setFocus] = useState(false);
  const [showOverview, setShowOverview] = useState(false);
  const [documentWidth, setDocumentWidth] = useState(0);
  const [navigation, setNavigation] = useState<{
    key: number;
    x: number;
    y: number;
    zoom: number;
  }>();
  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState("");
  const [inkError, setInkError] = useState("");
  const inkCanvas = useRef<InkCanvasHandle>(null);
  const projectedInk = useRef<ProjectedInk[]>([]);
  const inkGesture = useRef<
    | { kind: "draw"; brush: "pen" | "highlighter"; style: BrushStyle; points: InkPoint[] }
    | { kind: "erase"; ids: Set<string> }
    | undefined
  >(undefined);
  const [sourceFocus, setSourceFocus] = useState<PdfAnchor[]>();
  const [returnPosition, setReturnPosition] = useState<{
    x: number;
    y: number;
  }>();
  const [gesture, setGesture] = useState<{
    id: string;
    x: number;
    y: number;
    width: number;
    height: number;
  }>();
  const viewport = useRef<HTMLDivElement | null>(null);
  const pages = useRef<WorkspacePage[]>([]);
  const pointer = useRef<
    | {
        id: string;
        mode: "move" | "resize";
        x: number;
        y: number;
        card: WorkspaceCard;
      }
    | undefined
  >(undefined);
  useEffect(() => {
    if (!state.value || !documentWidth) return;
    const cards = state.value.cards.map((card) =>
      dockBesideDocument(card, documentWidth),
    );
    if (cards.some((card, index) => card.x !== state.value!.cards[index].x))
      state.change({ ...state.value, cards }, false);
  }, [documentWidth, state.value]);
  useEffect(() => {
    const shortcut = (event: KeyboardEvent) => {
      if (!event.ctrlKey || event.altKey || event.metaKey || event.isComposing) return;
      if ((event.target as HTMLElement)?.closest("input,textarea,[contenteditable]")) return;
      if (event.key.toLowerCase() === "z") {
        event.preventDefault();
        if (event.shiftKey) state.redo(); else state.undo();
      } else if (event.key.toLowerCase() === "y") {
        event.preventDefault();
        state.redo();
      }
    };
    window.addEventListener("keydown", shortcut);
    return () => window.removeEventListener("keydown", shortcut);
  }, [state]);
  function navigate(x: number, y: number, zoom = props.zoom) {
    setNavigation((old) => ({
      key: (old?.key ?? 0) + 1,
      x: Math.max(0, x),
      y: Math.max(0, y),
      zoom,
    }));
    if (zoom !== props.zoom) props.onZoom?.(zoom);
  }
  function locateDocument() {
    const el = viewport.current;
    if (!el) return;
    const page = pages.current.find((item) => item.page === props.page);
    navigate(
      WORKSPACE_DOCUMENT_X +
        documentWidth / 2 -
        el.clientWidth / props.zoom / 2,
      page?.y ?? 40,
    );
    setFocus(false);
  }
  function overview() {
    setShowOverview(true);
    const el = viewport.current;
    if (!el || !pages.current.length) return;
    const cards = state.value?.cards ?? [];
    const bounds = [...pages.current, ...cards];
    const left = Math.min(...bounds.map((item) => item.x)) - 40;
    const top = Math.min(...bounds.map((item) => item.y)) - 40;
    const right = Math.max(...bounds.map((item) => item.x + item.width)) + 40;
    const bottom = Math.max(...bounds.map((item) => item.y + item.height)) + 40;
    const zoom = Math.max(
      0.4,
      Math.min(
        1,
        el.clientWidth / (right - left),
        (el.clientHeight - 90) / (bottom - top),
      ),
    );
    navigate(
      left - Math.max(0, el.clientWidth / zoom - (right - left)) / 2,
      top,
      zoom,
    );
    setFocus(false);
  }
  async function exportWorkspace() {
    setExporting(true);
    setExportError("");
    try {
      if (props.beforeExport && !(await props.beforeExport()))
        throw new Error("请先保存笔记后再打包");
      if (!(await state.flush())) throw new Error("请先保存工作区后再打包");
      const response = await fetch(
        `${base}/api/books/${props.book.id}/workspace/archive`,
        { credentials: "include" },
      );
      if (!response.ok)
        throw new Error((await response.json()).error ?? "打包失败");
      const url = URL.createObjectURL(await response.blob());
      const link = document.createElement("a");
      link.href = url;
      link.download = `${props.book.title.replace(/[<>:"/\\|?*]/g, "_")}.aireader`;
      link.click();
      setTimeout(() => URL.revokeObjectURL(url), 60000);
    } catch (error) {
      setExportError(String(error));
    } finally {
      setExporting(false);
    }
  }
  function add(selection?: ReadingSelection) {
    if (!state.value) return;
    const page = pages.current.find(
      (item) => item.page === (selection?.page ?? props.page),
    );
    if (!page) return;
    const card: WorkspaceCard = {
      id: crypto.randomUUID(),
      kind: selection ? "excerpt" : "note",
      title: selection
        ? `第 ${props.book.labels[selection.page - 1] ?? selection.page} 页摘录`
        : "新笔记",
      text: selection?.text ?? "",
      comment: "",
      x: WORKSPACE_DOCUMENT_X + documentWidth + 40,
      y: Math.max(page.y, (viewport.current?.scrollTop ?? 0) / props.zoom + 60),
      width: selection ? 280 : 250,
      height: selection ? 240 : 170,
      ...(selection
        ? {
            source: {
              fingerprint: props.book.fingerprint,
              anchors: structuredClone(selection.anchors),
            },
          }
        : {}),
    };
    // Stagger cards near the same reading location instead of hiding them under one another.
    while (
      state.value.cards.some(
        (old) => Math.abs(old.x - card.x) < 20 && Math.abs(old.y - card.y) < 40,
      )
    )
      card.y += 50;
    state.change({ ...state.value, cards: [...state.value.cards, card] });
    setSelected(card.id);
    setFocus(false);
    requestAnimationFrame(() =>
      viewport.current?.scrollTo({
        left: Math.max(
          0,
          (card.x + card.width) * props.zoom -
            viewport.current.clientWidth +
            40,
        ),
      }),
    );
  }
  async function regionAction(region: QuestionRegion, action: RegionAction, includePersonalMarks: boolean) {
    if (action === "question") {
      await props.onRegionAction?.(region, action, includePersonalMarks);
      return;
    }
    if (action === "annotation") {
      const created = await props.onCreate({ kind: "region", color: "yellow", quote: "",
        anchors: [{ page: region.page, rects: [region.rect] }], image: region.image });
      if (created === false) throw new Error("区域批注尚未保存，请重试");
      await props.onRegionAction?.(region, action, includePersonalMarks);
      return;
    }
    if (!(await state.flush())) throw new Error("工作区尚未保存，请重试后创建图片卡片");
    const revision = state.revision();
    if (revision === undefined) throw new Error("工作区尚未加载");
    const page = pages.current.find((item) => item.page === region.page);
    if (!page) throw new Error("找不到摘录的 PDF 页面");
    let y = Math.max(page.y, (viewport.current?.scrollTop ?? 0) / props.zoom + 60);
    const x = WORKSPACE_DOCUMENT_X + documentWidth + 40;
    while (state.value?.cards.some((card) => Math.abs(card.x - x) < 20 && Math.abs(card.y - y) < 40)) y += 50;
    const result = await post<{ workspace: WorkspaceSnapshot; cardId: string }>(
      `books/${props.book.id}/workspace/region-excerpts`, {
        bookId: props.book.id, commandId: region.operationId ?? crypto.randomUUID(), expectedVersion: revision,
        fingerprint: props.book.fingerprint, page: region.page, rect: region.rect,
        image: region.image, includePersonalMarks,
        title: `第 ${props.book.labels[region.page - 1] ?? region.page} 页图片摘录`, x, y,
      });
    state.acceptExternal(result.workspace);
    setSelected(result.cardId);
    await props.onRegionAction?.(region, action, includePersonalMarks);
  }
  useImperativeHandle(ref, () => ({ flush: state.flush, excerpt: add }));
  function update(id: string, change: Partial<WorkspaceCard>) {
    if (state.value)
      state.change({
        ...state.value,
        cards: state.value.cards.map((card) =>
          card.id === id
            ? dockBesideDocument({ ...card, ...change }, documentWidth)
            : card,
        ),
      });
  }
  function select(card: WorkspaceCard) {
    setSelected(card.id);
    setFocus(false);
    if (linkFrom && linkFrom !== card.id && state.value) {
      state.change({
        ...state.value,
        links: [
          ...state.value.links,
          {
            id: crypto.randomUUID(),
            from: linkFrom,
            to: card.id,
            label: "关联",
          },
        ],
      });
      setLinkFrom(undefined);
    }
  }
  function source(card: WorkspaceCard) {
    const anchors: PdfAnchor[] = card.region
      ? [{ page: card.region.page, rects: [card.region.rect] }]
      : card.source?.anchors ?? [];
    if (!anchors.length) return;
    const page = pages.current.find(
        (page) => page.page === anchors[0].page,
      ),
      el = viewport.current;
    if (!page || !el) return;
    setReturnPosition({
      x: el.scrollLeft / props.zoom,
      y: el.scrollTop / props.zoom,
    });
    const location = page.locate(anchors[0].rects[0]);
    setSourceFocus(anchors);
    el.scrollTo({
      left: Math.max(0, page.x * props.zoom - 30),
      top: location.y * props.zoom - 100,
    });
  }
  function eraseAt(point: InkPoint) {
    const gesture = inkGesture.current;
    if (gesture?.kind !== "erase") return;
    const radius = 9 / props.zoom;
    for (const stroke of projectedInk.current)
      if (!gesture.ids.has(stroke.id) && hitStroke(stroke, point, radius))
        gesture.ids.add(stroke.id);
    inkCanvas.current?.preview([], undefined, gesture.ids);
  }
  function startInk(point: InkPoint) {
    if (!state.value) return;
    setInkError("");
    if (props.mode === "eraser") {
      inkGesture.current = { kind: "erase", ids: new Set() };
      eraseAt(point);
    } else if (props.mode === "pen" || props.mode === "highlighter") {
      const style = { ...props.toolPreferences[props.mode] };
      inkGesture.current = { kind: "draw", brush: props.mode, style, points: [point] };
      inkCanvas.current?.preview([point], style, new Set());
    }
  }
  function moveInk(points: InkPoint[]) {
    const gesture = inkGesture.current;
    if (!gesture) return;
    if (gesture.kind === "erase") points.forEach(eraseAt);
    else {
      for (const point of points)
        if (Math.hypot(point[0] - gesture.points.at(-1)![0], point[1] - gesture.points.at(-1)![1]) > .15)
          gesture.points.push(point);
      inkCanvas.current?.preview(gesture.points, gesture.style, new Set());
    }
  }
  function finishInk(point: InkPoint) {
    const gesture = inkGesture.current;
    if (gesture?.kind === "erase") eraseAt(point);
    inkGesture.current = undefined;
    inkCanvas.current?.clear();
    if (!gesture || !state.value) return;
    if (gesture.kind === "erase") {
      if (gesture.ids.size)
        state.change({ ...state.value, objects: state.value.objects.filter((object) => !gesture.ids.has(object.id)) });
      return;
    }
    if (Math.hypot(point[0] - gesture.points.at(-1)![0], point[1] - gesture.points.at(-1)![1]) > .15)
      gesture.points.push(point);
    const segments = splitStroke(gesture.points, pages.current, props.book.fingerprint)
      .map((segment) => ({ ...segment, points: simplifyInk(segment.points) }));
    if (!segments.length || segments.length > 128 ||
        segments.reduce((total, segment) => total + segment.points.length, 0) > 10000) {
      setInkError("这一笔过长，未保存；请分成较短的几笔绘制。");
      return;
    }
    const stroke: InkStroke = { id: crypto.randomUUID(), kind: "ink", brush: gesture.brush,
      ...gesture.style, segments };
    state.change({ ...state.value, objects: [...state.value.objects, stroke] });
  }
  function cancelInk() {
    inkGesture.current = undefined;
    inkCanvas.current?.clear();
  }
  useEffect(() => { if (inkGesture.current) cancelInk(); }, [props.mode, props.rotation, props.zoom]);
  function overlay(layout: WorkspacePage[], el: HTMLDivElement | null) {
    pages.current = layout;
    viewport.current = el;
    if (!state.value) return null;
    const strokes = state.value.objects.filter((object): object is InkStroke => object.kind === "ink")
      .map((stroke) => projectStroke(stroke, layout));
    projectedInk.current = strokes;
    const cards = state.value.cards.map((card) =>
      gesture?.id === card.id ? { ...card, ...gesture } : card,
    );
    return <>
      <div
        className={`workspace-objects${focus ? " focus-document" : ""}`}
        style={
          {
            transform: `scale(${props.zoom})`,
            "--workspace-zoom": props.zoom,
          } as CSSProperties
        }
      >
        <svg
          className="workspace-links"
          aria-label="卡片关系"
          width={Math.max(
            2000,
            ...cards.map((card) => card.x + card.width + 100),
          )}
          height={Math.max(
            1000,
            ...cards.map((card) => card.y + card.height + 100),
          )}
        >
          {state.value.links.map((link) => {
            const from = cards.find((card) => card.id === link.from),
              to = cards.find((card) => card.id === link.to);
            if (!from || !to) return null;
            const forward = from.x < to.x;
            const vertical =
              Math.abs(from.x + from.width / 2 - to.x - to.width / 2) <
                (from.width + to.width) / 2 &&
              Math.abs(from.y - to.y) > (from.height + to.height) / 2;
            const down = from.y < to.y;
            const x1 = vertical
                ? from.x + from.width / 2
                : forward
                  ? from.x + from.width
                  : from.x,
              y1 = vertical
                ? from.y + (down ? from.height : 0)
                : from.y + from.height / 2,
              x2 = vertical
                ? to.x + to.width / 2
                : forward
                  ? to.x
                  : to.x + to.width,
              y2 = vertical
                ? to.y + (down ? 0 : to.height)
                : to.y + to.height / 2;
            const path = vertical
              ? `M ${x1} ${y1} C ${x1} ${y1 + (down ? 50 : -50)}, ${x2} ${y2 + (down ? -50 : 50)}, ${x2} ${y2}`
              : `M ${x1} ${y1} C ${x1 + (forward ? 60 : -60)} ${y1}, ${x2 + (forward ? -60 : 60)} ${y2}, ${x2} ${y2}`;
            return (
              <g key={link.id}>
                <path d={path} />
                <foreignObject
                  x={(x1 + x2) / 2 - 80}
                  y={(y1 + y2) / 2 - 16}
                  width={160}
                  height={40}
                >
                  <button
                    className="workspace-link"
                    onClick={() => {
                      setSelected(link.from);
                      setLinkFrom(undefined);
                    }}
                    title={link.label}
                  >
                    {link.label}
                  </button>
                </foreignObject>
              </g>
            );
          })}
        </svg>
        {cards.map((card) => (
          <article
            key={card.id}
            className={`workspace-card ${card.kind}${selected === card.id ? " selected" : ""}`}
            data-card-id={card.id}
            style={{
              left: card.x,
              top: card.y,
              width: card.width,
              height: card.height,
            }}
            onPointerDown={(event) => {
              if (event.button === 0) select(card);
            }}
          >
            <header
              tabIndex={0}
              aria-label="移动卡片（方向键）"
              onKeyDown={(event) => {
                if (event.target !== event.currentTarget) return;
                const step = event.shiftKey ? 40 : 10;
                if (
                  ["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(
                    event.key,
                  )
                ) {
                  event.preventDefault();
                  update(card.id, {
                    x: Math.max(
                      0,
                      Math.min(
                        1000000,
                        card.x +
                          (event.key === "ArrowRight"
                            ? step
                            : event.key === "ArrowLeft"
                              ? -step
                              : 0),
                      ),
                    ),
                    y: Math.max(
                      0,
                      Math.min(
                        1000000,
                        card.y +
                          (event.key === "ArrowDown"
                            ? step
                            : event.key === "ArrowUp"
                              ? -step
                              : 0),
                      ),
                    ),
                  });
                }
              }}
              onPointerDown={(event) => {
                if (event.button !== 0) return;
                if ((event.target as HTMLElement).closest("button,input"))
                  return;
                event.preventDefault();
                event.currentTarget.setPointerCapture(event.pointerId);
                pointer.current = {
                  id: card.id,
                  mode: "move",
                  x: event.clientX,
                  y: event.clientY,
                  card,
                };
              }}
              onPointerMove={move}
              onPointerUp={finish}
              onPointerCancel={cancel}
            >
              <span>
                <Icon name={card.kind === "note" ? "note" : "book"} />
                {card.kind === "excerpt" ? "原文摘录" : card.kind === "region" ? "图片摘录" : "笔记"}
                {card.region?.includePersonalMarks && <small className="workspace-region-marked">含个人标注</small>}
              </span>
              <span className="workspace-grip" aria-hidden="true">
                ⠿
              </span>
            </header>
            <div className="workspace-card-body">
              <input
                aria-label="卡片标题"
                value={card.title}
                maxLength={200}
                onChange={(e) => update(card.id, { title: e.target.value })}
              />
              {card.kind === "region" && card.region ? (
                <img className="workspace-region-image"
                  src={`${base}/api/books/${props.book.id}/workspace-assets/${card.region.assetId}`}
                  alt={`第 ${props.book.labels[card.region.page - 1] ?? card.region.page} 页图片摘录`} />
              ) : card.kind === "excerpt" ? (
                <blockquote>{card.text}</blockquote>
              ) : (
                <textarea
                  aria-label="个人笔记内容"
                  placeholder="写下你的理解…"
                  value={card.text}
                  maxLength={20000}
                  onChange={(e) => update(card.id, { text: e.target.value })}
                />
              )}
              {(card.kind === "excerpt" || card.kind === "region") && (
                <textarea
                  aria-label="摘录个人评论"
                  className="workspace-comment"
                  placeholder="添加你的理解…"
                  value={card.comment}
                  maxLength={10000}
                  onChange={(e) => update(card.id, { comment: e.target.value })}
                />
              )}
            </div>
            <footer>
              {card.source || card.region ? (
                <button
                  className="workspace-source"
                  onClick={() => source(card)}
                  title="回到原文"
                >
                  <Icon name="outward" />第{" "}
                  {props.book.labels[(card.region?.page ?? card.source!.anchors[0].page) - 1] ??
                    (card.region?.page ?? card.source!.anchors[0].page)}{" "}
                  页
                </button>
              ) : (
                <span className="workspace-personal">个人理解</span>
              )}
              <div className="workspace-card-actions">
                <button
                  aria-label="连接卡片"
                  title="连接卡片"
                  aria-pressed={linkFrom === card.id}
                  onClick={() =>
                    setLinkFrom(linkFrom === card.id ? undefined : card.id)
                  }
                >
                  <Icon name="link" />
                </button>
                <button
                  aria-label="删除卡片"
                  title="删除卡片"
                  onClick={() => {
                    state.change({
                      ...state.value!,
                      cards: state.value!.cards.filter(
                        (item) => item.id !== card.id,
                      ),
                      links: state.value!.links.filter(
                        (link) => link.from !== card.id && link.to !== card.id,
                      ),
                    });
                    if (linkFrom === card.id) setLinkFrom(undefined);
                  }}
                >
                  <Icon name="trash" />
                </button>
              </div>
            </footer>
            <button
              className="workspace-resize"
              aria-label="调整卡片大小"
              onPointerDown={(event) => {
                if (event.button !== 0) return;
                event.preventDefault();
                event.currentTarget.setPointerCapture(event.pointerId);
                pointer.current = {
                  id: card.id,
                  mode: "resize",
                  x: event.clientX,
                  y: event.clientY,
                  card,
                };
              }}
              onPointerMove={move}
              onPointerUp={finish}
              onPointerCancel={cancel}
              onKeyDown={(e) => {
                const delta = e.shiftKey ? 40 : 10;
                if (
                  ["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(
                    e.key,
                  )
                ) {
                  e.preventDefault();
                  update(card.id, {
                    width: Math.max(
                      220,
                      Math.min(
                        1200,
                        card.width +
                          (e.key === "ArrowRight"
                            ? delta
                            : e.key === "ArrowLeft"
                              ? -delta
                              : 0),
                      ),
                    ),
                    height: Math.max(
                      160,
                      Math.min(
                        1600,
                        card.height +
                          (e.key === "ArrowDown"
                            ? delta
                            : e.key === "ArrowUp"
                              ? -delta
                              : 0),
                      ),
                    ),
                  });
                }
              }}
            >
              <span aria-hidden="true" />
            </button>
          </article>
        ))}
      </div>
      {el?.parentElement && createPortal(<InkCanvas ref={inkCanvas} strokes={strokes}
        viewport={el} zoom={props.zoom} />, el.parentElement)}
    </>;
  }
  function move(e: React.PointerEvent) {
    const p = pointer.current;
    if (!p) return;
    const dx = (e.clientX - p.x) / props.zoom,
      dy = (e.clientY - p.y) / props.zoom;
    setGesture(
      dockBesideDocument(
        {
          id: p.id,
          x: Math.max(
            0,
            Math.min(1000000, p.card.x + (p.mode === "move" ? dx : 0)),
          ),
          y: Math.max(
            0,
            Math.min(1000000, p.card.y + (p.mode === "move" ? dy : 0)),
          ),
          width: Math.max(
            220,
            Math.min(1200, p.card.width + (p.mode === "resize" ? dx : 0)),
          ),
          height: Math.max(
            160,
            Math.min(1600, p.card.height + (p.mode === "resize" ? dy : 0)),
          ),
        },
        documentWidth,
      ),
    );
  }
  function finish() {
    if (gesture && pointer.current) {
      const { id, ...geometry } = gesture;
      update(id, geometry);
    }
    cancel();
  }
  function cancel() {
    pointer.current = undefined;
    setGesture(undefined);
  }
  return (
    <>
      <PdfReader
        {...props}
        onRegionAction={regionAction}
        workspace={{
          ready: !!state.value,
          camera: state.value?.camera,
          onDocumentWidth: setDocumentWidth,
          navigation,
          onCamera: (camera) => {
            if (
              state.value &&
              (state.value.camera?.x !== camera.x ||
                state.value.camera?.y !== camera.y ||
                state.value.camera?.zoom !== camera.zoom)
            )
              state.change({ ...state.value, camera }, false);
          },
          width: Math.max(
            WORKSPACE_DOCUMENT_X * 2 + documentWidth,
            ...(state.value?.cards.map((card) => card.x + card.width + 100) ??
              []),
          ),
          height: Math.max(
            0,
            ...(state.value?.cards.map((card) => card.y + card.height + 100) ??
              []),
          ),
          render: overlay,
          sourceFocus,
          onInkStart: startInk,
          onInkMove: moveInk,
          onInkEnd: finishInk,
          onInkCancel: cancelInk,
        }}
      />
      <div className="workspace-toolbar" role="toolbar" aria-label="工作区工具">
        <button
          aria-label="＋ 笔记卡片"
          disabled={!state.value}
          onClick={() => add()}
        >
          <Icon name="plus" /> 笔记
        </button>
        <button
          aria-label="撤销工作区修改"
          disabled={!state.canUndo}
          onClick={state.undo}
        >
          <Icon name="undo" />
        </button>
        <button
          aria-label="重做工作区修改"
          disabled={!state.canRedo}
          onClick={state.redo}
        >
          <Icon name="redo" />
        </button>
        <i className="workspace-toolbar-divider" />
        <button onClick={locateDocument} title="回到当前阅读页">
          <Icon name="book" />
          定位正文
        </button>
        <button onClick={overview} title="缩小并查看画布内容">
          <Icon name="fit" />
          查看全部
        </button>
        <button
          aria-label="聚焦正文"
          title="淡化笔记，聚焦正文"
          aria-pressed={focus}
          onClick={() => setFocus(!focus)}
        >
          <Icon name="focus" />
        </button>
        {returnPosition && (
          <button
            onClick={() => {
              viewport.current?.scrollTo({
                left: returnPosition.x * props.zoom,
                top: returnPosition.y * props.zoom,
              });
              setReturnPosition(undefined);
              setSourceFocus(undefined);
            }}
          >
            返回卡片位置
          </button>
        )}
        <i className="workspace-toolbar-divider" />
        <button
          aria-label="打包工作区"
          title="打包 PDF、笔记、连线及附件"
          disabled={exporting || !state.value}
          onClick={() => void exportWorkspace()}
        >
          <Icon name="download" />
        </button>
        <span role="status" aria-label="工作区保存状态">
          {state.status}
        </span>
      </div>
      {showOverview && (
        <aside className="workspace-overview" aria-label="工作区总览">
          <header>
            <strong>工作区总览</strong>
            <button
              aria-label="关闭总览"
              onClick={() => setShowOverview(false)}
            >
              <Icon name="close" />
            </button>
          </header>
          <button
            onClick={() => {
              locateDocument();
              setShowOverview(false);
            }}
          >
            <Icon name="book" />
            <span>
              正文<small>{props.book.pages} 页</small>
            </span>
          </button>
          {state.value?.cards.map((card) => (
            <button
              key={card.id}
              onClick={() => {
                navigate(card.x - 40, card.y - 40, 1);
                setSelected(card.id);
                setShowOverview(false);
              }}
            >
              <Icon name={card.kind === "note" ? "note" : "book"} />
              <span>
                {card.title || "未命名笔记"}
                <small>
                  {card.source || card.region
                    ? `第 ${props.book.labels[(card.region?.page ?? card.source!.anchors[0].page) - 1] ?? (card.region?.page ?? card.source!.anchors[0].page)} 页摘录`
                    : "个人笔记"}
                </small>
              </span>
            </button>
          ))}
          {!state.value?.cards.length && <p>选中原文创建摘录，或添加笔记。</p>}
        </aside>
      )}
      {exportError && (
        <div className="workspace-error" role="alert">
          {exportError}
          <button onClick={() => setExportError("")} aria-label="关闭打包错误">
            <Icon name="close" />
          </button>
        </div>
      )}
      {inkError && <div className="workspace-error" role="alert">{inkError}
        <button onClick={() => setInkError("")} aria-label="关闭笔迹错误"><Icon name="close" /></button>
      </div>}
      {linkFrom && (
        <div className="workspace-notice">
          点击另一张卡片建立连接{" "}
          <button onClick={() => setLinkFrom(undefined)}>取消</button>
        </div>
      )}
      {selected &&
        state.value?.links.some(
          (link) => link.from === selected || link.to === selected,
        ) && (
          <aside className="workspace-relations" aria-label="已选卡片的关系">
            {state.value.links
              .filter((link) => link.from === selected || link.to === selected)
              .map((link) => (
                <label key={link.id}>
                  <input
                    aria-label="关系名称"
                    value={link.label}
                    maxLength={200}
                    onChange={(e) =>
                      state.change({
                        ...state.value!,
                        links: state.value!.links.map((item) =>
                          item.id === link.id
                            ? { ...item, label: e.target.value }
                            : item,
                        ),
                      })
                    }
                  />
                  <button
                    aria-label="删除关系"
                    onClick={() =>
                      state.change({
                        ...state.value!,
                        links: state.value!.links.filter(
                          (item) => item.id !== link.id,
                        ),
                      })
                    }
                  >
                    ×
                  </button>
                </label>
              ))}
          </aside>
        )}
      {state.error && (
        <div className="workspace-error" role="alert">
          {state.error}
          {state.value ? (
            <>
              <button onClick={() => void state.flush()}>重试保存</button>
              <button
                onClick={() => {
                  const url = URL.createObjectURL(
                    new Blob([JSON.stringify(state.value, null, 2)], {
                      type: "application/json",
                    }),
                  );
                  const link = document.createElement("a");
                  link.href = url;
                  link.download = `AIReader-workspace-${props.book.id}-draft.json`;
                  link.click();
                  setTimeout(() => URL.revokeObjectURL(url), 1000);
                }}
              >
                下载草稿备份
              </button>
              <button
                onClick={() => {
                  if (
                    confirm(
                      "重新加载会替换当前未保存草稿。请先下载草稿备份。确定重新加载？",
                    )
                  )
                    void state.reload();
                }}
              >
                重新加载已保存版本
              </button>
            </>
          ) : (
            <button onClick={() => void state.reload()}>重试加载</button>
          )}
        </div>
      )}
    </>
  );
});
