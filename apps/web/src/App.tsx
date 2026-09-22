import { useCallback, useEffect, useRef, useState } from "react";
import {
  ReaderPreferencesSchema,
  type ReaderPreferences,
  type Book,
  type Bookmark,
  type Passage,
  type SourceAnchor,
  type CoreEvent,
} from "../../../packages/protocol/src";
import { api, post, base } from "./api";
import { PdfReader } from "./PdfReader";
import { ChatPanel } from "./ChatPanel";
import { BookCover } from "./BookCover";
import { Icon } from "./Icon";
import { Settings } from "./Settings";
import { AccountControls } from "./AiState";
import { IndexPanel } from "./IndexPanel";
import { ToolPanel } from "./ToolPanel";
export function App() {
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
  const [selection, setSelection] = useState<{ text: string; page: number }>(),
    [action, setAction] = useState<{ name: string; nonce: number }>();
  const [highlight, setHighlight] = useState<SourceAnchor>(),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  const input = useRef<HTMLInputElement>(null),
    current = useRef(active),
    sequence = useRef(0),
    saveTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  current.current = active;
  const book = books.find((b) => b.id === active);
  useEffect(() => {
    let socket: WebSocket;
    let live = true;
    void post("session", {})
      .then(async () => {
        const [list, p] = await Promise.all([
          api<Book[]>("books"),
          api<ReaderPreferences>("preferences"),
        ]);
        if (!live) return;
        setBooks(list);
        setPrefs(p);
        socket = new WebSocket(
          (base || location.origin).replace("http:", "ws:") + "/events",
        );
        socket.onmessage = (e) => {
          const event = JSON.parse(e.data) as CoreEvent;
          if (event.type === "book")
            setBooks((old) => {
              const b = event.data as Book;
              return [...old.filter((x) => x.id !== b.id), b];
            });
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
    let live = true;
    setSelection(undefined);
    setAction(undefined);
    setMarks([]);
    setHits([]);
    setQuery("");
    setHighlight(undefined);
    setBookMenu(false);
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
    try {
      const p = await api<ReaderPreferences>(`books/${b.id}/preferences`);
      setLayout(p);
      setPage(b.progress);
      setActive(b.id);
      await post(`books/${b.id}/open`, {});
    } catch (e) {
      setError(String(e));
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
        <div className="reader" data-book-status={book.status}>
          <header className="toolbar">
            <button
              aria-label="返回书库"
              onClick={() => {
                void post(`books/${book.id}/progress`, { page });
                setActive(undefined);
                void api<Book[]>("books").then(setBooks);
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
                "--panel-width": layout.panelWidth + "px",
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
            <section className="reading">
              <PdfReader
                key={active}
                id={active!}
                initialPage={book.progress}
                zoom={layout.zoom}
                onPage={onPage}
                onSelection={(text, p) => setSelection({ text, page: p })}
                highlight={highlight}
              />
              {selection && (
                <div className="selection-bar">
                  <span>{selection.text.length} 字</span>
                  {["解释", "总结", "翻译", "提问"].map((name) => (
                    <button
                      key={name}
                      onClick={() => {
                        updateLayout({ ...layout, panel: "chat" });
                        setAction({ name, nonce: Date.now() });
                      }}
                    >
                      {name}
                    </button>
                  ))}
                  <button
                    aria-label="取消选区"
                    onClick={() => setSelection(undefined)}
                  >
                    <Icon name="close" />
                  </button>
                </div>
              )}
            </section>
            {layout.panel !== "none" && (
              <>
                <div
                  className="splitter"
                  role="separator"
                  tabIndex={0}
                  aria-label="调整侧栏宽度"
                  aria-orientation="vertical"
                  onKeyDown={(e) => {
                    if (e.key === "ArrowLeft" || e.key === "ArrowRight")
                      updateLayout({
                        ...layout,
                        panelWidth: Math.max(
                          320,
                          Math.min(
                            560,
                            layout.panelWidth +
                              (e.key === "ArrowLeft" ? 20 : -20),
                          ),
                        ),
                      });
                  }}
                  onPointerDown={(e) =>
                    e.currentTarget.setPointerCapture(e.pointerId)
                  }
                  onPointerMove={(e) => {
                    if (e.buttons === 1) {
                      const rect =
                        e.currentTarget.parentElement!.getBoundingClientRect();
                      setLayout((old) => ({
                        ...old,
                        panelWidth: Math.max(
                          320,
                          Math.min(560, rect.right - e.clientX),
                        ),
                      }));
                    }
                  }}
                  onPointerUp={() => updateLayout(layout)}
                />
                <div className="side-panel">
                  <header className="panel-header">
                    <strong>问答</strong>
                    <button aria-label="收起侧栏" onClick={togglePanel}>
                      <Icon name="close" />
                    </button>
                  </header>
                  <ChatPanel
                    key={active}
                    book={book}
                    page={page}
                    selection={selection}
                    action={action}
                    onCitation={jump}
                  />
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
