import { useEffect, useRef, useState } from "react";
import { EditorContent, useEditor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import type {
  Annotation,
  Note,
  RichNode,
} from "../../../packages/protocol/src";
import { api, base, post } from "./api";
type Draft = { title: string; document: RichNode; generation: number };
export function useBookNotes(bookId: string | undefined) {
  const [notes, setNotes] = useState<Note[]>([]),
    [annotations, setAnnotations] = useState<Annotation[]>([]),
    [selected, setSelected] = useState<string>(),
    [status, setStatus] = useState("已保存");
  const records = useRef<Note[]>([]),
    drafts = useRef(new Map<string, Draft>()),
    timer = useRef<ReturnType<typeof setTimeout>>(undefined),
    pending = useRef<Promise<boolean> | undefined>(undefined),
    current = useRef(bookId),
    undo = useRef<(() => Promise<unknown>)[]>([]);
  current.current = bookId;
  const refresh = async () => {
    if (!bookId) return;
    const [n, a] = await Promise.all([
      api<Note[]>(`books/${bookId}/notes`),
      api<Annotation[]>(`books/${bookId}/annotations`),
    ]);
    if (current.current !== bookId) return;
    records.current = n;
    setNotes(n);
    setAnnotations(a);
  };
  useEffect(() => {
    records.current = [];
    drafts.current.clear();
    undo.current = [];
    setSelected(undefined);
    setNotes([]);
    setAnnotations([]);
    setStatus("已保存");
    void refresh().catch((e) => setStatus(e.message));
    return () => clearTimeout(timer.current);
  }, [bookId]);
  async function flush(): Promise<boolean> {
    clearTimeout(timer.current);
    if (pending.current) {
      const ok = await pending.current;
      if (!ok) return false;
      if (drafts.current.size) return flush();
      return true;
    }
    if (!bookId || !drafts.current.size) return true;
    const task = (async () => {
      try {
        setStatus("保存中…");
        for (const [id, draft] of drafts.current) {
          const original = records.current.find((n) => n.id === id);
          if (!original) throw new Error("草稿对应的笔记不存在，请保留内容");
          const result = await post<Note>(`books/${bookId}/notes/${id}`, {
            revision: original.revision,
            title: draft.title || "未命名笔记",
            document: draft.document,
          });
          records.current = records.current.map((n) =>
            n.id === id ? result : n,
          );
          setNotes([...records.current]);
          if (drafts.current.get(id)?.generation === draft.generation)
            drafts.current.delete(id);
        }
        setStatus(drafts.current.size ? "保存中…" : "已保存");
        return true;
      } catch (e) {
        setStatus("保存失败，草稿仍保留：" + String(e));
        return false;
      }
    })();
    pending.current = task;
    const ok = await task;
    pending.current = undefined;
    if (ok && drafts.current.size) return flush();
    return ok;
  }
  useEffect(() => {
    const warn = (e: BeforeUnloadEvent) => {
      if (drafts.current.size) {
        e.preventDefault();
        e.returnValue = "";
      }
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, []);
  function edit(id: string, title: string, document: RichNode) {
    drafts.current.set(id, {
      title,
      document,
      generation: (drafts.current.get(id)?.generation ?? 0) + 1,
    });
    setStatus("保存中…");
    clearTimeout(timer.current);
    timer.current = setTimeout(() => void flush(), 650);
  }
  async function create() {
    if (!bookId || !(await flush())) return;
    const n = await post<Note>(`books/${bookId}/notes`, {});
    await refresh();
    setSelected(n.id);
  }
  async function remove(note: Note) {
    if (!bookId || !(await flush())) return;
    const a = annotations.find((a) => a.id === note.annotationId);
    const path = `books/${bookId}/${a ? "annotations" : "notes"}/${a?.id ?? note.id}`;
    await api(path, { method: "DELETE" });
    undo.current.push(() => post(path + "/restore", {}));
    setSelected(undefined);
    await refresh();
  }
  async function color(a: Annotation, value: Annotation["color"]) {
    if (!bookId) return;
    const path = `books/${bookId}/annotations/${a.id}`;
    const updated = await post<Annotation>(path, {
      revision: a.revision,
      color: value,
    });
    undo.current.push(async () => {
      const latest = await api<Annotation[]>(`books/${bookId}/annotations`);
      const record = latest.find((v) => v.id === a.id);
      if (!record) throw new Error("批注不存在");
      return post(path, { revision: record.revision, color: a.color });
    });
    await refresh();
  }
  async function undoLast() {
    if (!(await flush())) return;
    const action = undo.current.at(-1);
    if (action) {
      await action();
      undo.current.pop();
      await refresh();
    }
  }
  return {
    notes,
    annotations,
    selected,
    setSelected,
    status,
    edit,
    flush,
    refresh,
    create,
    remove,
    color,
    undoLast,
    undo,
    drafts,
  };
}
export type BookNotes = ReturnType<typeof useBookNotes>;
function NoteEditor({ note, state }: { note: Note; state: BookNotes }) {
  const draft = state.drafts.current.get(note.id),
    [title, setTitle] = useState(draft?.title ?? note.title),
    [link, setLink] = useState<string | undefined>();
  const titleRef = useRef(title),
    composition = useRef(false);
  const editor = useEditor({
    extensions: [
      StarterKit.configure({
        heading: { levels: [1, 2, 3] },
        link: { openOnClick: false, protocols: ["https", "http", "mailto"] },
      }),
    ],
    content: draft?.document ?? note.document,
    onUpdate: ({ editor }) => {
      if (!composition.current)
        state.edit(note.id, titleRef.current, editor.getJSON() as RichNode);
    },
    editorProps: {
      attributes: {
        "aria-label": "笔记正文",
        role: "textbox",
        "aria-multiline": "true",
      },
      handleDOMEvents: {
        compositionstart: () => {
          composition.current = true;
          return false;
        },
        compositionend: (_view) => {
          composition.current = false;
          queueMicrotask(() => {
            if (editor)
              state.edit(
                note.id,
                titleRef.current,
                editor.getJSON() as RichNode,
              );
          });
          return false;
        },
      },
    },
  });
  if (!editor) return null;
  return (
    <>
      <input
        className="note-title"
        aria-label="笔记标题"
        value={title}
        maxLength={200}
        onChange={(e) => {
          setTitle(e.target.value);
          titleRef.current = e.target.value;
          state.edit(note.id, e.target.value, editor.getJSON() as RichNode);
        }}
      />
      <div className="editor-toolbar" role="toolbar" aria-label="笔记格式">
        <button
          title="粗体"
          aria-pressed={editor.isActive("bold")}
          onClick={() => editor.chain().focus().toggleBold().run()}
        >
          <b>B</b>
        </button>
        <button
          title="斜体"
          onClick={() => editor.chain().focus().toggleItalic().run()}
        >
          <i>I</i>
        </button>
        <button
          title="标题"
          onClick={() =>
            editor.chain().focus().toggleHeading({ level: 2 }).run()
          }
        >
          H
        </button>
        <button
          title="无序列表"
          onClick={() => editor.chain().focus().toggleBulletList().run()}
        >
          • 列表
        </button>
        <button
          title="有序列表"
          onClick={() => editor.chain().focus().toggleOrderedList().run()}
        >
          1. 列表
        </button>
        <button
          title="引用"
          onClick={() => editor.chain().focus().toggleBlockquote().run()}
        >
          ❞
        </button>
        <button
          title="代码块"
          onClick={() => editor.chain().focus().toggleCodeBlock().run()}
        >
          &lt;/&gt;
        </button>
        <button
          title="链接"
          onClick={() =>
            setLink(editor.getAttributes("link").href ?? "https://")
          }
        >
          链接
        </button>
        <button
          title="撤销编辑"
          onClick={() => editor.chain().focus().undo().run()}
        >
          ↶
        </button>
      </div>
      {link !== undefined && (
        <form
          className="note-link-form"
          onSubmit={(e) => {
            e.preventDefault();
            try {
              if (!link) editor.chain().focus().unsetLink().run();
              else {
                if (
                  !["https:", "http:", "mailto:"].includes(
                    new URL(link).protocol,
                  )
                )
                  return;
                editor.chain().focus().setLink({ href: link }).run();
              }
              setLink(undefined);
            } catch {}
          }}
        >
          <input
            autoFocus
            aria-label="笔记链接地址"
            value={link}
            onChange={(e) => setLink(e.target.value)}
          />
          <button>应用链接</button>
          <button type="button" onClick={() => setLink(undefined)}>
            取消
          </button>
        </form>
      )}
      <EditorContent editor={editor} />
    </>
  );
}
const kindNames = {
  highlight: "高亮",
  underline: "下划线",
  strike: "删除线",
  sticky: "便签",
  region: "区域摘录",
};
export function NotesPanel({
  bookId,
  state,
  onJump,
}: {
  bookId: string;
  state: BookNotes;
  onJump: (page: number) => void;
}) {
  const [query, setQuery] = useState(""),
    [kind, setKind] = useState(""),
    [color, setColor] = useState("");
  const selected = state.notes.find((n) => n.id === state.selected),
    annotation = state.annotations.find((a) => a.id === selected?.annotationId);
  const run = (fn: () => Promise<unknown>) =>
    void fn().catch((e) => window.alert(String(e)));
  return (
    <section className="notes-panel">
      <div className="notes-actions">
        <button onClick={() => run(state.create)}>新建笔记</button>
        <button
          onClick={() => run(state.undoLast)}
          disabled={!state.undo.current.length}
        >
          撤销批注操作
        </button>
      </div>
      <div className="note-filters">
        <input
          aria-label="搜索笔记"
          placeholder="搜索批注和笔记"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        <select
          aria-label="批注类型筛选"
          value={kind}
          onChange={(e) => setKind(e.target.value)}
        >
          <option value="">全部类型</option>
          {Object.entries(kindNames).map(([k, n]) => (
            <option key={k} value={k}>
              {n}
            </option>
          ))}
          <option value="note">独立笔记</option>
        </select>
        <select
          aria-label="批注颜色筛选"
          value={color}
          onChange={(e) => setColor(e.target.value)}
        >
          <option value="">全部颜色</option>
          {["yellow", "green", "blue", "pink"].map((c, i) => (
            <option key={c} value={c}>
              {["黄", "绿", "蓝", "粉"][i]}
            </option>
          ))}
        </select>
      </div>
      <div className="notes-list">
        {[...state.notes]
          .sort(
            (a, b) =>
              (state.annotations.find((x) => x.id === a.annotationId)
                ?.anchors[0].page ?? Infinity) -
              (state.annotations.find((x) => x.id === b.annotationId)
                ?.anchors[0].page ?? Infinity),
          )
          .filter((n) => {
            const a = state.annotations.find((a) => a.id === n.annotationId);
            return (
              (!kind || (a?.kind ?? "note") === kind) &&
              (!color || a?.color === color) &&
              (n.title + JSON.stringify(n.document) + (a?.quote ?? ""))
                .toLowerCase()
                .includes(query.toLowerCase())
            );
          })
          .map((n) => {
            const a = state.annotations.find((a) => a.id === n.annotationId);
            return (
              <button
                className={n.id === selected?.id ? "chosen" : ""}
                key={n.id}
                onClick={() =>
                  run(async () => {
                    if (await state.flush()) {
                      state.setSelected(n.id);
                      if (a) onJump(a.anchors[0].page);
                    }
                  })
                }
              >
                <span>{n.title}</span>
                <small>
                  {a
                    ? `${kindNames[a.kind]} · ${a.anchors.map((x) => x.page).join("、")} 页`
                    : "独立笔记"}
                </small>
              </button>
            );
          })}
      </div>
      {selected ? (
        <div className="note-detail">
          {annotation && (
            <div className="note-source">
              <button onClick={() => onJump(annotation.anchors[0].page)}>
                第 {annotation.anchors[0].page} 页原文 ↗
              </button>
              {annotation.quote && <blockquote>{annotation.quote}</blockquote>}
              {annotation.assetId && (
                <img
                  alt="区域摘录"
                  src={`${base}/api/books/${bookId}/annotation-assets/${annotation.assetId}`}
                />
              )}
              <label>
                颜色{" "}
                <select
                  aria-label="批注颜色"
                  value={annotation.color}
                  onChange={(e) =>
                    run(() =>
                      state.color(
                        annotation,
                        e.target.value as Annotation["color"],
                      ),
                    )
                  }
                >
                  {["yellow", "green", "blue", "pink"].map((c, i) => (
                    <option key={c} value={c}>
                      {["黄色", "绿色", "蓝色", "粉色"][i]}
                    </option>
                  ))}
                </select>
              </label>
            </div>
          )}
          <NoteEditor key={selected.id} note={selected} state={state} />
          <footer>
            <span role="status">{state.status}</span>
            {state.status.startsWith("保存失败") && (
              <button onClick={() => void state.flush()}>重试保存</button>
            )}
            <button onClick={() => run(() => state.remove(selected))}>
              删除{annotation ? "批注" : "笔记"}
            </button>
          </footer>
        </div>
      ) : (
        <p className="panel-empty muted">选择一条批注，或新建笔记</p>
      )}
    </section>
  );
}
