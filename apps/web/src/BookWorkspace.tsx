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
  QuestionMaterialSnapshot,
} from "../../../packages/protocol/src";
import type { WorkspaceCard, WorkspaceObject } from "../../../packages/protocol/src/workspace";
import type { BookChange, BookCommandReceipt } from "../../../packages/protocol/src/book-commands";
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
import { locateWorkspaceItem } from "../../../packages/workspace-engine/src/catalog";
import { Icon } from "./ui/Icon";
import { Popover } from "./ui/Popover";
import { WorkspaceObjectActions, WorkspaceRelationActions } from "./WorkspaceObjectActions";
import { base, post } from "./api";
import "./workspace.css";
import "./reader-split.css";
import type { BookNotes } from "./features/notes/useBookNotes";
import type { WorkspaceEditingSession } from "./features/workspace/WorkspaceEditingSession";
import { NoteCardContent } from "./features/notes/NoteCardContent";
import { ConnectionOverlay, type ConnectionOverlayItem } from "./features/connections";
import { addCardToGroup, arrangeGroup, assignCardGroup, boardMemberBounds, groupSelection, moveGroup } from "./features/workspace/groups";
import { findOpenCardPlacement } from "./features/workspace/card-placement";
import { CompareView, FocusPdfDocument } from "./features/compare-focus";
import { relatedComparisonNotes } from "./features/compare-focus/comparison-notes";

export interface BookWorkspaceHandle {
  excerpt(selection: ReadingSelection, point?: InkPoint): void;
  escape(): void;
  addToQuestion(ids: string[]): Promise<boolean>;
  locate(anchors: PdfAnchor[]): void;
  jumpPage(page: number): void;
  placeNote(note: Note): Promise<void>;
  locateItem(id: string): void;
  showPane(pane: "pdf" | "board"): void;
  focusAnchors(anchors: PdfAnchor[]): void;
}
export const BookWorkspace = forwardRef<
  BookWorkspaceHandle,
  PdfReaderProps & {
    book: Book;
    page: number;
    toolPreferences: ToolPreferences;
    toolbarHost?: HTMLElement | null;
    feedbackHost?: HTMLElement | null;
    workspaceEvent?: number;
    onAnnotationColor?: (annotation: Annotation, color: Annotation["color"]) => Promise<void>;
    onAnnotationDelete?: (annotation: Annotation) => Promise<void>;
    onAnnotationRestore?: (annotation: Annotation) => Promise<void>;
    onQuestionMaterials?: (selection: Pick<QuestionMaterialInput,
      "workspaceRevision" | "targets" | "previews">) => Promise<void>;
    beforeExport?: () => Promise<boolean>;
    notes: BookNotes;
    workspaceSession: WorkspaceEditingSession;
    onExpandNote: (note: Note) => void;
    onCatalogChange?: (bookId: string, catalog: Pick<WorkspaceSnapshot, "cards" | "objects" | "links">) => void;
    pdfZoom: number;
    onPdfZoom: (zoom: number) => void;
    splitRatio: number;
    onSplitRatio: (ratio: number) => void;
    readerPaneMode: "split" | "pdf" | "board";
    onReaderPaneMode: (mode: "split" | "pdf" | "board") => void;
    connectionHost?: HTMLElement | null;
    questionMaterials?: QuestionMaterialSnapshot[];
    chatOpen?: boolean;
    onBoardHost?: (node: HTMLElement | null) => void;
    onBookChanges: (changes: BookChange[], commandId?: string) => Promise<BookCommandReceipt>;
    draggedExcerpt?: { bookId: string; selection: ReadingSelection };
    onExcerptDrop?: () => void;
  }
>(function BookWorkspace(props, ref) {
  const state = useWorkspace(props.workspaceSession, props.annotations?.map((annotation) => annotation.id));
  const onCatalogChange = useRef(props.onCatalogChange);
  onCatalogChange.current = props.onCatalogChange;
  useEffect(() => {
    if (!state.value) return;
    onCatalogChange.current?.(props.book.id, {
      cards: state.value.cards, objects: state.value.objects, links: state.value.links,
    });
  }, [props.book.id, state.value?.cards, state.value?.objects, state.value?.links]);
  const mounted = useRef(true), placing = useRef(false);
  const pendingCreateNote = useRef<{ commandId: string; changes: BookChange[] } | undefined>(undefined);
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
  const [selectedGroup, setSelectedGroup] = useState<string>();
  const [groupMaterialPreview, setGroupMaterialPreview] = useState<{ groupId: string; ids: string[] }>();
  const [groupGesture, setGroupGesture] = useState<{ id: string; dx: number; dy: number }>();
  const groupPointer = useRef<{ id: string; x: number; y: number } | undefined>(undefined);
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
  const [narrow, setNarrow] = useState(false);
  const [narrowPane, setNarrowPane] = useState<"pdf" | "board">("pdf");
  const [splitDraft, setSplitDraft] = useState(props.splitRatio);
  const splitRoot = useRef<HTMLDivElement>(null);
  const splitDrag = useRef<number | undefined>(undefined);
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
  const [locatingPage, setLocatingPage] = useState<number>();
  const pendingLocate = useRef<PdfAnchor[] | undefined>(undefined);
  const pendingPage = useRef<number | undefined>(undefined);
  const [focusAnchors, setFocusAnchors] = useState<PdfAnchor[]>();
  const [comparing, setComparing] = useState<string[]>();
  const [sourcePreview, setSourcePreview] = useState<WorkspaceCard>();
  const [connectionView, setConnectionView] = useState<{
    container: { left: number; top: number; width: number; height: number };
    connections: ConnectionOverlayItem[];
  }>();
  const connectionSignature = useRef("");
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
  const pdfViewport = useRef<HTMLDivElement | null>(null);
  const pdfPages = useRef<WorkspacePage[]>([]);
  const pages = useRef<WorkspacePage[]>([]);
  const gestureZoom = useRef(props.zoom);
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
    const root = splitRoot.current;
    if (!root) return;
    const observer = new ResizeObserver(([entry]) => setNarrow(entry.contentRect.width < 840));
    observer.observe(root);
    return () => observer.disconnect();
  }, []);
  useEffect(() => setSplitDraft(props.splitRatio), [props.splitRatio]);
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
    const el = pdfViewport.current;
    if (!el) return;
    const page = pdfPages.current.find((item) => item.page === props.page);
    if (page) el.scrollTo({ left: Math.max(0, (page.x + page.width / 2) * props.pdfZoom - el.clientWidth / 2),
      top: Math.max(0, page.y * props.pdfZoom - 20) });
    setNarrowPane("pdf");
    if (props.readerPaneMode === "board") props.onReaderPaneMode("split");
    setFocus(false);
  }
  function overview() {
    setShowOverview(true);
    const el = viewport.current;
    if (!el) return;
    const cards = state.value?.cards ?? [];
    const bounds = [...cards, ...(state.value?.groups ?? [])];
    if (!bounds.length) return;
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
  function add(selection?: ReadingSelection, point?: InkPoint) {
    if (!selection) { void placeNote().catch((error) => setInkError(String(error))); return; }
    if (!state.value) return;
    const sameSource = state.value.cards.find((old) => old.kind === "excerpt" &&
      old.source?.fingerprint === props.book.fingerprint &&
      JSON.stringify(old.source.anchors) === JSON.stringify(selection.anchors));
    if (sameSource) {
      navigate(Math.max(0, sameSource.x - 40), Math.max(0, sameSource.y - 40));
      selectTarget(sameSource.id);
      setNarrowPane("board");
      return;
    }
    const el = viewport.current;
    let card: WorkspaceCard = {
      id: crypto.randomUUID(),
      kind: "excerpt",
      title: `第 ${props.book.labels[selection.page - 1] ?? selection.page} 页摘录`,
      text: selection.text,
      comment: "",
      x: point ? Math.max(0, point[0]) : selectedGroup ? (state.value.groups.find((group) => group.id === selectedGroup)?.x ?? 16) + 24 :
        Math.max(40, (el?.scrollLeft ?? 0) / props.zoom + 60),
      y: point ? Math.max(0, point[1]) : selectedGroup ? (state.value.groups.find((group) => group.id === selectedGroup)?.y ?? 6) + 54 :
        Math.max(40, (el?.scrollTop ?? 0) / props.zoom + 60),
      width: 320,
      height: 240,
      source: { fingerprint: props.book.fingerprint, anchors: structuredClone(selection.anchors) },
    };
    if (!point) card = findOpenCardPlacement(card, state.value.cards);
    const targetGroup = point ? state.value.groups.find((group) => !group.collapsed &&
      point[0] >= group.x && point[0] <= group.x + group.width &&
      point[1] >= group.y && point[1] <= group.y + group.height)?.id : selectedGroup;
    state.change((current) => addCardToGroup({ ...current, cards: [...current.cards, card] }, card, targetGroup));
    setSelected(card.id); setSelectedIds([card.id]);
    setNarrowPane("board");
    if (props.readerPaneMode === "pdf") props.onReaderPaneMode("split");
    setFocus(false);
  }
  async function attachCardToNote(card: WorkspaceCard, noteId: string) {
    if (card.kind === "note") return;
    if (!(await props.notes.flush()) || !(await state.flush()))
      throw new Error("笔记或工作台草稿尚未保存，请重试关联");
    const note = props.notes.getSnapshot().notes.find((item) => item.id === noteId);
    if (!note || note.bookId !== props.book.id) throw new Error("所选笔记不属于当前书籍");
    if (note.sourceCard?.cardId === card.id || note.sourceReferences.some((source) =>
      source.kind === "card" && source.targetId === card.id)) return;
    await props.onBookChanges([{ type: "add-source", noteId,
      expectedRevision: note.revision, target: { kind: "card", id: card.id } }]);
    await props.notes.refresh();
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
      if (!mounted.current) return;
      const group = selectedGroup && state.value.groups.find((item) => item.id === selectedGroup);
      let card: WorkspaceCard = { id: pendingCreateNote.current?.changes[0]?.type === "create-note"
          ? pendingCreateNote.current.changes[0].placement.id : crypto.randomUUID(), kind: "note", noteId: existing?.id,
        title: "", text: "", comment: "", x: point ? Math.max(0, point[0] + 20) : group ? group.x + 24 :
          Math.max(40, (viewport.current?.scrollLeft ?? 0) / props.zoom + 60),
        y: point ? Math.max(0, point[1]) : group ? group.y + 54 :
          Math.max(40, (viewport.current?.scrollTop ?? 0) / props.zoom + 60),
        width: 340, height: 220 };
      if (!point) card = findOpenCardPlacement(card, state.value.cards);
      if (!existing) {
        if (!pendingCreateNote.current) {
          const changes: BookChange[] = [{ type: "create-note", title: "未命名笔记",
            placement: { id: card.id, x: card.x, y: card.y, width: card.width, height: card.height } }];
          if (group) changes.push({ type: "workspace", changes: [{ type: "upsert-group",
            group: { ...group, memberIds: [...new Set([...group.memberIds, card.id])],
              width: Math.max(group.width, card.x + card.width + 24 - group.x),
              height: Math.max(group.height, card.y + card.height + 24 - group.y) } }] });
          pendingCreateNote.current = { commandId: crypto.randomUUID(), changes };
        }
        const pending = pendingCreateNote.current;
        const receipt = await props.onBookChanges(pending.changes, pending.commandId);
        pendingCreateNote.current = undefined;
        const created = receipt.noteChanges.find((item) => item.before === undefined)?.after;
        if (!created) throw new Error("创建笔记回执缺少正文");
        await props.notes.refresh();
        props.notes.setSelected(created.id);
        setSelectedIds([card.id]); setSelected(card.id);
        const placement = pending.changes[0].type === "create-note" ? pending.changes[0].placement : card;
        navigate(placement.x - 40, placement.y - 40, 1);
        return;
      }
      state.change((current) => addCardToGroup({ ...current, cards: [...current.cards, card] }, card, selectedGroup));
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
    if (!pdfPages.current.some((item) => item.page === region.page)) throw new Error("找不到摘录的 PDF 页面");
    const position = findOpenCardPlacement({
      x: Math.max(40, (viewport.current?.scrollLeft ?? 0) / props.zoom + 60),
      y: Math.max(40, (viewport.current?.scrollTop ?? 0) / props.zoom + 60),
      width: 320, height: 240,
    }, state.value?.cards ?? []);
    const result = await post<{ workspace: WorkspaceSnapshot; cardId: string }>(
      `books/${props.book.id}/workspace/region-excerpts`, {
        bookId: props.book.id, commandId: region.operationId ?? crypto.randomUUID(), expectedVersion: revision,
        fingerprint: props.book.fingerprint, page: region.page, rect: region.rect,
        image: region.image, includePersonalMarks,
        title: `第 ${props.book.labels[region.page - 1] ?? region.page} 页图片摘录`, x: position.x, y: position.y,
      });
    state.acceptExternal(result.workspace);
    if (selectedGroup) {
      const saved = result.workspace.cards.find((card) => card.id === result.cardId);
      if (saved) state.change((current) => addCardToGroup(current, saved, selectedGroup));
    }
    setSelected(result.cardId);
    setSelectedIds([result.cardId]);
    setNarrowPane("board");
    await props.onRegionAction?.(region, action, includePersonalMarks);
  }
  useImperativeHandle(ref, () => ({ excerpt: add,
    placeNote,
    addToQuestion: addSelectedToQuestion,
    locate: locateAnchors,
    jumpPage,
    focusAnchors: enterFocus,
    showPane: (pane) => {
      setNarrowPane(pane);
      if (props.readerPaneMode !== "split") props.onReaderPaneMode("split");
    },
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
        const rect = state.value && locateWorkspaceItem(id, state.value, pdfPages.current, props.annotations ?? []);
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
        ...assignCardGroupIfMoved(current, id, change),
      }));
  }
  function assignCardGroupIfMoved(current: WorkspaceSnapshot, id: string, change: Partial<WorkspaceCard>) {
    const cards = current.cards.map((card) => card.id === id ? { ...card, ...change } : card);
    const next = { ...current, cards };
    const moved = cards.find((card) => card.id === id);
    return moved && (change.x !== undefined || change.y !== undefined) ? assignCardGroup(next, moved) : next;
  }
  function createThemeGroup() {
    if (!state.value) return;
    const ids = selectedIds.filter((id) => boardMemberBounds(state.value!, id));
    if (!ids.length) return;
    const id = crypto.randomUUID();
    state.change((current) => groupSelection(current, ids, id,
      `主题 ${current.groups.length + 1}`, "#5d83b0"));
    setSelectedGroup(id); setSelectedIds([]); setSelected(undefined);
  }
  function toggleGroup(id: string) {
    state.change((current) => ({ ...current,
      groups: current.groups.map((group) => group.id === id ? { ...group, collapsed: !group.collapsed } : group),
    }));
    setSelectedIds([]); setSelected(undefined); setSelectedGroup(id);
  }
  function disbandGroup(id: string) {
    state.change((current) => ({ ...current, groups: current.groups.filter((group) => group.id !== id) }));
    setSelectedGroup(undefined);
  }
  function autoArrangeGroup(id: string) {
    state.change((current) => arrangeGroup(current, id));
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
    setSelectedGroup(undefined);
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
  function goToSource(card: WorkspaceCard) {
    const anchors: PdfAnchor[] = card.region
      ? [{ page: card.region.page, rects: [card.region.rect] }]
      : card.source?.anchors ?? [];
    locateAnchors(anchors);
  }
  function enterFocus(anchors: PdfAnchor[]) {
    if (!anchors.length) return;
    setFocusAnchors(structuredClone(anchors));
    setNarrowPane("pdf");
    if (props.readerPaneMode === "board") props.onReaderPaneMode("split");
  }
  function eraseAt(point: InkPoint) {
    const gesture = inkGesture.current;
    if (gesture?.kind !== "erase") return;
    const radius = 9 / gestureZoom.current;
    for (const stroke of projectedInk.current)
      if (!gesture.ids.has(stroke.id) && hitStroke(stroke, point, radius))
        gesture.ids.add(stroke.id);
    inkCanvas.current?.preview([], undefined, gesture.ids);
  }
  function startInk(point: InkPoint) {
    if (!state.value) {
      setInkError("工作区尚未就绪，请等待加载完成后再绘画。");
      return false;
    }
    setInkError("");
    if (props.mode === "eraser") {
      inkGesture.current = { kind: "erase", ids: new Set() };
      eraseAt(point);
    } else if (props.mode === "pen" || props.mode === "highlighter") {
      const style = { ...props.toolPreferences[props.mode] };
      inkGesture.current = { kind: "draw", brush: props.mode, style, points: [point] };
      inkCanvas.current?.preview([point], style, new Set());
    }
    return true;
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
  useEffect(() => { if (inkGesture.current) cancelInk(); }, [props.mode, props.rotation, props.zoom, props.pdfZoom]);
  function findTarget(point: InkPoint, targetObjectId?: string) {
    if (targetObjectId && state.value?.objects.some((object) => object.id === targetObjectId))
      return targetObjectId;
    const radius = 7 / gestureZoom.current;
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
    pendingPage.current = undefined;
    setSourceFocus(anchors);
    setNarrowPane("pdf");
    if (props.readerPaneMode === "board") props.onReaderPaneMode("split");
    const page = pdfPages.current.find((item) => item.page === anchor.page);
    const el = pdfViewport.current;
    if (!page || !el) {
      pendingLocate.current = anchors;
      setLocatingPage(anchor.page);
      return;
    }
    pendingLocate.current = undefined;
    setLocatingPage(undefined);
    setReturnPosition({ x: el.scrollLeft / props.pdfZoom, y: el.scrollTop / props.pdfZoom });
    const location = page.locate(anchor.rects[0]);
    el.scrollTo({ left: Math.max(0, page.x * props.pdfZoom - 30),
      top: Math.max(0, location.y * props.pdfZoom - 100) });
  }
  function jumpPage(pageNumber: number) {
    if (!Number.isInteger(pageNumber) || pageNumber < 1 || pageNumber > props.book.pages) return;
    pendingLocate.current = undefined;
    setSourceFocus(undefined);
    setFocusAnchors(undefined);
    setNarrowPane("pdf");
    if (props.readerPaneMode === "board") props.onReaderPaneMode("split");
    const page = pdfPages.current.find((item) => item.page === pageNumber);
    const el = pdfViewport.current;
    if (!page || !el) {
      pendingPage.current = pageNumber;
      setLocatingPage(pageNumber);
      return;
    }
    pendingPage.current = undefined;
    setLocatingPage(undefined);
    el.scrollTo({ left: Math.max(0, page.x * props.pdfZoom - 30),
      top: Math.max(0, page.y * props.pdfZoom - 20) });
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
      const previews = captureMaterialPreviews(ids, snapshot, props.annotations ?? [], pdfPages.current);
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
    if (!state.value) {
      if (props.mode !== "pointer") setInkError("工作区尚未就绪，请等待加载完成后再编辑。");
      return false;
    }
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
    state.change((snapshot) => {
      let next = { ...snapshot,
        cards: snapshot.cards.map((card) => ids.includes(card.id) ? { ...card, x: card.x + dx, y: card.y + dy } : card),
        objects: snapshot.objects.map((object) => ids.includes(object.id) ?
          translateObject(object, dx, dy, pages.current, props.book.fingerprint) : object),
      };
      for (const card of next.cards.filter((item) => ids.includes(item.id)))
        next = assignCardGroup(next, card);
      return next;
    });
  }
  function endCanvas(point: InkPoint) {
    const gesture = canvasGesture;
    setCanvasGesture(undefined);
    if (!gesture || !state.value) return;
    if (gesture.kind === "move") {
      const dx = point[0] - gesture.start[0], dy = point[1] - gesture.start[1];
      if (Math.hypot(dx, dy) * gestureZoom.current >= 5) shiftSelection(gesture.ids, dx, dy);
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
      if (Math.hypot(point[0] - gesture.start[0], point[1] - gesture.start[1]) * gestureZoom.current < 5) return;
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
  useEffect(() => { cancelCanvas(); }, [props.mode, props.zoom, props.pdfZoom, props.rotation]);
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
      groups: current.groups.map((group) => ({ ...group,
        memberIds: group.memberIds.filter((id) => !ids.has(id)) })),
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
      const boardPane = splitRoot.current?.querySelector<HTMLElement>(".board-pane");
      if (!boardPane || boardPane.hidden || !boardPane.contains(document.activeElement)) return;
      event.preventDefault();
      void removeSelected();
    };
    window.addEventListener("keydown", keydown);
    return () => window.removeEventListener("keydown", keydown);
  }, [selectedIds, selectedLink, state]);
  function overlay(layout: WorkspacePage[], el: HTMLDivElement | null) {
    viewport.current = el;
    if (!state.value) return null;
    const styleObject = selectedIds.length === 1 ? state.value.objects.find(
      (object): object is Exclude<WorkspaceObject, InkStroke> =>
        object.id === selectedIds[0] && object.kind !== "ink",
    ) : undefined;
    const colorObject = state.value.objects.find((object) => selectedIds.includes(object.id));
    const cached = projectedCache.current;
    const strokes = cached && cached.objects === state.value.objects &&
      cached.pages === layout.length && cached.zoom === props.zoom &&
      cached.rotation === props.rotation ? cached.strokes :
      state.value.objects.filter((object): object is InkStroke => object.kind === "ink")
        .map((stroke) => projectStroke(stroke, layout));
    if (strokes !== cached?.strokes)
      projectedCache.current = { objects: state.value.objects, pages: layout.length,
        zoom: props.zoom, rotation: props.rotation, strokes };
    const visibleStrokes = strokes.filter((stroke) => !state.value!.groups.some((group) =>
      group.collapsed && group.memberIds.includes(stroke.id)));
    projectedInk.current = visibleStrokes;
    const groups = state.value.groups.map((group) => groupGesture?.id === group.id ?
      { ...group, x: group.x + groupGesture.dx, y: group.y + groupGesture.dy } : group);
    const collapsedMemberIds = new Set(state.value.groups.filter((group) => group.collapsed)
      .flatMap((group) => group.memberIds));
    const allCards = state.value.cards.map((card) => {
      const offset = groupGesture && state.value!.groups.find((group) => group.id === groupGesture.id)?.memberIds.includes(card.id)
        ? groupGesture : undefined;
      return gesture?.id === card.id ? { ...card, ...gesture } : offset ?
        { ...card, x: card.x + offset.dx, y: card.y + offset.dy } : card;
    });
    const visibleArea = el && { x: Math.max(0, el.scrollLeft / props.zoom - 360),
      y: Math.max(0, el.scrollTop / props.zoom - 360),
      width: el.clientWidth / props.zoom + 720,
      height: el.clientHeight / props.zoom + 720 };
    const inView = (rect: { x: number; y: number; width: number; height: number }) => !visibleArea ||
      rect.x <= visibleArea.x + visibleArea.width && rect.x + rect.width >= visibleArea.x &&
      rect.y <= visibleArea.y + visibleArea.height && rect.y + rect.height >= visibleArea.y;
    const objectInView = (object: Exclude<WorkspaceObject, InkStroke>) => {
      const bounds = objectRect(object, []);
      return !bounds || inView(bounds);
    };
    const cards = allCards.filter((card) => !collapsedMemberIds.has(card.id) && inView(card));
    const associatedNotes = new Map<string, Set<string>>();
    for (const card of state.value.cards) if (card.noteId)
      associatedNotes.set(card.id, new Set([card.noteId]));
    for (const note of props.notes.notes) for (const source of note.sourceReferences ?? []) {
      if (source.kind !== "card") continue;
      const ids = associatedNotes.get(source.targetId) ?? new Set<string>();
      ids.add(note.id); associatedNotes.set(source.targetId, ids);
    }
    const boundsFor = (id: string) => {
      const folded = groups.find((group) => group.collapsed && group.memberIds.includes(id));
      if (folded) return { ...folded, height: 58 };
      const card = allCards.find((item) => item.id === id);
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
        {groups.map((group) => {
          const actual = state.value!.groups.find((item) => item.id === group.id)!;
          const relationCount = state.value!.links.filter((link) =>
            group.memberIds.includes(link.from) || group.memberIds.includes(link.to)).length;
          return <section key={group.id}
            className={`workspace-group${group.collapsed ? " collapsed" : ""}${selectedGroup === group.id ? " selected" : ""}`}
            style={{ left: group.x, top: group.y, width: group.width,
              height: group.collapsed ? 58 : group.height,
              "--group-color": group.color } as CSSProperties}
            aria-label={`主题组 ${group.title}`}>
            <header tabIndex={0} aria-label="移动主题组"
              onClick={() => { setSelectedGroup(group.id); setSelectedIds([]); setSelected(undefined); }}
              onPointerDown={(event) => {
                if (event.button !== 0 || (event.target as HTMLElement).closest("button,input")) return;
                event.preventDefault(); event.currentTarget.setPointerCapture(event.pointerId);
                groupPointer.current = { id: group.id, x: event.clientX, y: event.clientY };
                setSelectedGroup(group.id); setSelectedIds([]); setSelected(undefined);
              }}
              onPointerMove={(event) => {
                const pointer = groupPointer.current;
                if (!pointer || pointer.id !== group.id || !event.currentTarget.hasPointerCapture(event.pointerId)) return;
                setGroupGesture({ id: group.id, dx: (event.clientX - pointer.x) / props.zoom,
                  dy: (event.clientY - pointer.y) / props.zoom });
              }}
              onPointerUp={(event) => {
                const pointer = groupPointer.current;
                if (!pointer || pointer.id !== group.id) return;
                const dx = (event.clientX - pointer.x) / props.zoom;
                const dy = (event.clientY - pointer.y) / props.zoom;
                groupPointer.current = undefined; setGroupGesture(undefined);
                if (Math.hypot(dx, dy) * props.zoom >= 3)
                  state.change((current) => moveGroup(current, group.id, dx, dy));
              }}
              onPointerCancel={() => { groupPointer.current = undefined; setGroupGesture(undefined); }}>
              <span className="workspace-group-name"><Icon name="workspace" />
                <input aria-label="主题组名称" defaultValue={group.title} key={group.id} maxLength={200}
                  onClick={(event) => event.stopPropagation()}
                  onBlur={(event) => {
                    const title = event.target.value.trim() || "未命名主题";
                    if (title !== actual.title) state.change((current) => ({ ...current,
                      groups: current.groups.map((item) => item.id === group.id ? { ...item, title } : item) }));
                  }}
                  onKeyDown={(event) => { if (event.key === "Enter") event.currentTarget.blur(); }} />
              </span>
              <span className="workspace-group-count">{group.memberIds.length} 项 · {relationCount} 条关系</span>
              <button aria-label={group.collapsed ? "展开主题组" : "折叠主题组"}
                onClick={() => toggleGroup(group.id)}>{group.collapsed ? "展开" : "折叠"}</button>
            </header>
            {!group.collapsed && selectedGroup === group.id && <div className="workspace-group-actions">
              <button onClick={() => autoArrangeGroup(group.id)}>自动排列</button>
              <button onClick={() => setGroupMaterialPreview({ groupId: group.id,
                ids: [...group.memberIds] })}>加入问题</button>
              <button aria-label="更换主题组颜色" onClick={() => {
                const colors = ["#5d83b0", "#9173a8", "#9b7350", "#649481"];
                const color = colors[(colors.indexOf(actual.color) + 1) % colors.length];
                state.change((current) => ({ ...current, groups: current.groups.map((item) =>
                  item.id === group.id ? { ...item, color } : item) }));
              }}>颜色</button>
              <button onClick={() => disbandGroup(group.id)}>解散</button>
            </div>}
          </section>;
        })}
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
            if (selectedLink !== link.id && !inView({ x: Math.min(from.x, to.x), y: Math.min(from.y, to.y),
              width: Math.max(from.x + from.width, to.x + to.width) - Math.min(from.x, to.x),
              height: Math.max(from.y + from.height, to.y + to.height) - Math.min(from.y, to.y) })) return null;
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
        {state.value.objects.filter((object): object is Exclude<WorkspaceObject, InkStroke> =>
          object.kind !== "ink" && object.surface.kind === "board" && !collapsedMemberIds.has(object.id) &&
          objectInView(object))
          .map((object) => <WorkspaceObjectView key={object.id} object={object} pages={layout} zoom={props.zoom}
            offset={groupGesture && state.value!.groups.find((group) => group.id === groupGesture.id)?.memberIds.includes(object.id)
              ? { x: groupGesture.dx, y: groupGesture.dy } : undefined}
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
            tabIndex={-1}
            data-card-id={card.id}
            style={{
              left: card.x,
              top: card.y,
              width: card.width,
              height: card.height,
            }}
            onDoubleClick={() => {
              if (card.kind !== "note") setSourcePreview(card);
              else if (card.noteId) {
                const note = props.notes.notes.find((item) => item.id === card.noteId);
                if (note) props.onExpandNote(note);
              }
            }}
            onPointerDown={(event) => {
              if ((event.target as HTMLElement).closest("input, textarea, [contenteditable=true]")) return;
              if (event.button === 0) {
                event.currentTarget.focus({ preventScroll: true });
                select(card, event.shiftKey);
              }
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
              <div className="workspace-card-association">
                <span>{associatedNotes.get(card.id)?.size ? `关联笔记 · ${associatedNotes.get(card.id)!.size}` : "尚无关联笔记"}</span>
                <button onClick={() => {
                  if (card.noteId) {
                    const note = props.notes.notes.find((item) => item.id === card.noteId);
                    if (note) props.onExpandNote(note);
                  } else void promoteCard(card).catch((error) => setInkError(String(error)));
                }}>{card.noteId ? "查看笔记" : "写笔记"}</button>
                {props.notes.selected &&
                  !associatedNotes.get(card.id)?.has(props.notes.selected) &&
                  <button title="把此摘录作为所选笔记的一处来源" onClick={() =>
                    void attachCardToNote(card, props.notes.selected!).catch((error) => setInkError(String(error)))}>
                    关联到所选笔记
                  </button>}
              </div>
              </>}
            </div>
            <footer>
              {card.source || card.region ? (
                <button
                  className="workspace-source"
                  onClick={() => setSourcePreview(card)}
                  title="预览来源"
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
                      groups: state.value!.groups.map((group) => ({ ...group,
                        memberIds: group.memberIds.filter((id) => id !== card.id) })),
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
      {el?.parentElement && createPortal(<InkCanvas ref={inkCanvas} strokes={visibleStrokes}
        viewport={el} zoom={props.zoom} />, el.parentElement)}
      {el?.parentElement && selectedBounds && selectedBounds.bottom * props.zoom >= el.scrollTop &&
        selectedBounds.y * props.zoom <= el.scrollTop + el.clientHeight && createPortal(
          <WorkspaceObjectActions
            style={{ left: Math.max(8, Math.min(el.clientWidth - 260,
              (selectedBounds.x + selectedBounds.right) / 2 * props.zoom - el.scrollLeft - 130)),
              top: Math.max(8, Math.min(el.clientHeight - 44,
                selectedBounds.y * props.zoom - el.scrollTop - 44)) }}
            count={selectedIds.length}
            fixedSource={selectedIds.some((id) => props.annotations?.some((annotation) => annotation.id === id))}
            annotation={selectedIds.length === 1 ? props.annotations?.find((item) => item.id === selectedIds[0]) : undefined}
            colorObject={colorObject}
            styleObject={styleObject}
            materialBusy={materialBusy}
            canAddToQuestion={Boolean(props.onQuestionMaterials)}
            onSource={sourceAnnotation}
            onAnnotationColor={(annotation, color) => {
              if (!props.onAnnotationColor) return;
              void props.onAnnotationColor(annotation, color).then(() => {
                state.recordExternal({ kind: "external",
                  undo: () => props.onAnnotationColor!(annotation, annotation.color),
                  redo: () => props.onAnnotationColor!(annotation, color),
                });
              }).catch((cause) => setInkError(`批注颜色修改失败：${String(cause)}`));
            }}
            onObjectColor={(color) => {
                const ids = new Set(selectedIds);
                state.change((current) => ({ ...current,
                  objects: current.objects.map((object) => ids.has(object.id) ? { ...object, color } : object),
                }));
            }}
            onUpdateObjects={updateObjects}
            onConnect={() => setLinkFrom(selectedIds[0])}
            onAddToQuestion={() => void addSelectedToQuestion(selectedIds)}
            onDelete={() => void removeSelected()}
          />, el.parentElement)}
      {el?.parentElement && selectedLink && (() => {
        const link = state.value!.links.find((item) => item.id === selectedLink);
        if (!link) return null;
        const from = boundsFor(link.from), to = boundsFor(link.to);
        if (!from || !to) return null;
        return createPortal(<WorkspaceRelationActions link={link} materialBusy={materialBusy}
          canAddToQuestion={Boolean(props.onQuestionMaterials)}
          style={{ left: Math.max(8, Math.min(el.clientWidth - 240,
            ((from.x + from.width / 2 + to.x + to.width / 2) / 2) * props.zoom - el.scrollLeft - 120)),
            top: Math.max(8, Math.min(el.clientHeight - 44,
              ((from.y + from.height / 2 + to.y + to.height / 2) / 2) * props.zoom - el.scrollTop - 44)) }}
          onLabel={(label) => state.change((current) => ({ ...current,
            links: current.links.map((item) => item.id === link.id ? { ...item, label } : item) }))}
          onDirected={(directed) => state.change((current) => ({ ...current,
            links: current.links.map((item) => item.id === link.id ? { ...item, directed } : item) }))}
          onDelete={() => void removeSelected()}
          onAddToQuestion={() => void addSelectedToQuestion([link.id])}
        />, el.parentElement);
      })()}
    </>;
  }
  function move(e: React.PointerEvent) {
    const p = pointer.current;
    if (!p) return;
    const dx = (e.clientX - p.x) / props.zoom,
      dy = (e.clientY - p.y) / props.zoom;
    setGesture(
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
  function beginSurface(surface: "pdf" | "board") {
    pages.current = surface === "pdf" ? pdfPages.current : [];
    gestureZoom.current = surface === "pdf" ? props.pdfZoom : props.zoom;
    projectedInk.current = state.value?.objects.filter((object): object is InkStroke => object.kind === "ink")
      .map((stroke) => projectStroke(stroke, pages.current)) ?? [];
  }
  const paneMode = narrow && props.readerPaneMode === "split" ? narrowPane : props.readerPaneMode;
  const showPdf = paneMode !== "board";
  const showBoard = paneMode !== "pdf";
  const clampSplit = (ratio: number) => Math.max(0.3, Math.min(0.7, Math.round(ratio * 1000) / 1000));
  useEffect(() => {
    const host = props.connectionHost;
    if (!host) return;
    let frame = 0;
    const plain = (rect: DOMRect) => ({ left: Math.round(rect.left), top: Math.round(rect.top),
      width: Math.round(rect.width), height: Math.round(rect.height) });
    const measure = () => {
      frame = 0;
      const hostRect = plain(host.getBoundingClientRect());
      const connections: ConnectionOverlayItem[] = [];
      const cards = state.value?.cards ?? [];
      const cardFor = (id: string) => cards.find((card) => card.id === id || card.noteId === id);
      const cardRect = (card: WorkspaceCard) => {
        const boardCanvas = host.querySelector<HTMLElement>(".board-pane .board-normal-view");
        if (!showBoard || boardCanvas?.hidden) return;
        const element = host.querySelector<HTMLElement>(`.board-pane [data-card-id="${CSS.escape(card.id)}"]`);
        if (element && element.getClientRects().length) return plain(element.getBoundingClientRect());
        const world = host.querySelector<HTMLElement>(".board-pane .pdf-world")?.getBoundingClientRect();
        if (!world) return;
        const folded = state.value?.groups.find((group) => group.collapsed && group.memberIds.includes(card.id));
        const bounds = folded ? { x: folded.x, y: folded.y, width: folded.width, height: 58 } : card;
        return { left: Math.round(world.left + bounds.x * props.zoom),
          top: Math.round(world.top + bounds.y * props.zoom),
          width: Math.round(bounds.width * props.zoom), height: Math.round(bounds.height * props.zoom) };
      };
      const materialRect = (id: string) => {
        const card = cardFor(id);
        if (card) {
          const rect = cardRect(card);
          if (rect) return rect;
        }
        const note = host.closest(".reader-body")?.querySelector<HTMLElement>(
          `.expanded-note[data-note-id="${CSS.escape(id)}"],.notes-list [data-note-id="${CSS.escape(id)}"]`);
        return note && note.getClientRects().length ? plain(note.getBoundingClientRect()) : undefined;
      };
      const frozenIds = new Set((props.questionMaterials ?? []).flatMap((material) =>
        material.targets.map((target) => target.id)));
      const chatHub = props.chatOpen ? host.querySelector<HTMLElement>(".floating-chat .composer-materials") : null;
      const chatRect = chatHub?.getBoundingClientRect();
      const hub = chatRect && chatRect.width ? { x: Math.round(chatRect.left + 22),
        y: Math.round(chatRect.top + Math.min(28, Math.max(12, chatRect.height / 2))) } : undefined;
      if (hub) {
        for (const id of frozenIds) {
          const from = materialRect(id);
          if (from) connections.push({ id: `ai-frozen-${id}`, from, to: hub,
            kind: "ai-frozen", convergeKey: "question-materials" });
        }
        for (const id of new Set([...selectedIds, ...(props.notes.selected ? [props.notes.selected] : [])])) {
          if (frozenIds.has(id)) continue;
          const from = materialRect(id);
          if (from) connections.push({ id: `ai-preview-${id}`, from, to: hub,
            kind: "ai-preview", selected: true, convergeKey: "question-materials" });
        }
      }
      const pdfPane = host.querySelector<HTMLElement>(".pdf-pane");
      const pdfPaneRect = pdfPane?.getBoundingClientRect();
      const worldRect = pdfViewport.current?.querySelector<HTMLElement>(".pdf-world")?.getBoundingClientRect();
      for (const id of selectedIds) {
        const card = cards.find((entry) => entry.id === id && (entry.source || entry.region));
        if (!card) continue;
        const from = cardRect(card);
        if (!from) continue;
        const anchor = card.region ? { page: card.region.page, rects: [card.region.rect] } : card.source?.anchors[0];
        const rect = anchor?.rects[0];
        const page = pdfPages.current.find((entry) => entry.page === anchor?.page);
        if (!anchor || !rect || !page) continue;
        const point = page.toWorld([(rect[0] + rect[2]) / 2, (rect[1] + rect[3]) / 2]);
        const projected = worldRect && { x: Math.round(worldRect.left + point[0] * props.pdfZoom),
          y: Math.round(worldRect.top + point[1] * props.pdfZoom) };
        const visible = showPdf && projected && pdfPaneRect && projected.x >= pdfPaneRect.left &&
          projected.x <= pdfPaneRect.right && projected.y >= pdfPaneRect.top + 44 &&
          projected.y <= pdfPaneRect.bottom;
        const to = visible ? projected! : {
          x: Math.round(showPdf && pdfPaneRect?.width ? pdfPaneRect.right - 12 : hostRect.left + 12),
          y: Math.round(Math.max(hostRect.top + 68, Math.min(hostRect.top + hostRect.height - 18,
            projected?.y ?? from.top + from.height / 2))),
        };
        connections.push({ id: `source-${id}`, from, to, kind: "source", selected: true,
          label: visible ? undefined : `第 ${props.book.labels[anchor.page - 1] ?? anchor.page} 页` });
      }
      const next = { container: hostRect, connections };
      const signature = JSON.stringify(next);
      if (signature !== connectionSignature.current) {
        connectionSignature.current = signature;
        setConnectionView(next);
      }
    };
    const schedule = () => { if (!frame) frame = requestAnimationFrame(measure); };
    schedule();
    host.addEventListener("scroll", schedule, true);
    window.addEventListener("resize", schedule);
    const observer = new MutationObserver(schedule);
    observer.observe(host, { subtree: true, childList: true, attributes: true,
      attributeFilter: ["style", "class", "hidden"] });
    const resize = new ResizeObserver(schedule);
    resize.observe(host);
    return () => {
      cancelAnimationFrame(frame);
      host.removeEventListener("scroll", schedule, true);
      window.removeEventListener("resize", schedule);
      observer.disconnect(); resize.disconnect();
    };
  }, [props.connectionHost, props.questionMaterials, props.chatOpen, props.pdfZoom, props.zoom, props.book.labels,
    selectedIds, props.notes.selected, state.value?.cards, showPdf, showBoard, comparing]);
  return (
    <>
      {props.connectionHost && connectionView && createPortal(<ConnectionOverlay
        container={connectionView.container} connections={connectionView.connections} />, props.connectionHost)}
      <div ref={splitRoot} className="reader-split" style={{ "--reader-split-ratio": splitDraft } as CSSProperties}>
        {narrow && <div className="reader-pane-tabs" role="tablist" aria-label="阅读区域">
          <button role="tab" aria-selected={showPdf} onClick={() => { setNarrowPane("pdf"); props.onReaderPaneMode("split"); }}>原文</button>
          <button role="tab" aria-selected={showBoard}
            onDragOver={(event) => { if (event.dataTransfer.types.includes("application/x-aireader-excerpt")) setNarrowPane("board"); }}
            onClick={() => { setNarrowPane("board"); props.onReaderPaneMode("split"); }}>工作台</button>
        </div>}
        <section className="reader-pane pdf-pane" aria-label="原文" hidden={!showPdf}>
          <header className="reader-pane-header">
            <span><Icon name="book" /> 原文 <small>第 {props.page} 页</small></span>
            <div className="reader-pane-actions">
              {locatingPage && <span className="reader-source-loading" role="status">正在定位第 {props.book.labels[locatingPage - 1] ?? locatingPage} 页…</span>}
              {sourceFocus?.length && <button aria-label="聚焦当前来源" onClick={() => enterFocus(sourceFocus)}>聚焦</button>}
              <button aria-label="缩小原文" onClick={() => props.onPdfZoom(Math.max(0.4, props.pdfZoom - 0.1))}>−</button>
              <output aria-label="原文缩放">{Math.round(props.pdfZoom * 100)}%</output>
              <button aria-label="放大原文" onClick={() => props.onPdfZoom(Math.min(3, props.pdfZoom + 0.1))}>+</button>
              {!narrow && <button aria-label={paneMode === "pdf" ? "恢复双栏" : "最大化原文"}
                onClick={() => props.onReaderPaneMode(paneMode === "pdf" ? "split" : "pdf")}>{paneMode === "pdf" ? "◧" : "□"}</button>}
            </div>
          </header>
          <div className="pdf-normal-view" hidden={!!focusAnchors}>
          <PdfReader {...props} zoom={props.pdfZoom} onZoom={props.onPdfZoom} onRegionAction={regionAction}
            workspace={{
              mode: "document", ready: !!state.value, onDocumentWidth: setDocumentWidth,
              onCamera: () => {}, width: WORKSPACE_DOCUMENT_X * 2 + documentWidth,
              height: 0,
              render: (layout, el) => {
                pdfPages.current = layout; pdfViewport.current = el;
                const pending = pendingLocate.current;
                if (pending && layout.some((page) => page.page === pending[0]?.page)) {
                  pendingLocate.current = undefined;
                  queueMicrotask(() => { if (mounted.current) locateAnchors(pending); });
                } else if (pendingPage.current && layout.some((page) => page.page === pendingPage.current)) {
                  const pageNumber = pendingPage.current;
                  pendingPage.current = undefined;
                  queueMicrotask(() => { if (mounted.current) jumpPage(pageNumber); });
                }
                return null;
              },
              sourceFocus,
              ink: state.value?.objects.filter((object): object is InkStroke => object.kind === "ink"),
              marks: state.value?.objects.filter((object): object is Exclude<WorkspaceObject, InkStroke> => object.kind !== "ink"),
              onInkStart: (point) => { beginSurface("pdf"); return startInk(point); },
              onInkMove: moveInk, onInkEnd: finishInk, onInkCancel: cancelInk,
              onCanvasStart: (point, shift, target) => { beginSurface("pdf"); return startCanvas(point, shift, target); },
              onCanvasMove: moveCanvas, onCanvasEnd: endCanvas, onCanvasCancel: cancelCanvas,
              onAnnotationTarget: (id) => selectTarget(id),
            }} />
          </div>
          {focusAnchors && <div className="pdf-focus-view"><FocusPdfDocument bookId={props.book.id}
            anchors={focusAnchors} pageLabels={props.book.labels} rotation={props.rotation}
            onGoToOriginal={(region) => {
              setFocusAnchors(undefined);
              requestAnimationFrame(() => locateAnchors([{ page: region.page, rects: [region.pdfRect] }]));
            }}
            onClose={() => setFocusAnchors(undefined)} /></div>}
        </section>
        {!narrow && paneMode === "split" && <div className="reader-pane-separator" role="separator" tabIndex={0}
          aria-label="调整原文与工作台宽度" aria-orientation="vertical" aria-valuemin={30} aria-valuemax={70}
          aria-valuenow={Math.round(splitDraft * 100)}
          onKeyDown={(event) => {
            if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
            event.preventDefault();
            const next = event.key === "Home" ? 0.3 : event.key === "End" ? 0.7 :
              clampSplit(splitDraft + (event.key === "ArrowRight" ? 0.02 : -0.02));
            setSplitDraft(next); props.onSplitRatio(next);
          }}
          onPointerDown={(event) => {
            if (event.button !== 0) return;
            event.preventDefault(); event.currentTarget.setPointerCapture(event.pointerId);
            splitDrag.current = event.pointerId;
          }}
          onPointerMove={(event) => {
            if (splitDrag.current !== event.pointerId || !splitRoot.current) return;
            const rect = splitRoot.current.getBoundingClientRect();
            setSplitDraft(clampSplit((event.clientX - rect.left) / rect.width));
          }}
          onPointerUp={(event) => {
            if (splitDrag.current !== event.pointerId) return;
            splitDrag.current = undefined; event.currentTarget.releasePointerCapture(event.pointerId);
            props.onSplitRatio(splitDraft);
          }}
          onPointerCancel={() => { splitDrag.current = undefined; setSplitDraft(props.splitRatio); }} />}
        <section ref={props.onBoardHost} className="reader-pane board-pane" aria-label="工作台" hidden={!showBoard}>
          <header className="reader-pane-header">
            <span><Icon name="workspace" /> 工作台 <small>{state.value?.cards.length ?? 0} 张卡片</small></span>
            <div className="reader-pane-actions">
              <button className="reader-pane-new-note" aria-label="新建笔记" title="新建笔记" onClick={() => add()}><Icon name="plus" /></button>
              <button className="reader-pane-secondary" aria-label="将所选材料建为主题组" title="将所选材料建为主题组"
                disabled={!selectedIds.some((id) => state.value && boardMemberBounds(state.value, id))}
                onClick={createThemeGroup}>分组</button>
              <button className="reader-pane-secondary" aria-label="比较所选摘录" disabled={selectedIds.filter((id) =>
                state.value?.cards.some((card) => card.id === id && (card.kind === "excerpt" || card.kind === "region"))).length < 2}
                onClick={() => setComparing(selectedIds.filter((id) => state.value?.cards.some((card) =>
                  card.id === id && (card.kind === "excerpt" || card.kind === "region"))).slice(0, 3))}>比较</button>
              <button className="reader-pane-secondary" aria-label="聚焦所选摘录的原文" disabled={!selectedIds.some((id) => state.value?.cards.some((card) =>
                card.id === id && (card.source || card.region)))}
                onClick={() => enterFocus(state.value?.cards.filter((card) => selectedIds.includes(card.id)).flatMap((card) =>
                  card.region ? [{ page: card.region.page, rects: [card.region.rect] }] : card.source?.anchors ?? []) ?? [])}>聚焦</button>
              {selectedGroup && <button className="reader-pane-secondary" aria-label="排列所选主题组" onClick={() => autoArrangeGroup(selectedGroup)}>排列</button>}
              <button className="reader-pane-secondary" aria-label="适应工作台内容" title="适应工作台内容" onClick={overview}><Icon name="fit" /></button>
              <Popover label="更多工作台操作" triggerClass="reader-pane-more" trigger={<Icon name="more" />}
                role="menu" width={230} autoFocusFirst>
                {(close) => <div className="reader-context-menu">
                  <button role="menuitem" onClick={() => { add(); close(); }}>新建笔记</button>
                  <button role="menuitem" disabled={!selectedIds.some((id) => state.value && boardMemberBounds(state.value, id))}
                    onClick={() => { createThemeGroup(); close(); }}>将所选材料建为主题组</button>
                  <button role="menuitem" disabled={selectedIds.filter((id) => state.value?.cards.some((card) =>
                    card.id === id && (card.kind === "excerpt" || card.kind === "region"))).length < 2}
                    onClick={() => { setComparing(selectedIds.filter((id) => state.value?.cards.some((card) =>
                      card.id === id && (card.kind === "excerpt" || card.kind === "region"))).slice(0, 3)); close(); }}>并排比较</button>
                  <button role="menuitem" disabled={!selectedIds.some((id) => state.value?.cards.some((card) =>
                    card.id === id && (card.source || card.region)))}
                    onClick={() => { enterFocus(state.value?.cards.filter((card) => selectedIds.includes(card.id))
                      .flatMap((card) => card.region ? [{ page: card.region.page, rects: [card.region.rect] }] :
                        card.source?.anchors ?? []) ?? []); close(); }}>聚焦原文</button>
                  {selectedGroup && <button role="menuitem" onClick={() => { autoArrangeGroup(selectedGroup); close(); }}>排列主题组</button>}
                  <button role="menuitem" onClick={() => { overview(); close(); }}>适应全部内容</button>
                </div>}
              </Popover>
              <button aria-label="缩小工作台" onClick={() => props.onZoom?.(Math.max(0.4, props.zoom - 0.1))}>−</button>
              <output aria-label="工作台缩放">{Math.round(props.zoom * 100)}%</output>
              <button aria-label="放大工作台" onClick={() => props.onZoom?.(Math.min(3, props.zoom + 0.1))}>+</button>
              {!narrow && <button aria-label={paneMode === "board" ? "恢复双栏" : "最大化工作台"}
                onClick={() => props.onReaderPaneMode(paneMode === "board" ? "split" : "board")}>{paneMode === "board" ? "◧" : "□"}</button>}
            </div>
          </header>
          <div className="board-normal-view" hidden={!!comparing}
            onDragOver={(event) => {
              if (props.draggedExcerpt?.bookId !== props.book.id ||
                  !event.dataTransfer.types.includes("application/x-aireader-excerpt")) return;
              event.preventDefault();
              event.dataTransfer.dropEffect = "copy";
            }}
            onDrop={(event) => {
              if (props.draggedExcerpt?.bookId !== props.book.id ||
                  !event.dataTransfer.types.includes("application/x-aireader-excerpt")) return;
              event.preventDefault();
              const world = viewport.current?.querySelector<HTMLElement>(".pdf-world")?.getBoundingClientRect();
              if (!world) return;
              add(props.draggedExcerpt.selection, [
                (event.clientX - world.left) / props.zoom,
                (event.clientY - world.top) / props.zoom,
              ]);
              props.onExcerptDrop?.();
            }}>
          <PdfReader {...props} onPage={() => {}} onSelection={() => {}}
            workspace={{
              mode: "board", ready: !!state.value, camera: state.value?.camera,
              onDocumentWidth: () => {}, navigation,
              onCamera: (camera) => {
                if (state.value && (state.value.camera?.x !== camera.x || state.value.camera?.y !== camera.y ||
                  state.value.camera?.zoom !== camera.zoom))
                  state.change((current) => ({ ...current, camera }), false);
              },
              width: Math.max(2400, ...(state.value?.cards.map((card) => card.x + card.width + 200) ?? [])),
              height: Math.max(1800, ...(state.value?.cards.map((card) => card.y + card.height + 200) ?? [])),
              render: overlay,
              onInkStart: (point) => { beginSurface("board"); return startInk(point); },
              onInkMove: moveInk, onInkEnd: finishInk, onInkCancel: cancelInk,
              onCanvasStart: (point, shift, target) => { beginSurface("board"); return startCanvas(point, shift, target); },
              onCanvasMove: moveCanvas, onCanvasEnd: endCanvas, onCanvasCancel: cancelCanvas,
            }} />
          </div>
          {comparing && <div className="board-compare-view"><CompareView
            cards={state.value?.cards.filter((card) => comparing.includes(card.id)) ?? []}
            pageLabels={props.book.labels}
            imageUrl={(assetId) => `${base}/api/books/${props.book.id}/workspace-assets/${assetId}`}
            notesForCard={(cardId) => {
              const card = state.value?.cards.find((item) => item.id === cardId);
              return card ? relatedComparisonNotes(card, props.notes.notes) : [];
            }}
            onOpenNote={(noteId) => {
              const note = props.notes.notes.find((item) => item.id === noteId);
              if (note) props.onExpandNote(note);
            }}
            onSource={locateAnchors} onClose={() => setComparing(undefined)} /></div>}
          {sourcePreview && <aside className="workspace-source-preview" aria-label="摘录来源预览">
            <header>
              <div><small>原文来源</small><strong>第 {props.book.labels[(sourcePreview.region?.page ?? sourcePreview.source?.anchors[0]?.page ?? 1) - 1] ??
                (sourcePreview.region?.page ?? sourcePreview.source?.anchors[0]?.page ?? 1)} 页</strong></div>
              <button aria-label="关闭来源预览" onClick={() => setSourcePreview(undefined)}><Icon name="close" /></button>
            </header>
            {sourcePreview.kind === "region" && sourcePreview.region
              ? <img src={`${base}/api/books/${props.book.id}/workspace-assets/${sourcePreview.region.assetId}`}
                alt="摘录的原文图表" />
              : <blockquote>{sourcePreview.text}</blockquote>}
            <footer>
              <button onClick={() => setSourcePreview(undefined)}>留在工作台</button>
              <button onClick={() => { const card = sourcePreview;
                enterFocus(card.region ? [{ page: card.region.page, rects: [card.region.rect] }] : card.source?.anchors ?? []);
                setSourcePreview(undefined); }}>聚焦原文</button>
              <button className="primary" onClick={() => { goToSource(sourcePreview); setSourcePreview(undefined); }}>前往原文</button>
            </footer>
          </aside>}
          {groupMaterialPreview && <aside className="workspace-source-preview workspace-group-material-preview"
            role="dialog" aria-label="选择主题组问题材料">
            <header><div><small>加入本轮问题</small><strong>{state.value?.groups.find((group) => group.id === groupMaterialPreview.groupId)?.title ?? "主题组"}</strong></div>
              <button aria-label="关闭材料清单" onClick={() => setGroupMaterialPreview(undefined)}><Icon name="close" /></button></header>
            <div className="workspace-group-material-list">
              {state.value?.groups.find((group) => group.id === groupMaterialPreview.groupId)?.memberIds.map((id) => {
                const card = state.value?.cards.find((item) => item.id === id);
                const object = state.value?.objects.find((item) => item.id === id);
                const title = card?.title || (object?.kind === "text" ? object.text.slice(0, 50) : object ? "绘图对象" : "已移除材料");
                return <label key={id}><input type="checkbox" checked={groupMaterialPreview.ids.includes(id)}
                  onChange={(event) => setGroupMaterialPreview((old) => old && ({ ...old,
                    ids: event.target.checked ? [...old.ids, id] : old.ids.filter((item) => item !== id) }))} />
                  <span>{title}</span></label>;
              })}
            </div>
            <footer><span>{groupMaterialPreview.ids.length} 项已选</span>
              <button className="primary" disabled={!groupMaterialPreview.ids.length || materialBusy}
                onClick={() => void addSelectedToQuestion(groupMaterialPreview.ids).then((saved) => {
                  if (saved) setGroupMaterialPreview(undefined);
                })}>确认加入问题</button></footer>
          </aside>}
        </section>
      </div>
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
        <button role="menuitem" disabled={!selectedIds.length}
          onClick={() => { createThemeGroup(); close(); }}>
          <Icon name="workspace" /> 将所选材料建为主题组
        </button>
        {selectedGroup && <button role="menuitem" onClick={() => { autoArrangeGroup(selectedGroup); close(); }}>
          <Icon name="fit" /> 自动排列主题组
        </button>}
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
          aria-label="原文聚焦"
          title="查看所选摘录附近的原始页面区域"
          role="menuitem"
          disabled={!sourceFocus?.length && !selectedIds.some((id) => state.value?.cards.some((card) =>
            card.id === id && (card.source || card.region)))}
          onClick={() => { enterFocus(sourceFocus?.length ? sourceFocus : state.value?.cards
            .filter((card) => selectedIds.includes(card.id))
            .flatMap((card) => card.region ? [{ page: card.region.page, rects: [card.region.rect] }] :
              card.source?.anchors ?? []) ?? []); close(); }}
        >
          <Icon name="focus" /> 原文聚焦
        </button>
        {returnPosition && (
          <button
            role="menuitem"
            onClick={() => {
              pdfViewport.current?.scrollTo({
                left: returnPosition.x * props.pdfZoom,
                top: returnPosition.y * props.pdfZoom,
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
          {state.value?.groups.map((group) => <button key={group.id} onClick={() => {
            navigate(Math.max(0, group.x - 40), Math.max(0, group.y - 40), 1);
            setSelectedGroup(group.id); setShowOverview(false);
          }}><Icon name="workspace" /><span>{group.title}<small>{group.memberIds.length} 项材料</small></span></button>)}
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
      {props.feedbackHost && (exportError || inkError || linkFrom || state.error) &&
        createPortal(<div className="workspace-feedback">
            {exportError && <div className="workspace-error" role="alert">{exportError}
              <button onClick={() => setExportError("")} aria-label="关闭打包错误"><Icon name="close" /></button>
            </div>}
            {inkError && <div className="workspace-error" role="alert">{inkError}
              <button onClick={() => setInkError("")} aria-label="关闭笔迹错误"><Icon name="close" /></button>
            </div>}
            {linkFrom && <div className="workspace-notice">点击另一张卡片建立连接{" "}
              <button onClick={() => setLinkFrom(undefined)}>取消</button>
            </div>}
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
          </div>, props.feedbackHost)}
    </>
  );
});
