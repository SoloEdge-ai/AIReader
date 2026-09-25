import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
  type CSSProperties,
} from "react";
import { createPortal } from "react-dom";
import type { WorkspacePage } from "../../../packages/workspace-engine/src/surfaces";
import type {
  Book,
  Annotation,
  QuestionMaterialInput,
  ReadingSelection,
  PdfAnchor,
  Note,
} from "../../../packages/protocol/src";
import type { WorkspaceCard, WorkspaceObject } from "../../../packages/protocol/src/workspace";
import { WORKSPACE_DOCUMENT_X } from "../../../packages/protocol/src/workspace";
import type { BookWorkspace as WorkspaceSnapshot } from "../../../packages/protocol/src/workspace";
import type { InkStroke } from "../../../packages/protocol/src/workspace";
import type { BrushStyle, ToolPreferences } from "../../../packages/protocol/src/reader-tools";
import {
  PdfReader,
  type PdfReaderProps,
  type QuestionRegion,
  type RegionAction,
} from "./PdfReader";
import { useWorkspace } from "./WorkspaceState";
import { hitStroke, projectStroke, simplifyInk, splitStroke, type InkPoint, type ProjectedInk } from "../../../packages/workspace-engine/src/ink";
import { InkCanvas, type InkCanvasHandle } from "./InkCanvas";
import { WorkspaceObjectView } from "./WorkspaceObjectView";
import { captureMaterialPreviews } from "./WorkspaceMaterialPreview";
import { lassoHitsPath, lassoHitsRect, newShape, objectRect, resizeObject,
  translateObject, worldToSurface } from "../../../packages/workspace-engine/src/objects";
import { dockBesideDocument } from "./WorkspaceLayout";
import { locateWorkspaceItem } from "../../../packages/workspace-engine/src/catalog";
import { Icon } from "./ui/Icon";
import { Popover } from "./ui/Popover";
import { base, post } from "./api";
import "./workspace.css";
import type { BookNotes } from "./features/notes/useBookNotes";
import { NoteCardContent } from "./features/notes/NoteCardContent";

export interface BookWorkspaceHandle {
  flush(): Promise<boolean>;
  excerpt(selection: ReadingSelection): void;
  escape(): void;
  addToQuestion(ids: string[]): Promise<boolean>;
  locate(anchors: PdfAnchor[]): void;
  placeNote(note: Note): Promise<void>;
  locateItem(id: string): void;
}
export const BookWorkspace = forwardRef<
  BookWorkspaceHandle,
  PdfReaderProps & {
    book: Book;
    page: number;
    toolPreferences: ToolPreferences;
    toolbarHost?: HTMLElement | null;
    workspaceEvent?: number;
    onAnnotationColor?: (annotation: Annotation, color: Annotation["color"]) => Promise<void>;
    onAnnotationDelete?: (annotation: Annotation) => Promise<void>;
    onAnnotationRestore?: (annotation: Annotation) => Promise<void>;
    onQuestionMaterials?: (selection: Pick<QuestionMaterialInput,
      "workspaceRevision" | "targets" | "previews">) => Promise<void>;
    beforeExport?: () => Promise<boolean>;
    notes: BookNotes;
    onExpandNote: (note: Note) => void;
    onCatalogChange?: (bookId: string, catalog: Pick<WorkspaceSnapshot, "cards" | "objects" | "links">) => void;
  }
>(function BookWorkspace(props, ref) {
  const state = useWorkspace(props.book.id, props.annotations?.map((annotation) => annotation.id));
  const onCatalogChange = useRef(props.onCatalogChange);
  onCatalogChange.current = props.onCatalogChange;
  useEffect(() => {
    onCatalogChange.current?.(props.book.id, {
      cards: state.value?.cards ?? [], objects: state.value?.objects ?? [], links: state.value?.links ?? [],
    });
  }, [props.book.id, state.value?.cards, state.value?.objects, state.value?.links]);
  const mounted = useRef(true), placing = useRef(false);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const lastWorkspaceEvent = useRef(props.workspaceEvent ?? 0);
  useEffect(() => {
    if (lastWorkspaceEvent.current !== (props.workspaceEvent ?? 0)) {
      lastWorkspaceEvent.current = props.workspaceEvent ?? 0;
      void state.reload(true);
    }
  }, [props.workspaceEvent]);
  const [selected, setSelected] = useState<string>();
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [selectedLink, setSelectedLink] = useState<string>();
  const [editingText, setEditingText] = useState<string>();
  const [canvasGesture, setCanvasGesture] = useState<
    | { kind: "shape"; start: InkPoint; current: InkPoint }
    | { kind: "lasso"; points: InkPoint[] }
    | { kind: "move"; start: InkPoint; current: InkPoint; ids: string[] }
    | { kind: "place"; start: InkPoint }
  >();
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
  const [materialBusy, setMaterialBusy] = useState(false);
  const inkCanvas = useRef<InkCanvasHandle>(null);
  const projectedInk = useRef<ProjectedInk[]>([]);
  const projectedCache = useRef<{
    objects: WorkspaceSnapshot["objects"];
    pages: number;
    zoom: number;
    rotation: number | undefined;
    strokes: ProjectedInk[];
  }>(undefined);
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
    if (!selection) { void placeNote().catch((error) => setInkError(String(error))); return; }
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
  async function placeNote(existing?: Note, point?: InkPoint) {
    if (!state.value) throw new Error("工作区尚未加载，请稍后重试");
    if (placing.current) throw new Error("正在放置笔记，请稍候");
    if (existing && existing.bookId !== props.book.id) throw new Error("笔记不属于当前书籍");
    placing.current = true;
    try {
      if (!(await props.notes.flush()) || !(await state.flush())) throw new Error("请先保存草稿后再放置笔记");
      const original = existing && state.value?.cards.find((card) => card.noteId === existing.id);
      if (original) { navigate(original.x - 40, original.y - 40, 1); selectTarget(original.id); return; }
      const note = existing ?? await props.notes.create();
      if (!note || !mounted.current) return;
      const card: WorkspaceCard = dockBesideDocument({ id: crypto.randomUUID(), kind: "note", noteId: note.id,
        title: "", text: "", comment: "", x: point ? Math.max(0, point[0] + 20) : WORKSPACE_DOCUMENT_X + documentWidth + 40,
        y: point ? Math.max(0, point[1]) : Math.max(40, (viewport.current?.scrollTop ?? 0) / props.zoom + 60),
        width: 340, height: 300 }, documentWidth);
      state.change((current) => {
        while (current.cards.some((old) => Math.abs(old.x - card.x) < 20 && Math.abs(old.y - card.y) < 40)) card.y += 50;
        return { ...current, cards: [...current.cards, card] };
      });
      setSelectedIds([card.id]); setSelected(card.id);
      navigate(card.x - 40, card.y - 40, 1);
      if (!(await state.flush())) throw new Error("卡片放置未保存；笔记已保留在列表，画板草稿可重试");
    } finally { placing.current = false; }
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
  useImperativeHandle(ref, () => ({ flush: async () => {
    const [notesSaved, workspaceSaved] = await Promise.all([props.notes.flush(), state.flush()]);
    return notesSaved && workspaceSaved;
  }, excerpt: add,
    placeNote,
    addToQuestion: addSelectedToQuestion,
    locate: locateAnchors,
    locateItem: (id) => {
      const card = state.value?.cards.find((entry) => entry.id === id);
      if (card) {
        navigate(card.x - 40, card.y - 40, 1);
        setSelected(card.id);
        setSelectedIds([card.id]);
        setSelectedLink(undefined);
      } else {
        const object = state.value?.objects.find((entry) => entry.id === id);
        const link = state.value?.links.find((entry) => entry.id === id);
        const rect = state.value && locateWorkspaceItem(id, state.value, pages.current, props.annotations ?? []);
        if (rect) navigate(rect.x - 40, rect.y - 40, 1);
        setSelected(undefined);
        setSelectedIds(object ? [object.id] : []);
        setSelectedLink(link?.id);
      }
      setFocus(false);
    },
    escape: () => { cancelInk(); setCanvasGesture(undefined); setSelectedIds([]); setSelected(undefined);
      setSelectedLink(undefined); setLinkFrom(undefined); setEditingText(undefined); },
  }));
  function update(id: string, change: Partial<WorkspaceCard>) {
    if (state.value)
      state.change((current) => ({
        ...current,
        cards: current.cards.map((card) =>
          card.id === id
            ? dockBesideDocument({ ...card, ...change }, documentWidth)
            : card,
        ),
      }));
  }
  async function promoteCard(card: WorkspaceCard) {
    if (!(await state.flush())) throw new Error("卡片草稿尚未保存，请重试后编辑笔记");
    const note = await props.notes.promoteCard(card.id);
    if (!note) throw new Error("笔记草稿尚未保存，请重试");
    await state.reload(true);
    props.onExpandNote(note);
  }
  function selectTarget(id: string, shift = false) {
    const next = shift ? (selectedIds.includes(id) ? selectedIds.filter((value) => value !== id) : [...selectedIds, id]) :
      selectedIds.includes(id) && selectedIds.length > 1 ? selectedIds : [id];
    setSelectedIds(next);
    setSelectedLink(undefined);
    setSelected(state.value?.cards.some((card) => card.id === id) ? id : undefined);
    setFocus(false);
    if (linkFrom && linkFrom !== id && state.value) {
      state.change((current) => ({ ...current,
        links: [...current.links, { id: crypto.randomUUID(), from: linkFrom, to: id, label: "", directed: false }],
      }));
      setLinkFrom(undefined);
    } else if (props.mode === "link") {
      setLinkFrom(linkFrom === id ? undefined : id);
    }
  }
  function select(card: WorkspaceCard, shift = false) { selectTarget(card.id, shift); }
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
        state.change((current) => ({ ...current, objects: current.objects.filter((object) => !gesture.ids.has(object.id)) }));
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
    state.change((current) => ({ ...current, objects: [...current.objects, stroke] }));
  }
  function cancelInk() {
    inkGesture.current = undefined;
    inkCanvas.current?.clear();
  }
  useEffect(() => { if (inkGesture.current) cancelInk(); }, [props.mode, props.rotation, props.zoom]);
  function findTarget(point: InkPoint, targetObjectId?: string) {
    if (targetObjectId && state.value?.objects.some((object) => object.id === targetObjectId))
      return targetObjectId;
    const radius = 7 / props.zoom;
    for (const ink of [...projectedInk.current].reverse())
      if (hitStroke(ink, point, radius)) return ink.id;
    return undefined;
  }
  function sourceAnnotation(annotation: Annotation) {
    locateAnchors(annotation.anchors);
  }
  function locateAnchors(anchors: PdfAnchor[]) {
    const anchor = anchors[0];
    if (!anchor) return;
    const page = pages.current.find((item) => item.page === anchor.page);
    const el = viewport.current;
    if (!page || !el) return;
    setReturnPosition({ x: el.scrollLeft / props.zoom, y: el.scrollTop / props.zoom });
    const location = page.locate(anchor.rects[0]);
    setSourceFocus(anchors);
    el.scrollTo({ left: Math.max(0, page.x * props.zoom - 30),
      top: Math.max(0, location.y * props.zoom - 100) });
  }
  async function addSelectedToQuestion(ids: string[] = selectedLink ? [selectedLink] : selectedIds) {
    if (!ids.length || !props.onQuestionMaterials || materialBusy) return false;
    setMaterialBusy(true); setInkError("");
    try {
      if (!(await props.notes.flush())) throw new Error("笔记尚未保存，请重试加入材料");
      if (!(await state.flush())) throw new Error("工作区尚未保存，请重试加入材料");
      const snapshot = state.value;
      const revision = state.revision();
      if (!snapshot || revision === undefined) throw new Error("工作区尚未加载");
      const targets = ids.map((id) => {
        const card = snapshot.cards.find((card) => card.id === id);
        if (card) return { kind: "card" as const, id, revision: card.noteId
          ? props.notes.getSnapshot().notes.find((note) => note.id === card.noteId)?.revision : undefined };
        if (snapshot.objects.some((object) => object.id === id)) return { kind: "object" as const, id };
        if (snapshot.links.some((link) => link.id === id)) return { kind: "relation" as const, id };
        const annotation = props.annotations?.find((item) => item.id === id);
        if (annotation) return { kind: "annotation" as const, id, revision: annotation.revision };
        throw new Error("所选对象已失效，请重新选择");
      });
      const previews = captureMaterialPreviews(ids, snapshot, props.annotations ?? [], pages.current);
      await props.onQuestionMaterials({ workspaceRevision: revision, targets, previews });
      return true;
    } catch (cause) {
      setInkError(`加入提问失败：${String(cause)}`);
      return false;
    } finally { setMaterialBusy(false); }
  }
  function annotationRects(annotation: Annotation, layout: WorkspacePage[]) {
    return annotation.anchors.flatMap((anchor) => {
      const page = layout.find((item) => item.page === anchor.page);
      if (!page) return [];
      return anchor.rects.map((rect) => {
        const corners: InkPoint[] = [[rect[0], rect[1]], [rect[2], rect[1]],
          [rect[0], rect[3]], [rect[2], rect[3]]];
        const world = corners.map((point) => page.toWorld(point));
        const x = Math.min(...world.map((point) => point[0]));
        const y = Math.min(...world.map((point) => point[1]));
        return { x, y, width: Math.max(...world.map((point) => point[0])) - x,
          height: Math.max(...world.map((point) => point[1])) - y };
      });
    });
  }
  function startCanvas(point: InkPoint, shift: boolean, targetObjectId?: string) {
    if (!state.value) return false;
    const mode = props.mode;
    if (mode === "pointer" || mode === "link") {
      const target = findTarget(point, targetObjectId);
      if (!target) {
        if (mode === "pointer") { setSelectedIds([]); setSelected(undefined); setSelectedLink(undefined); }
        if (mode === "link") setLinkFrom(undefined);
        return mode === "link";
      }
      const ids = shift ? (selectedIds.includes(target) ? selectedIds.filter((id) => id !== target) : [...selectedIds, target]) :
        selectedIds.includes(target) && selectedIds.length > 1 ? selectedIds : [target];
      selectTarget(target, shift);
      if (mode === "pointer" && ids.includes(target)) setCanvasGesture({ kind: "move", start: point, current: point, ids });
      return true;
    }
    if (mode === "lasso") { setCanvasGesture({ kind: "lasso", points: [point] }); return true; }
    if (mode && ["rectangle", "ellipse", "line", "arrow"].includes(mode)) {
      setCanvasGesture({ kind: "shape", start: point, current: point }); return true;
    }
    if (mode === "free-text" || mode === "note-card") {
      setCanvasGesture({ kind: "place", start: point }); return true;
    }
    return false;
  }
  function moveCanvas(point: InkPoint) {
    setCanvasGesture((gesture) => {
      if (!gesture) return gesture;
      if (gesture.kind === "lasso") {
        const last = gesture.points.at(-1)!;
        return Math.hypot(point[0] - last[0], point[1] - last[1]) < 2 ? gesture :
          { ...gesture, points: [...gesture.points, point] };
      }
      return gesture.kind === "place" ? gesture : { ...gesture, current: point };
    });
  }
  function shiftSelection(ids: string[], dx: number, dy: number) {
    if (props.annotations?.some((annotation) => ids.includes(annotation.id))) {
      setInkError("源批注固定在原文位置；请先取消选择批注，再移动其他对象。");
      return;
    }
    const current = state.value;
    if (!current) return;
    const cards = current.cards.filter((card) => ids.includes(card.id));
    const objects = current.objects.filter((object) => ids.includes(object.id));
    let minDx = -Infinity, maxDx = Infinity, minDy = -Infinity, maxDy = Infinity;
    for (const card of cards) {
      minDy = Math.max(minDy, -card.y);
      minDx = Math.max(minDx, -card.x);
      const columnLeft = WORKSPACE_DOCUMENT_X - 24;
      const columnRight = WORKSPACE_DOCUMENT_X + documentWidth + 24;
      if (card.x + card.width <= columnLeft) maxDx = Math.min(maxDx, columnLeft - card.x - card.width);
      else if (card.x >= columnRight) minDx = Math.max(minDx, columnRight - card.x);
    }
    for (const object of objects) {
      if (object.kind === "ink") continue;
      const rect = objectRect(object, pages.current);
      if (!rect) continue;
      minDx = Math.max(minDx, -rect.x);
      minDy = Math.max(minDy, -rect.y);
      if (object.surface.kind === "pdf") {
        const pageNumber = object.surface.page;
        const page = pages.current.find((item) => item.page === pageNumber);
        if (page) {
          minDx = Math.max(minDx, page.x - rect.x);
          maxDx = Math.min(maxDx, page.x + page.width - rect.x - rect.width);
          minDy = Math.max(minDy, page.y - rect.y);
          maxDy = Math.min(maxDy, page.y + page.height - rect.y - rect.height);
        }
      }
    }
    dx = Math.max(minDx, Math.min(maxDx, dx));
    dy = Math.max(minDy, Math.min(maxDy, dy));
    if (Math.abs(dx) < .01 && Math.abs(dy) < .01) return;
    state.change((snapshot) => ({ ...snapshot,
      cards: snapshot.cards.map((card) => ids.includes(card.id) ? { ...card, x: card.x + dx, y: card.y + dy } : card),
      objects: snapshot.objects.map((object) => ids.includes(object.id) ?
        translateObject(object, dx, dy, pages.current, props.book.fingerprint) : object),
    }));
  }
  function endCanvas(point: InkPoint) {
    const gesture = canvasGesture;
    setCanvasGesture(undefined);
    if (!gesture || !state.value) return;
    if (gesture.kind === "move") {
      const dx = point[0] - gesture.start[0], dy = point[1] - gesture.start[1];
      if (Math.hypot(dx, dy) * props.zoom >= 5) shiftSelection(gesture.ids, dx, dy);
      return;
    }
    if (gesture.kind === "lasso") {
      const polygon = [...gesture.points, point];
      const chosen = [
        ...state.value.cards.filter((card) => lassoHitsRect(polygon, card)).map((card) => card.id),
        ...state.value.objects.filter((object) => object.kind === "ink" ?
          projectedInk.current.find((item) => item.id === object.id)?.paths.some((path) => lassoHitsPath(polygon, path.points)) :
          !!objectRect(object, pages.current) && lassoHitsRect(polygon, objectRect(object, pages.current)!)).map((object) => object.id),
        ...(props.annotations ?? []).filter((annotation) =>
          annotationRects(annotation, pages.current).some((rect) => lassoHitsRect(polygon, rect)))
          .map((annotation) => annotation.id),
      ];
      setSelectedIds(chosen); setSelected(chosen.find((id) => state.value!.cards.some((card) => card.id === id)));
      return;
    }
    if (gesture.kind === "shape") {
      if (Math.hypot(point[0] - gesture.start[0], point[1] - gesture.start[1]) * props.zoom < 5) return;
      const shape = newShape(crypto.randomUUID(), props.mode as "rectangle" | "ellipse" | "line" | "arrow",
        gesture.start, point, pages.current, props.book.fingerprint);
      state.change((current) => ({ ...current, objects: [...current.objects, shape] }));
      setSelectedIds([shape.id]);
      return;
    }
    if (props.mode === "free-text") {
      const placed = worldToSurface(gesture.start, pages.current, props.book.fingerprint);
      const corners = placed.page ? [[placed.page.x, placed.page.y],
        [placed.page.x + placed.page.width, placed.page.y + placed.page.height]]
        .map((point) => placed.page!.toPdf(point as InkPoint)) : [];
      const right = corners.length ? Math.max(...corners.map((point) => point[0])) : Infinity;
      const bottom = corners.length ? Math.max(...corners.map((point) => point[1])) : Infinity;
      const x = Math.min(placed.point[0], right - 20), y = Math.min(placed.point[1], bottom - 20);
      const object: WorkspaceObject = { id: crypto.randomUUID(), kind: "text", surface: placed.surface,
        x, y, width: Math.min(240, right - x), height: Math.min(90, bottom - y), text: "",
        fontSize: 16, color: "#283d52", bold: false, align: "left" };
      state.change((current) => ({ ...current, objects: [...current.objects, object] }));
      setSelectedIds([object.id]); setEditingText(object.id);
    } else if (props.mode === "note-card") {
      void placeNote(undefined, gesture.start).catch((error) => setInkError(String(error)));
    }
  }
  function cancelCanvas() { setCanvasGesture(undefined); }
  useEffect(() => { cancelCanvas(); }, [props.mode, props.zoom, props.rotation]);
  useEffect(() => { setSelectedLink(undefined); }, [props.mode]);
  async function removeSelected() {
    if (!selectedIds.length && !selectedLink) return;
    const selectedAnnotations = props.annotations?.filter((annotation) => selectedIds.includes(annotation.id)) ?? [];
    if (selectedAnnotations.length) {
      if (selectedIds.length !== 1 || !props.onAnnotationDelete) {
        setInkError("源批注请单独删除，避免混合选区中只删除部分对象。");
        return;
      }
      if (!(await state.flush())) { setInkError("工作区尚未保存，请重试删除批注。"); return; }
      try { await props.onAnnotationDelete(selectedAnnotations[0]); }
      catch (cause) { setInkError(`批注删除失败，原数据仍保留：${String(cause)}`); return; }
      await state.reload(true);
      if (props.onAnnotationRestore) state.recordExternal({ kind: "external",
        undo: async () => { await props.onAnnotationRestore!(selectedAnnotations[0]); await state.reload(true); },
        redo: async () => { await props.onAnnotationDelete!(selectedAnnotations[0]); await state.reload(true); },
      });
      setSelectedIds([]); setSelected(undefined);
      return;
    }
    const ids = new Set(selectedIds);
    state.change((current) => ({ ...current,
      cards: current.cards.filter((card) => !ids.has(card.id)),
      objects: current.objects.filter((object) => !ids.has(object.id)),
      links: current.links.filter((link) => link.id !== selectedLink &&
        !ids.has(link.from) && !ids.has(link.to)),
    }));
    setSelectedIds([]); setSelected(undefined); setSelectedLink(undefined);
  }
  function updateObjects(change: (object: Exclude<WorkspaceObject, InkStroke>) => WorkspaceObject) {
    const ids = new Set(selectedIds);
    state.change((current) => ({ ...current, objects: current.objects.map((object) =>
      object.kind !== "ink" && ids.has(object.id) ? change(object) : object) }));
  }
  useEffect(() => {
    const keydown = (event: KeyboardEvent) => {
      if (event.key !== "Delete" || event.isComposing || (!selectedIds.length && !selectedLink) ||
          (event.target as HTMLElement)?.closest("input,textarea,[contenteditable]")) return;
      event.preventDefault();
      void removeSelected();
    };
    window.addEventListener("keydown", keydown);
    return () => window.removeEventListener("keydown", keydown);
  }, [selectedIds, selectedLink, state]);
  function overlay(layout: WorkspacePage[], el: HTMLDivElement | null) {
    pages.current = layout;
    viewport.current = el;
    if (!state.value) return null;
    const styleObject = selectedIds.length === 1 ? state.value.objects.find((object) =>
      object.id === selectedIds[0] && object.kind !== "ink") : undefined;
    const cached = projectedCache.current;
    const strokes = cached && cached.objects === state.value.objects &&
      cached.pages === layout.length && cached.zoom === props.zoom &&
      cached.rotation === props.rotation ? cached.strokes :
      state.value.objects.filter((object): object is InkStroke => object.kind === "ink")
        .map((stroke) => projectStroke(stroke, layout));
    if (strokes !== cached?.strokes)
      projectedCache.current = { objects: state.value.objects, pages: layout.length,
        zoom: props.zoom, rotation: props.rotation, strokes };
    projectedInk.current = strokes;
    const cards = state.value.cards.map((card) =>
      gesture?.id === card.id ? { ...card, ...gesture } : card,
    );
    const boundsFor = (id: string) => {
      const card = cards.find((item) => item.id === id);
      if (card) return card;
      const object = state.value!.objects.find((item) => item.id === id);
      if (!object) {
        const annotation = props.annotations?.find((item) => item.id === id);
        const rects = annotation ? annotationRects(annotation, layout) : [];
        if (!rects.length) return;
        const x = Math.min(...rects.map((rect) => rect.x));
        const y = Math.min(...rects.map((rect) => rect.y));
        return { x, y, width: Math.max(...rects.map((rect) => rect.x + rect.width)) - x,
          height: Math.max(...rects.map((rect) => rect.y + rect.height)) - y };
      }
      if (object.kind !== "ink") return objectRect(object, layout);
      const paths = strokes.find((stroke) => stroke.id === id)?.paths ?? [];
      if (!paths.length) return;
      const x = Math.min(...paths.map((path) => path.bounds[0]));
      const y = Math.min(...paths.map((path) => path.bounds[1]));
      return { x, y,
        width: Math.max(...paths.map((path) => path.bounds[2])) - x,
        height: Math.max(...paths.map((path) => path.bounds[3])) - y };
    };
    const selectedRects = selectedIds.flatMap((id) => {
      const rect = boundsFor(id); return rect ? [rect] : [];
    });
    const selectedBounds = selectedRects.length ? {
      x: Math.min(...selectedRects.map((rect) => rect.x)),
      y: Math.min(...selectedRects.map((rect) => rect.y)),
      right: Math.max(...selectedRects.map((rect) => rect.x + rect.width)),
      bottom: Math.max(...selectedRects.map((rect) => rect.y + rect.height)),
    } : undefined;
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
            const from = boundsFor(link.from), to = boundsFor(link.to);
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
                {link.directed && <circle cx={x2} cy={y2} r={3.5} fill="#96a9ad" />}
                <foreignObject
                  x={(x1 + x2) / 2 - 80}
                  y={(y1 + y2) / 2 - 16}
                  width={160}
                  height={40}
                >
                  <button
                    className="workspace-link"
                    onClick={() => {
                      setSelectedLink(link.id);
                      setSelectedIds([]);
                      setLinkFrom(undefined);
                    }}
                    title={link.label || "编辑关系"}
                  >
                    {link.label || "关联"}
                  </button>
                </foreignObject>
              </g>
            );
          })}
        </svg>
        {state.value.objects.filter((object): object is Exclude<WorkspaceObject, InkStroke> => object.kind !== "ink")
          .map((object) => <WorkspaceObjectView key={object.id} object={object} pages={layout} zoom={props.zoom}
            selected={selectedIds.includes(object.id)} editing={editingText === object.id}
            onSelect={() => selectTarget(object.id)} onEdit={() => { selectTarget(object.id); setEditingText(object.id); }}
            onResize={(dx, dy) => state.change((current) => ({ ...current,
              objects: current.objects.map((item) => item.id === object.id && item.kind !== "ink" ?
                resizeObject(item, dx, dy, layout) : item),
            }))}
            onCommit={(text) => {
              if (object.kind === "text" && text !== object.text)
                state.change((current) => ({ ...current, objects: current.objects.map((item) =>
                  item.id === object.id && item.kind === "text" ? { ...item, text } : item) }));
              setEditingText(undefined);
            }} />)}
        {canvasGesture?.kind === "lasso" && <svg className="workspace-gesture-preview"
          width={Math.max(2400, el?.scrollWidth ?? 0)} height={Math.max(1000, el?.scrollHeight ?? 0)}>
          <path d={`M ${canvasGesture.points.map((point) => point.join(" ")).join(" L ")} Z`} />
        </svg>}
        {canvasGesture?.kind === "shape" && (() => {
          const preview = newShape("preview", props.mode as "rectangle" | "ellipse" | "line" | "arrow",
            canvasGesture.start, canvasGesture.current, layout, props.book.fingerprint);
          return <WorkspaceObjectView object={preview} pages={layout} zoom={props.zoom} selected={false} editing={false}
            onSelect={() => {}} onEdit={() => {}} onCommit={() => {}} onResize={() => {}} />;
        })()}
        {selectedIds.filter((id) => state.value!.objects.some((object) => object.id === id && object.kind === "ink"))
          .map((id) => <svg key={id} className="workspace-ink-selection"
            width={Math.max(2400, el?.scrollWidth ?? 0)} height={Math.max(1000, el?.scrollHeight ?? 0)}>
            {strokes.find((stroke) => stroke.id === id)?.paths.map((path, index) =>
              <polyline key={index} points={path.points.map((point) => point.join(",")).join(" ")} />)}
          </svg>)}
        {cards.map((card) => (
          <article
            key={card.id}
            className={`workspace-card ${card.kind}${selectedIds.includes(card.id) ? " selected" : ""}`}
            data-card-id={card.id}
            style={{
              left: card.x,
              top: card.y,
              width: card.width,
              height: card.height,
            }}
            onPointerDown={(event) => {
              if ((event.target as HTMLElement).closest("input, textarea, [contenteditable=true]")) return;
              if (event.button === 0) select(card, event.shiftKey);
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
              {card.kind === "note" ? (card.noteId
                ? <NoteCardContent note={props.notes.notes.find((note) => note.id === card.noteId)}
                  state={props.notes} editing={selectedIds.length === 1 && selectedIds[0] === card.id} />
                : <div className="workspace-legacy-note">
                    <strong>{card.title || "未命名笔记"}</strong>
                    <p>{[card.text, card.comment].filter(Boolean).join("\n") || "还没有内容"}</p>
                    <button onClick={() => { void promoteCard(card).catch((error) => setInkError(String(error))); }}>
                      编辑笔记
                    </button>
                  </div>) : <><input
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
              ) : null}
              {card.noteId
                ? <div className="workspace-comment"><small>个人评论 · 非书中原文</small>
                    <NoteCardContent note={props.notes.notes.find((note) => note.id === card.noteId)}
                      state={props.notes} editing={false} compact />
                    <button onClick={() => {
                      const note = props.notes.notes.find((item) => item.id === card.noteId);
                      if (note) props.onExpandNote(note);
                    }}>编辑评论</button>
                  </div>
                : <div className="workspace-comment">
                    {card.comment && <p>{card.comment}</p>}
                    <button onClick={() => { void promoteCard(card).catch((error) => setInkError(String(error))); }}>
                      {card.comment ? "编辑评论" : "写评论"}
                    </button>
                  </div>}
              </>}
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
                {card.noteId && <button aria-label="展开卡片笔记" title="展开编辑笔记" onClick={() => {
                  const note = props.notes.notes.find((note) => note.id === card.noteId);
                  if (note) props.onExpandNote(note);
                }}><Icon name="outward" /></button>}
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
                  aria-label={card.noteId ? "移除卡片，保留笔记" : "删除卡片"}
                  title={card.noteId ? "移除卡片，保留笔记" : "删除卡片"}
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
      {el?.parentElement && selectedBounds && selectedBounds.bottom * props.zoom >= el.scrollTop &&
        selectedBounds.y * props.zoom <= el.scrollTop + el.clientHeight && createPortal(
          <div className="workspace-object-toolbar" role="toolbar" aria-label="对象操作"
            style={{ left: Math.max(8, Math.min(el.clientWidth - 260,
              (selectedBounds.x + selectedBounds.right) / 2 * props.zoom - el.scrollLeft - 130)),
              top: Math.max(8, Math.min(el.clientHeight - 44,
                selectedBounds.y * props.zoom - el.scrollTop - 44)) }}>
            <span>{selectedIds.length > 1 ? `${selectedIds.length} 个对象` : "已选中"}</span>
            {selectedIds.some((id) => props.annotations?.some((annotation) => annotation.id === id)) &&
              <span className="workspace-fixed-source" title="源批注不能移动">原文固定</span>}
            {selectedIds.length === 1 && (() => {
              const annotation = props.annotations?.find((item) => item.id === selectedIds[0]);
              if (!annotation) return null;
              return <>
                <button aria-label="回到批注原文" title="回到批注原文"
                  onClick={() => sourceAnnotation(annotation)}><Icon name="outward" /></button>
                <select aria-label="批注颜色" value={annotation.color}
                  onChange={(event) => {
                    const color = event.target.value as Annotation["color"];
                    if (!props.onAnnotationColor || color === annotation.color) return;
                    void props.onAnnotationColor(annotation, color).then(() => {
                      state.recordExternal({ kind: "external",
                        undo: () => props.onAnnotationColor!(annotation, annotation.color),
                        redo: () => props.onAnnotationColor!(annotation, color),
                      });
                    }).catch((cause) => setInkError(`批注颜色修改失败：${String(cause)}`));
                  }}>
                  <option value="yellow">黄</option><option value="green">绿</option>
                  <option value="blue">蓝</option><option value="pink">粉</option>
                </select>
              </>;
            })()}
            {selectedIds.some((id) => state.value!.objects.some((object) => object.id === id)) &&
              <label title="修改选中对象颜色" aria-label="对象颜色">
                <input type="color" aria-label="对象颜色" defaultValue="#345d84"
                  onChange={(event) => {
                    const color = event.target.value, ids = new Set(selectedIds);
                    state.change((current) => ({ ...current,
                      objects: current.objects.map((object) => ids.has(object.id) ? { ...object, color } : object),
                    }));
                  }} />
              </label>}
            {styleObject && <>
              <Popover key={selectedIds[0]} label="对象格式设置" triggerLabel="对象格式"
                trigger={<Icon name="more" />} placement="bottom" width={180}
                className="workspace-object-style" autoFocusFirst>
                {() => <div role="group" aria-label="对象格式设置">
                {styleObject.kind === "text" ? <>
                  <label>字号<input aria-label="文字字号" type="number" min={8} max={120}
                    value={styleObject.fontSize} onChange={(event) => {
                      const fontSize = Number(event.target.value);
                      if (fontSize >= 8 && fontSize <= 120) updateObjects((object) =>
                        object.kind === "text" ? { ...object, fontSize } : object);
                    }} /></label>
                  <label><input aria-label="粗体文字" type="checkbox" checked={styleObject.bold}
                    onChange={(event) => updateObjects((object) => object.kind === "text" ?
                      { ...object, bold: event.target.checked } : object)} />粗体</label>
                  <label>对齐<select aria-label="文字对齐" value={styleObject.align}
                    onChange={(event) => updateObjects((object) => object.kind === "text" ?
                      { ...object, align: event.target.value as "left" | "center" | "right" } : object)}>
                    <option value="left">左</option><option value="center">中</option>
                    <option value="right">右</option></select></label>
                </> : styleObject.kind === "shape" ? <>
                  <label>线宽<select aria-label="形状线宽" value={styleObject.strokeWidth}
                    onChange={(event) => updateObjects((object) => object.kind === "shape" ?
                      { ...object, strokeWidth: Number(event.target.value) } : object)}>
                    {[1, 2, 4, 8].map((width) => <option key={width} value={width}>{width}</option>)}
                  </select></label>
                  <label><input aria-label="填充形状" type="checkbox" checked={!!styleObject.fill}
                    onChange={(event) => updateObjects((object) => object.kind === "shape" ?
                      { ...object, fill: event.target.checked ? object.color : undefined,
                        fillOpacity: event.target.checked ? (object.fillOpacity ?? .2) : undefined } : object)} />填充</label>
                  {styleObject.fill && <label>透明度<select aria-label="形状填充透明度"
                    value={styleObject.fillOpacity ?? .2}
                    onChange={(event) => updateObjects((object) => object.kind === "shape" ?
                      { ...object, fillOpacity: Number(event.target.value) } : object)}>
                    {[.15, .2, .3, .5, .75].map((opacity) => <option key={opacity} value={opacity}>
                      {Math.round(opacity * 100)}%</option>)}
                  </select></label>}
                </> : null}
                </div>}
              </Popover>
            </>}
            <button aria-label="连接选中对象" title="点击另一个对象建立关系"
              onClick={() => setLinkFrom(selectedIds[0])}><Icon name="link" /></button>
            {props.onQuestionMaterials && <button aria-label="将选中对象加入提问" title="加入本轮材料，不会立即发送"
              disabled={materialBusy} onClick={() => void addSelectedToQuestion(selectedIds)}>
              <Icon name="chat" /></button>}
            <button aria-label="删除选中对象" title="删除选中对象" onClick={() => void removeSelected()}>
              <Icon name="trash" /></button>
          </div>, el.parentElement)}
      {el?.parentElement && selectedLink && (() => {
        const link = state.value!.links.find((item) => item.id === selectedLink);
        if (!link) return null;
        const from = boundsFor(link.from), to = boundsFor(link.to);
        if (!from || !to) return null;
        return createPortal(<div className="workspace-object-toolbar link-editor" role="toolbar" aria-label="关系操作"
          style={{ left: Math.max(8, Math.min(el.clientWidth - 240,
            ((from.x + from.width / 2 + to.x + to.width / 2) / 2) * props.zoom - el.scrollLeft - 120)),
            top: Math.max(8, Math.min(el.clientHeight - 44,
              ((from.y + from.height / 2 + to.y + to.height / 2) / 2) * props.zoom - el.scrollTop - 44)) }}>
          <input key={link.id} aria-label="关系名称" defaultValue={link.label} maxLength={200}
            placeholder="关系名称" onBlur={(event) => {
              const label = event.target.value;
              if (label !== link.label) state.change((current) => ({ ...current,
                links: current.links.map((item) => item.id === link.id ? { ...item, label } : item) }));
            }} />
          <label><input type="checkbox" aria-label="关系方向" checked={link.directed ?? false}
            onChange={(event) => state.change((current) => ({ ...current,
              links: current.links.map((item) => item.id === link.id ? { ...item, directed: event.target.checked } : item) }))} />方向</label>
          <button aria-label="删除关系" onClick={removeSelected}><Icon name="trash" /></button>
          {props.onQuestionMaterials && <button aria-label="将关系加入提问" disabled={materialBusy}
            onClick={() => void addSelectedToQuestion([link.id])}><Icon name="chat" /></button>}
        </div>, el.parentElement);
      })()}
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
      if (pointer.current.mode === "move" && selectedIds.includes(id) && selectedIds.length > 1)
        shiftSelection(selectedIds, geometry.x - pointer.current.card.x,
          geometry.y - pointer.current.card.y);
      else update(id, geometry);
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
              state.change((current) => ({ ...current, camera }), false);
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
          ink: state.value?.objects.filter((object): object is InkStroke => object.kind === "ink"),
          marks: state.value?.objects.filter((object): object is Exclude<WorkspaceObject, InkStroke> => object.kind !== "ink"),
          onInkStart: startInk,
          onInkMove: moveInk,
          onInkEnd: finishInk,
          onInkCancel: cancelInk,
          onCanvasStart: startCanvas,
          onCanvasMove: moveCanvas,
          onCanvasEnd: endCanvas,
          onCanvasCancel: cancelCanvas,
          onAnnotationTarget: (id) => selectTarget(id),
        }}
      />
      {props.toolbarHost && createPortal(<div className="workspace-menu">
        <Popover label="工作区操作" triggerLabel={`工作区操作，${state.status}`} className="workspace-menu-popover" width={200} role="menu" autoFocusFirst trigger={<>
          <Icon name="workspace" />
          {state.status !== "已保存" && <span
            className={`workspace-save-indicator ${state.status.includes("失败") ? "is-error" : ""}`}
            aria-hidden="true"
          />}
        </>}>
        {(close) => <>
        <button
          aria-label="＋ 笔记卡片"
          disabled={!state.value}
          role="menuitem"
          onClick={() => { add(); close(); }}
        >
          <Icon name="plus" /> 笔记
        </button>
        <button
          aria-label="撤销工作区修改"
          disabled={!state.canUndo}
          role="menuitem"
          onClick={() => { state.undo(); close(); }}
        >
          <Icon name="undo" /> 撤销
        </button>
        <button
          aria-label="重做工作区修改"
          disabled={!state.canRedo}
          role="menuitem"
          onClick={() => { state.redo(); close(); }}
        >
          <Icon name="redo" /> 重做
        </button>
        <i className="workspace-menu-divider" />
        <button role="menuitem" onClick={() => { locateDocument(); close(); }} title="回到当前阅读页">
          <Icon name="book" />
          定位正文
        </button>
        <button role="menuitem" onClick={() => { overview(); close(); }} title="缩小并查看画布内容">
          <Icon name="fit" />
          查看全部
        </button>
        <button
          aria-label="聚焦正文"
          title="淡化笔记，聚焦正文"
          role="menuitemcheckbox"
          aria-checked={focus}
          onClick={() => { setFocus(!focus); close(); }}
        >
          <Icon name="focus" /> 聚焦正文
        </button>
        {returnPosition && (
          <button
            role="menuitem"
            onClick={() => {
              viewport.current?.scrollTo({
                left: returnPosition.x * props.zoom,
                top: returnPosition.y * props.zoom,
              });
              setReturnPosition(undefined);
              setSourceFocus(undefined);
              close();
            }}
          >
            返回卡片位置
          </button>
        )}
        <i className="workspace-menu-divider" />
        <button
          aria-label="打包工作区"
          title="打包 PDF、笔记、连线及附件"
          disabled={exporting || !state.value}
          role="menuitem"
          onClick={() => { void exportWorkspace(); close(); }}
        >
          <Icon name="download" /> 打包工作区
        </button>
        <span role="status" aria-label="工作区保存状态">
          {state.status}
        </span>
        </>}
        </Popover>
      </div>, props.toolbarHost)}
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
                {(card.noteId ? props.notes.notes.find((note) => note.id === card.noteId)?.title : card.title) || "未命名笔记"}
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
