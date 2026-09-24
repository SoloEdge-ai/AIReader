import { useCallback, useEffect, useRef, useState } from "react";
import {
  ReaderPreferencesSchema,
  type ReaderPreferences,
  type Book,
  type Bookmark,
  type Passage,
  type SourceAnchor,
  type CoreEvent,
  type ReadingSelection,
  type Annotation,
  type AnnotationInputSchema,
  type Note,
  type QuestionMaterialInput,
  type QuestionMaterialSnapshot,
  ToolPreferencesSchema,
  type ToolPreferences,
} from "../../../packages/protocol/src";
import type { z } from "zod";
import { api, post, base } from "./api";
import { type QuestionRegion } from "./PdfReader";
import { NotesPanel } from "./NotesPanel";
import { useBookNotes } from "./features/notes/useBookNotes";
import { ExpandedNote } from "./features/notes/ExpandedNote";
import { ChatPanel, type SelectionAction } from "./ChatPanel";
import { QuestionDraftStore } from "./QuestionDrafts";
import { PanelResizer } from "./PanelResizer";
import { BookCover } from "./BookCover";
import { Icon } from "./ui/Icon";
import { Settings } from "./Settings";
import { AccountControls } from "./AiState";
import { IndexPanel } from "./IndexPanel";
import { ToolPanel } from "./ToolPanel";
import { BookWorkspace, type BookWorkspaceHandle } from "./BookWorkspace";
import { WorkspaceRestore } from "./WorkspaceRestore";
import { ReaderToolPalette } from "./ReaderToolPalette";
import { SelectionToolbar } from "./SelectionToolbar";
import { useReaderToolController } from "./ReaderToolController";
export function App() {
  const workspace = useRef<BookWorkspaceHandle>(null);
  const [workspaceToolbarHost, setWorkspaceToolbarHost] = useState<HTMLDivElement | null>(null);
  const [navigating, setNavigating] = useState(false);
  const [books, setBooks] = useState<Book[]>([]),
    [active, setActive] = useState<string>();
  const [prefs, setPrefs] = useState(() => ReaderPreferencesSchema.parse({})),
    [layout, setLayout] = useState(() => ReaderPreferencesSchema.parse({}));
  const [settings, setSettings] = useState(false),
    [bookMenu, setBookMenu] = useState(false),
    [filter, setFilter] = useState("");
  const [page, setPage] = useState(1),
    [pageInput, setPageInput] = useState("1"),
    [nav, setNav] = useState("目录");
  const [query, setQuery] = useState(""),
    [hits, setHits] = useState<Passage[]>([]),
    [marks, setMarks] = useState<Bookmark[]>([]);
  const [selection, setSelection] = useState<ReadingSelection>(),
    [action, setAction] = useState<SelectionAction>();
  const [questionDrafts] = useState(() => new QuestionDraftStore());
  const [chatSessions, setChatSessions] = useState<Record<string, string>>({});
  const [questionCapture, setQuestionCapture] = useState<{
    bookId: string;
    fingerprint: string;
    sessionId: string;
  }>();
  const [viewportWidth, setViewportWidth] = useState(window.innerWidth);
  useEffect(() => {
    const resize = () => setViewportWidth(window.innerWidth);
    window.addEventListener("resize", resize);
    return () => window.removeEventListener("resize", resize);
  }, []);
  const maxPanelWidth = Math.round(
    Math.max(
      320,
      Math.min(
        1600,
        viewportWidth <= 1180
          ? viewportWidth * 0.9
          : viewportWidth - 408 - (layout.navigation ? 240 : 0),
      ),
    ),
  );
  const panelWidth = Math.min(layout.panelWidth, maxPanelWidth);
  const clearSelection = useCallback(() => {
    setSelection(undefined);
    getSelection()?.removeAllRanges();
  }, []);
  const [highlight, setHighlight] = useState<SourceAnchor>(),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  const input = useRef<HTMLInputElement>(null),
    current = useRef(active),
    sequence = useRef(0),
    saveTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  current.current = active;
  const book = books.find((b) => b.id === active);
  const notes = useBookNotes(active);
  const [expandedNote, setExpandedNote] = useState<{ bookId: string; id: string }>();
  const expanded = expandedNote && expandedNote.bookId === active ? notes.notes.find((note) => note.id === expandedNote.id) : undefined;
  const [annotationColor, setAnnotationColor] =
    useState<Annotation["color"]>("yellow");
  const [workspaceEvents, setWorkspaceEvents] = useState<Record<string, number>>({});
  const openSequence = useRef(0);
  const readerTools = useReaderToolController({
    bookId: active,
    clearSelection,
    cancelExternal: () => setQuestionCapture(undefined),
    onEscape: (event) => {
      if (document.querySelector('dialog[open],[aria-modal="true"]')) return false;
      const popover = document.querySelector<HTMLElement>("[popover]:popover-open");
      if (popover) {
        event.preventDefault();
        popover.hidePopover();
        Array.from(document.querySelectorAll<HTMLButtonElement>("button[popovertarget]"))
          .find((button) => button.getAttribute("popovertarget") === popover.id)
          ?.focus({ preventScroll: true });
      }
      const editing = (event.target as HTMLElement)?.closest(".workspace-card input,.workspace-card textarea,.notes-panel input,.notes-panel textarea,.notes-panel [contenteditable]");
      if (editing) {
        (editing as HTMLElement).blur();
        void Promise.all([workspace.current?.flush(), notes.flush()]).then((results) => {
          if (results.some((ok) => ok === false)) setError("编辑内容保存失败，草稿仍保留；请重试保存。");
        });
      } else if (!popover && !(event.target as HTMLElement)?.closest(".reader-popover") &&
                 (event.target as HTMLElement)?.closest("input,textarea,select,[contenteditable]")) return false;
      if (questionCapture) cancelQuestionCapture();
      workspace.current?.escape();
      return true;
    },
  });
  const {
    tool: mode,
    preferences: toolPreferences,
    setPreferences: setToolPreferences,
    selectionPinned,
  } = readerTools;
  function cancelQuestionCapture() {
    setQuestionCapture(undefined);
    readerTools.finish();
    if (questionCapture?.bookId === active && viewportWidth <= 1180)
      updateLayout({ ...layout, panel: "chat" });
  }
  function updateToolPreferences(next: ToolPreferences) {
    setToolPreferences(next);
    void api<ToolPreferences>("tool-preferences", { method: "PUT", body: JSON.stringify(next) })
      .catch((e) => setError(`工具盘设置未保存：${String(e)}`));
  }
  async function ensureQuestionSession(bookId: string) {
    const sessions = await api<{ id: string }[]>(`books/${bookId}/sessions`);
    const preferred = chatSessions[bookId] ?? localStorage.getItem(`session-${bookId}`);
    const selected = sessions.find((session) => session.id === preferred) ??
      sessions[0] ?? await post<{ id: string }>(`books/${bookId}/sessions`, {});
    localStorage.setItem(`session-${bookId}`, selected.id);
    setChatSessions((old) => old[bookId] === selected.id ? old : { ...old, [bookId]: selected.id });
    return selected.id;
  }
  async function addQuestionMaterials(bookId: string, selection: Pick<QuestionMaterialInput,
    "workspaceRevision" | "targets" | "previews">) {
    const sessionId = await ensureQuestionSession(bookId);
    const snapshot = await post<QuestionMaterialSnapshot>(`books/${bookId}/question-materials`, {
      bookId, sessionId, requestId: crypto.randomUUID(), ...selection,
    });
    const key = `${bookId}:${sessionId}`;
    if (!questionDrafts.addMaterial(key, snapshot))
      throw new Error(questionDrafts.get(key).materialError ?? "本轮材料已满");
    if (current.current === bookId) updateLayout({ ...layout, panel: "chat" });
  }
  useEffect(() => {
    if (layout.panel === "notes") setQuestionCapture(undefined);
  }, [layout.panel]);
  function startQuestionCapture(sessionId: string) {
    if (!book) return;
    readerTools.finish("region");
    setQuestionCapture({
      bookId: book.id,
      fingerprint: book.fingerprint,
      sessionId,
    });
    if (viewportWidth <= 1180) updateLayout({ ...layout, panel: "none" });
    requestAnimationFrame(() =>
      document
        .querySelector<HTMLElement>(".pdf-scroll")
        ?.focus({ preventScroll: true }),
    );
  }
  function addQuestionRegion(region: QuestionRegion) {
    const target = questionCapture;
    if (
      !target ||
      target.bookId !== current.current ||
      localStorage.getItem("session-" + target.bookId) !== target.sessionId
    )
      return;
    setQuestionCapture(undefined);
    readerTools.finish();
    const bytes = Uint8Array.from(atob(region.image.split(",")[1]), (c) =>
      c.charCodeAt(0),
    );
    const name = `第 ${book?.labels[region.page - 1] ?? region.page} 页区域.png`;
    // The destination is frozen when capture begins, including during async image preparation.
    void questionDrafts.addImages(
      `${target.bookId}:${target.sessionId}`,
      [new File([bytes], name, { type: "image/png" })],
      {
        kind: "pdf-region",
        bookId: target.bookId,
        fingerprint: target.fingerprint,
        page: region.page,
        rect: region.rect,
      },
    );
    updateLayout({ ...layout, panel: "chat" });
  }
  async function handleWorkspaceRegion(region: QuestionRegion, action: "card" | "question" | "annotation", includePersonalMarks: boolean) {
    if (!book || current.current !== book.id) throw new Error("书籍已切换，请重新选择区域");
    if (action !== "question") { readerTools.finish(); return; }
    const bookId = book.id, fingerprint = book.fingerprint;
    let sessionId = localStorage.getItem("session-" + bookId);
    if (!sessionId) {
      const session = await post<{ id: string }>(`books/${bookId}/sessions`, {});
      sessionId = session.id;
      localStorage.setItem("session-" + bookId, sessionId);
    }
    const bytes = Uint8Array.from(atob(region.image.split(",")[1]), (char) => char.charCodeAt(0));
    const name = `第 ${book.labels[region.page - 1] ?? region.page} 页区域${includePersonalMarks ? "（含个人标注）" : ""}.png`;
    const key = `${bookId}:${sessionId!}`;
    await questionDrafts.addImages(key, [new File([bytes], name, { type: "image/png" })], {
      kind: "pdf-region", bookId, fingerprint, page: region.page, rect: region.rect,
    });
    if (questionDrafts.get(key).imageError) throw new Error(questionDrafts.get(key).imageError);
    if (current.current === bookId && localStorage.getItem("session-" + bookId) === sessionId) {
      readerTools.finish();
      updateLayout({ ...layout, panel: "chat" });
    }
  }
  async function openSavedNote(note: Note) {
    if (note.bookId !== current.current) return;
    if (!(await notes.flush()))
      throw new Error("笔记已保存，请先处理尚未保存的草稿，再打开笔记。");
    await notes.refresh();
    if (note.bookId !== current.current) return;
    notes.setSelected(note.id);
    updateLayout({ ...layout, panel: "notes" });
  }
  async function createAnnotation(
    value: z.infer<typeof AnnotationInputSchema>,
  ) {
    const id = active;
    try {
      if (!id || !(await notes.flush())) return false;
      const a = await post<Annotation>(`books/${id}/annotations`, {
        ...value,
        color: annotationColor,
      });
      if (current.current !== id) return false;
      notes.recordUndo(() =>
        api(`books/${id}/annotations/${a.id}`, { method: "DELETE" }),
      );
      await notes.refresh();
      notes.setSelected(a.noteId);
      readerTools.finish(value.kind === "sticky" || value.kind === "region" ? "pointer" : "text");
      updateLayout({ ...layout, panel: "notes" });
      return true;
    } catch (e) {
      setError(String(e));
      return false;
    }
  }
  useEffect(() => {
    let socket: WebSocket;
    let live = true;
    void post("session", {})
      .then(async () => {
        const [list, p, toolPrefs] = await Promise.all([
          api<Book[]>("books"),
          api<ReaderPreferences>("preferences"),
          api<ToolPreferences>("tool-preferences"),
        ]);
        if (!live) return;
        setBooks(list);
        setPrefs(p);
        setToolPreferences(ToolPreferencesSchema.parse(toolPrefs));
        socket = new WebSocket(
          (base || location.origin).replace("http:", "ws:") + "/events",
        );
        socket.onmessage = (e) => {
          const event = JSON.parse(e.data) as CoreEvent;
          if (event.type === "book")
            setBooks((old) => {
              const b = event.data;
              return [...old.filter((x) => x.id !== b.id), b];
            });
          if (event.type === "workspace" && event.bookId)
            setWorkspaceEvents((old) => ({ ...old,
              [event.bookId!]: (old[event.bookId!] ?? 0) + 1 }));
        };
      })
      .catch((e) => setError(e.message));
    return () => {
      live = false;
      socket?.close();
    };
  }, []);
  useEffect(() => {
    const media = matchMedia("(prefers-color-scheme: dark)");
    const update = () => {
      document.documentElement.dataset.theme =
        prefs.theme === "system"
          ? media.matches
            ? "dark"
            : "light"
          : prefs.theme;
    };
    update();
    media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, [prefs.theme]);
  useEffect(() => setPageInput(String(page)), [page]);
  useEffect(() => {
    if (!active || !book || !["queued", "parsing"].includes(book.status))
      return;
    let live = true,
      updating = false;
    const refresh = async () => {
      if (!live || updating) return;
      updating = true;
      try {
        const value = await api<Book>(`books/${active}`);
        if (live)
          setBooks((old) => old.map((b) => (b.id === value.id ? value : b)));
      } catch {
        /* The event stream or the next poll can recover a transient disconnect. */
      } finally {
        updating = false;
      }
    };
    void refresh();
    const timer = setInterval(() => void refresh(), 1500);
    return () => {
      live = false;
      clearInterval(timer);
    };
  }, [active, book?.status]);
  useEffect(() => {
    let live = true;
    setExpandedNote(undefined);
    setSelection(undefined);
    setAction(undefined);
    setMarks([]);
    setHits([]);
    setQuery("");
    setHighlight(undefined);
    setBookMenu(false);
    setQuestionCapture(undefined);
    if (active)
      void api<Bookmark[]>(`books/${active}/bookmarks`)
        .then((v) => {
          if (live) setMarks(v);
        })
        .catch((e) => setError(e.message));
    return () => {
      live = false;
      clearTimeout(saveTimer.current);
    };
  }, [active]);
  const onPage = useCallback(
    (n: number) => {
      setPage(n);
      clearTimeout(saveTimer.current);
      if (active)
        saveTimer.current = setTimeout(
          () =>
            void post(`books/${active}/progress`, { page: n }).catch((e) =>
              setError(e.message),
            ),
          400,
        );
    },
    [active],
  );
  const updateLayout = (p: ReaderPreferences) => {
    if (layout.panel === "notes" && p.panel !== "notes") {
      void notes.flush().then((ok) => {
        if (ok) persistLayout(p);
      });
      return;
    }
    persistLayout(p);
  };
  const persistLayout = (p: ReaderPreferences) => {
    setLayout(p);
    if (active)
      void post(`books/${active}/preferences`, p).catch((e) =>
        setError(e.message),
      );
  };
  const updatePrefs = (p: ReaderPreferences) => {
    setPrefs(p);
    void post("preferences", p).catch((e) => setError(e.message));
  };
  async function openBook(b: Book) {
    const request = ++openSequence.current;
    setNavigating(true);
    try {
      if (!(await notes.flush())) return;
      if (workspace.current && !(await workspace.current.flush())) return;
      const p = await api<ReaderPreferences>(`books/${b.id}/preferences`);
      if (request !== openSequence.current) return;
      setLayout(p);
      setPage(b.progress);
      setActive(b.id);
      await post(`books/${b.id}/open`, {});
    } catch (e) {
      setError(String(e));
    } finally {
      if (request === openSequence.current) setNavigating(false);
    }
  }
  const jump = (n: number, anchor?: SourceAnchor) => {
    if (
      !book ||
      !Number.isFinite(n) ||
      n < 1 ||
      n > book.pages ||
      (anchor && anchor.bookId !== active)
    )
      return;
    document.getElementById("page-" + n)?.scrollIntoView({ block: "start" });
    setPage(n);
    setHighlight(anchor);
  };
  async function search() {
    const id = active,
      request = ++sequence.current;
    try {
      const values = await api<Passage[]>(
        `books/${id}/search?q=${encodeURIComponent(query)}`,
      );
      if (current.current === id && sequence.current === request)
        setHits(values);
    } catch (e) {
      setError(String(e));
    }
  }
  async function upload(file: File) {
    setBusy(true);
    setError("");
    try {
      const b = await api<Book>("books", {
        method: "POST",
        headers: {
          "Content-Type": "application/pdf",
          "X-Filename": encodeURIComponent(file.name),
        },
        body: file,
      });
      setBooks(await api<Book[]>("books"));
      await openBook(b);
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  }
  const togglePanel = () =>
    updateLayout({
      ...layout,
      panel: layout.panel === "none" ? "chat" : "none",
    });
  const visibleBooks = [...books]
    .filter((b) =>
      b.title.toLocaleLowerCase().includes(filter.toLocaleLowerCase()),
    )
    .sort((a, b) =>
      (b.lastOpenedAt ?? b.createdAt).localeCompare(
        a.lastOpenedAt ?? a.createdAt,
      ),
    );
  return (
    <>
      <input
        ref={input}
        hidden
        type="file"
        accept="application/pdf"
        onChange={(e) => {
          if (e.target.files?.[0]) void upload(e.target.files[0]);
          e.target.value = "";
        }}
      />
      {!book ? (
        <main
          className="library"
          onDragOver={(e) => e.preventDefault()}
          onDrop={(e) => {
            e.preventDefault();
            if (e.dataTransfer.files[0]) void upload(e.dataTransfer.files[0]);
          }}
        >
          <header className="app-header">
            <span className="brand">
              <Icon name="book" />
              AIReader
            </span>
            <button aria-label="设置" onClick={() => setSettings(true)}>
              <Icon name="settings" />
            </button>
          </header>
          <div className="library-heading">
            <div>
              <h1>书库</h1>
              <p className="muted">
                {books.length ? `${books.length} 本 · 最近阅读` : ""}
              </p>
            </div>
            <div className="library-actions">
              <WorkspaceRestore
                disabled={busy}
                onError={setError}
                onRestore={async (restored) => {
                  setBooks(await api<Book[]>("books"));
                  await openBook(restored);
                }}
              />
              <label className="search-box">
                <Icon name="search" />
                <input
                  aria-label="搜索书库"
                  placeholder="搜索书籍"
                  value={filter}
                  onChange={(e) => setFilter(e.target.value)}
                />
              </label>
              <button
                className="primary"
                disabled={busy}
                onClick={() => input.current?.click()}
              >
                <Icon name="plus" />
                {busy ? "导入中…" : "导入 PDF"}
              </button>
            </div>
          </div>
          {visibleBooks.length ? (
            <div className="book-grid">
              {visibleBooks.map((b) => (
                <button
                  className="book-card"
                  key={b.id}
                  onClick={() => void openBook(b)}
                >
                  <div className="book-cover">
                    <BookCover id={b.id} />
                  </div>
                  <strong title={b.title}>{b.title}</strong>
                  <span className="muted">
                    {b.pages || "—"} 页 ·{" "}
                    {b.status === "error"
                      ? "无法解析"
                      : b.progress > 1
                        ? `第 ${b.progress} 页`
                        : "尚未阅读"}
                  </span>
                  <progress
                    value={b.progress > 1 ? b.progress : 0}
                    max={b.pages || 1}
                  />
                </button>
              ))}
            </div>
          ) : (
            <div className="empty">
              <Icon name="book" />
              <p>{filter ? "没有匹配的书籍" : "拖入 PDF，或点击导入"}</p>
            </div>
          )}
        </main>
      ) : (
        <div
          className="reader"
          data-book-status={book.status}
          inert={navigating}
        >
          <header className="toolbar">
            <button
              aria-label="返回书库"
              onClick={() => {
                setNavigating(true);
                void (async () => {
                  if (!(await notes.flush())) return;
                  if (workspace.current && !(await workspace.current.flush()))
                    return;
                  await post(`books/${book.id}/progress`, { page });
                  setActive(undefined);
                  setBooks(await api<Book[]>("books"));
                })()
                  .catch((e) => setError(String(e)))
                  .finally(() => setNavigating(false));
              }}
            >
              <Icon name="back" />
            </button>
            <button
              aria-label="目录"
              aria-pressed={layout.navigation && nav === "目录"}
              onClick={() => {
                setNav("目录");
                updateLayout({
                  ...layout,
                  navigation: !layout.navigation || nav !== "目录",
                });
              }}
            >
              <Icon name="menu" />
            </button>
            <button
              aria-label="书内搜索"
              onClick={() => {
                setNav("搜索");
                updateLayout({ ...layout, navigation: true });
              }}
            >
              <Icon name="search" />
            </button>
            <strong title={book.title}>{book.title}</strong>
            <form
              className="page-control"
              onSubmit={(e) => {
                e.preventDefault();
                jump(Number(pageInput));
              }}
            >
              <input
                aria-label="页码"
                value={pageInput}
                onChange={(e) => setPageInput(e.target.value)}
                onBlur={() => {
                  jump(Number(pageInput));
                }}
              />
              <span>/ {book.pages || "—"}</span>
            </form>
            <div className="zoom-controls">
              <button
                aria-label="缩小"
                onClick={() =>
                  updateLayout({
                    ...layout,
                    zoom: Math.max(0.4, layout.zoom - 0.1),
                  })
                }
              >
                −
              </button>
              <button
                title="适合宽度"
                onClick={() => {
                  const width =
                    document.querySelector(".reading")?.clientWidth ?? 800;
                  const natural =
                    (document
                      .querySelector(".pdf-page")
                      ?.getBoundingClientRect().width ?? 655) / layout.zoom;
                  updateLayout({
                    ...layout,
                    zoom: Math.max(0.4, Math.min(3, (width - 64) / natural)),
                  });
                }}
              >
                {Math.round(layout.zoom * 100)}%
              </button>
              <button
                aria-label="放大"
                onClick={() =>
                  updateLayout({
                    ...layout,
                    zoom: Math.min(3, layout.zoom + 0.1),
                  })
                }
              >
                +
              </button>
            </div>
            <button
              aria-label="添加书签"
              onClick={() =>
                void post<Bookmark>(`books/${active}/bookmarks`, {
                  page,
                  note: `第 ${page} 页`,
                })
                  .then((m) => {
                    if (current.current === m.bookId)
                      setMarks((old) => [...old, m]);
                  })
                  .catch((e) => setError(e.message))
              }
            >
              <Icon name="bookmark" />
            </button>
            <button
              aria-label="问答"
              aria-pressed={layout.panel !== "none"}
              onClick={togglePanel}
            >
              <Icon name="chat" />
            </button>
            <button
              aria-label="笔记"
              aria-pressed={layout.panel === "notes"}
              onClick={() =>
                updateLayout({
                  ...layout,
                  panel: layout.panel === "notes" ? "none" : "notes",
                })
              }
            >
              笔记
            </button>
            <button
              aria-label="旋转页面"
              onClick={() =>
                updateLayout({
                  ...layout,
                  rotation: ((layout.rotation + 90) % 360) as
                    | 0
                    | 90
                    | 180
                    | 270,
                })
              }
            >
              ↻
            </button>
            <div className="workspace-menu-slot" ref={setWorkspaceToolbarHost} />
            <button
              aria-label="书籍菜单"
              onClick={() => setBookMenu(!bookMenu)}
            >
              <Icon name="more" />
            </button>
            <button aria-label="设置" onClick={() => setSettings(true)}>
              <Icon name="settings" />
            </button>
          </header>
          <div
            className="reader-body"
            style={
              {
                "--panel-width": panelWidth + "px",
              } as React.CSSProperties
            }
          >
            {layout.navigation && (
              <aside className="navigation">
                <div className="nav-tabs">
                  {["目录", "书签", "搜索"].map((name) => (
                    <button
                      className={nav === name ? "chosen" : ""}
                      key={name}
                      onClick={() => setNav(name)}
                    >
                      {name}
                    </button>
                  ))}
                  <button
                    aria-label="收起目录"
                    onClick={() =>
                      updateLayout({ ...layout, navigation: false })
                    }
                  >
                    <Icon name="close" />
                  </button>
                </div>
                {nav === "目录" &&
                  (book.chapters.length ? (
                    book.chapters.map((ch) => (
                      <button
                        className="toc-item"
                        key={ch.id}
                        style={{
                          paddingLeft: 12 + Math.min(ch.depth ?? 0, 4) * 12,
                        }}
                        onClick={() => jump(ch.page)}
                      >
                        <span>{ch.title}</span>
                        <small>{book.labels[ch.page - 1] ?? ch.page}</small>
                      </button>
                    ))
                  ) : (
                    <p className="muted panel-empty">此文档没有目录</p>
                  ))}
                {nav === "书签" &&
                  (marks.length ? (
                    marks.map((m) => (
                      <div className="bookmark" key={m.id}>
                        <button onClick={() => jump(m.page)}>{m.note}</button>
                        <button
                          aria-label="删除书签"
                          onClick={() =>
                            void api(`books/${active}/bookmarks/${m.id}`, {
                              method: "DELETE",
                            }).then(() => {
                              if (current.current === m.bookId)
                                setMarks((old) =>
                                  old.filter((x) => x.id !== m.id),
                                );
                            })
                          }
                        >
                          <Icon name="close" />
                        </button>
                      </div>
                    ))
                  ) : (
                    <p className="muted panel-empty">还没有书签</p>
                  ))}
                {nav === "搜索" && (
                  <>
                    <form
                      className="book-search"
                      onSubmit={(e) => {
                        e.preventDefault();
                        void search();
                      }}
                    >
                      <input
                        aria-label="书内搜索文字"
                        placeholder="搜索原文"
                        value={query}
                        onChange={(e) => setQuery(e.target.value)}
                      />
                      <button aria-label="查找">
                        <Icon name="search" />
                      </button>
                    </form>
                    {hits.map((hit) => (
                      <button
                        className="search-hit"
                        key={hit.id}
                        onClick={() => jump(hit.page, hit.anchor)}
                      >
                        <small>第 {hit.anchor.label} 页</small>
                        {hit.text.slice(0, 160)}
                      </button>
                    ))}
                  </>
                )}
              </aside>
            )}
            <section
              className="reading"
              onPointerDownCapture={(event) => {
                if (!selection || (event.target as HTMLElement).closest(".selection-bar,.reader-tool-palette")) return;
                selectionPinned.current = false;
                clearSelection();
              }}
            >
              <BookWorkspace
                ref={workspace}
                beforeExport={notes.flush}
                book={book}
                page={page}
                toolPreferences={toolPreferences}
                toolbarHost={workspaceToolbarHost}
                workspaceEvent={workspaceEvents[book.id] ?? 0}
                onAnnotationColor={async (annotation, color) => {
                  try {
                    const latest = await api<Annotation[]>(`books/${book.id}/annotations`);
                    const current = latest.find((item) => item.id === annotation.id);
                    if (!current) throw new Error("批注不存在");
                    await post(`books/${book.id}/annotations/${annotation.id}`, {
                      revision: current.revision, color,
                    });
                    await notes.refresh();
                  }
                  catch (cause) { setError(String(cause)); throw cause; }
                }}
                onAnnotationDelete={async (annotation) => {
                  try {
                    if (!(await notes.flush())) throw new Error("批注笔记尚未保存，请重试");
                    await api(`books/${book.id}/annotations/${annotation.id}`, { method: "DELETE" });
                    await notes.refresh();
                  } catch (cause) { setError(String(cause)); throw cause; }
                }}
                onAnnotationRestore={async (annotation) => {
                  try {
                    await post(`books/${book.id}/annotations/${annotation.id}/restore`, {});
                    await notes.refresh();
                  } catch (cause) { setError(String(cause)); throw cause; }
                }}
                onQuestionMaterials={(selection) => addQuestionMaterials(book.id, selection)}
                key={active}
                id={active!}
                initialPage={book.progress}
                zoom={layout.zoom}
                onZoom={(zoom) => updateLayout({ ...layout, zoom })}
                rotation={layout.rotation}
                onPage={onPage}
                onSelection={(next) => {
                  if (next || !selectionPinned.current) setSelection(next);
                }}
                highlight={highlight}
                annotations={notes.annotations}
                mode={mode === "text" ? "select" : mode}
                onCreate={createAnnotation}
                onRegionAction={handleWorkspaceRegion}
                onQuestionRegion={
                  questionCapture?.bookId === book.id
                    ? addQuestionRegion
                    : undefined
                }
                onAnnotation={(id) => {
                  void notes.flush().then((ok) => {
                    if (ok) {
                      notes.setSelected(id);
                      updateLayout({ ...layout, panel: "notes" });
                    }
                  });
                }}
              />
              <ReaderToolPalette
                tool={mode}
                preferences={toolPreferences}
                onTool={readerTools.activate}
                onPreferences={updateToolPreferences}
              />
              {questionCapture?.bookId === book.id && (
                <div className="region-question-prompt" role="status">
                  <Icon name="crop" />
                  <span>拖动框选图表或公式，加入问题后再发送</span>
                  <button onClick={cancelQuestionCapture} aria-label="取消框选">
                    取消 <kbd>Esc</kbd>
                  </button>
                </div>
              )}
              {selection && (
                <SelectionToolbar
                  selection={selection}
                  color={annotationColor}
                  onColor={setAnnotationColor}
                  onInteract={() => { selectionPinned.current = true; }}
                  onExcerpt={() => {
                    workspace.current?.excerpt(selection);
                    selectionPinned.current = false;
                    clearSelection();
                  }}
                  onAnnotate={(kind) => void createAnnotation({
                    kind,
                    color: annotationColor,
                    quote: selection.text,
                    anchors: selection.anchors,
                  })}
                  onAi={(name) => {
                    updateLayout({ ...layout, panel: "chat" });
                    setAction({ name, nonce: Date.now(), selection: structuredClone(selection) });
                    selectionPinned.current = false;
                    clearSelection();
                  }}
                  onDismiss={() => { selectionPinned.current = false; clearSelection(); }}
                />
              )}
              {expanded && <ExpandedNote note={expanded} state={notes} onClose={() => {
                setExpandedNote(undefined); readerTools.finish();
              }} />}
            </section>
            {layout.panel !== "none" && (
              <>
                <PanelResizer
                  width={panelWidth}
                  maximum={maxPanelWidth}
                  onChange={(panelWidth) =>
                    setLayout((old) => ({ ...old, panelWidth }))
                  }
                  onCommit={(panelWidth) =>
                    updateLayout({ ...layout, panelWidth })
                  }
                />
                <div className="side-panel">
                  <header className="panel-header">
                    <div className="panel-tabs">
                      <button
                        className={layout.panel === "chat" ? "chosen" : ""}
                        onClick={() =>
                          updateLayout({ ...layout, panel: "chat" })
                        }
                      >
                        问答
                      </button>
                      <button
                        className={layout.panel === "notes" ? "chosen" : ""}
                        onClick={() =>
                          updateLayout({ ...layout, panel: "notes" })
                        }
                      >
                        笔记
                      </button>
                    </div>
                    <button aria-label="收起侧栏" onClick={togglePanel}>
                      <Icon name="close" />
                    </button>
                  </header>
                  {layout.panel === "notes" ? (
                    <NotesPanel bookId={book.id} state={notes} onJump={jump}
                      onExpand={(note) => { readerTools.finish(); setExpandedNote({ bookId: book.id, id: note.id }); }}
                      onAddAnnotation={async (annotation) => {
                        const added = await workspace.current?.addToQuestion([annotation.id]);
                        if (!added) throw new Error("批注预览尚未准备好；请在正文定位并重试");
                      }}
                      onAddToQuestion={async (note) => {
                        const snapshot = await api<{ revision: number }>(`books/${book.id}/workspace`);
                        const latest = (await api<Note[]>(`books/${book.id}/notes`))
                          .find((item) => item.id === note.id && !item.deletedAt);
                        if (!latest) throw new Error("笔记已变化，请重新选择");
                        await addQuestionMaterials(book.id, { workspaceRevision: snapshot.revision,
                          targets: [{ kind: "note", id: latest.id, revision: latest.revision }], previews: [] });
                      }} />
                  ) : (
                    <ChatPanel
                      key={active}
                      book={book}
                      page={page}
                      selection={selection}
                      action={action}
                      savedDrafts={questionDrafts}
                      onActionConsumed={() => setAction(undefined)}
                      onClearSelection={clearSelection}
                      onPickSelection={() => {
                        readerTools.activate("text");
                        document
                          .querySelector<HTMLElement>(".pdf-scroll")
                          ?.focus({ preventScroll: true });
                      }}
                      onCitation={jump}
                      notes={notes.notes}
                      onNoteSaved={openSavedNote}
                      onStartRegion={startQuestionCapture}
                      onSessionChange={(sessionId) => {
                        setChatSessions((old) => old[book.id] === sessionId ? old :
                          { ...old, [book.id]: sessionId });
                        if (
                          questionCapture &&
                          questionCapture.sessionId !== sessionId
                        ) {
                          setQuestionCapture(undefined);
                          readerTools.finish();
                        }
                      }}
                      onMaterialLocate={(anchors) => {
                        workspace.current?.locate(anchors);
                        if (viewportWidth <= 1180) updateLayout({ ...layout, panel: "none" });
                      }}
                    />
                  )}
                </div>
              </>
            )}
          </div>
          {book.status !== "ready" && (
            <div className="document-status" role="status">
              {book.status === "error"
                ? `无法解析：${book.error}`
                : `正在准备文档 ${book.parsedPages} / ${book.pages || "—"}`}
            </div>
          )}
          {bookMenu && (
            <div className="book-menu">
              <header>
                <strong>文档</strong>
                <button
                  aria-label="关闭文档菜单"
                  onClick={() => setBookMenu(false)}
                >
                  <Icon name="close" />
                </button>
              </header>
              <p>
                {book.textPages} / {book.pages} 页含可检索文字
              </p>
              <IndexPanel book={book} page={page} />
              {prefs.experimentalTools && <ToolPanel bookId={book.id} />}
            </div>
          )}
        </div>
      )}
      {error && (
        <div className="error-toast" role="alert">
          {error}
          <button aria-label="关闭提示" onClick={() => setError("")}>
            <Icon name="close" />
          </button>
        </div>
      )}
      {settings && (
        <Settings
          prefs={prefs}
          onChange={updatePrefs}
          onClose={() => setSettings(false)}
        >
          <AccountControls />
        </Settings>
      )}
    </>
  );
}
