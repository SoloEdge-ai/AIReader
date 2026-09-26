import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from "react";
import { mergeAttributes, Node as TiptapNode } from "@tiptap/core";
import { EditorContent, useEditor } from "@tiptap/react";
import { Mathematics } from "@tiptap/extension-mathematics";
import { TableKit } from "@tiptap/extension-table";
import StarterKit from "@tiptap/starter-kit";
import "katex/dist/katex.min.css";
import type { Note, RichNode } from "../../../../../packages/protocol/src";
import type { BookNotes } from "./useBookNotes";
import { canonicalDocument } from "./NoteEditingSession";

const SourceReference = TiptapNode.create({
  name: "sourceReference",
  group: "inline",
  inline: true,
  atom: true,
  selectable: true,
  addAttributes() {
    return {
      referenceId: {
        default: "",
        parseHTML: (element) => element.getAttribute("data-reference-id") ?? "",
        renderHTML: (attributes) => ({ "data-reference-id": attributes.referenceId }),
      },
    };
  },
  parseHTML() { return [{ tag: "span[data-source-reference]" }]; },
  renderHTML({ HTMLAttributes }) {
    return ["span", mergeAttributes(HTMLAttributes, {
      "data-source-reference": "",
      class: "note-source-reference",
      contenteditable: "false",
      role: "link",
      tabindex: "0",
      title: "打开笔记来源",
    }), "〔来源〕"];
  },
});

export interface NoteEditorHandle {
  insertSourceReference: (referenceId: string) => void;
}

export const NoteEditor = forwardRef<NoteEditorHandle, {
  note: Note;
  state: Pick<BookNotes, "edit" | "getSnapshot">;
  onOpenSource?: (referenceId: string) => void;
}>(function NoteEditor({ note, state, onOpenSource }, ref) {
  const [link, setLink] = useState<string | undefined>();
  const [math, setMath] = useState<{
    kind: "inline" | "block";
    latex: string;
    pos?: number;
  }>();
  const titleRef = useRef(note.title),
    composition = useRef(false),
    localDocument = useRef<string | undefined>(undefined);
  titleRef.current = note.title;
  const latestState = useRef(state);
  latestState.current = state;
  const editor = useEditor({
    extensions: [
      StarterKit.configure({
        heading: { levels: [1, 2, 3] },
        link: { openOnClick: false, protocols: ["https", "http", "mailto"] },
      }),
      TableKit.configure({
        table: {
          resizable: false,
          HTMLAttributes: { class: "note-table" },
        },
      }),
      Mathematics.configure({
        inlineOptions: {
          onClick: (node, pos) =>
            setMath({ kind: "inline", latex: String(node.attrs.latex ?? ""), pos }),
        },
        blockOptions: {
          onClick: (node, pos) =>
            setMath({ kind: "block", latex: String(node.attrs.latex ?? ""), pos }),
        },
        katexOptions: { throwOnError: false, trust: false, maxSize: 20 },
      }),
      SourceReference,
    ],
    content: note.document,
    onUpdate: ({ editor }) => {
      if (!composition.current) {
        const document = editor.getJSON() as RichNode;
        localDocument.current = canonicalDocument(document);
        latestState.current.edit(note.id, titleRef.current, document);
      }
    },
    onBlur: ({ editor }) => {
      queueMicrotask(() => {
        if (editor.isDestroyed || editor.isFocused || composition.current) return;
        // A second editor may have changed this note while the active editor
        // deliberately ignored incoming snapshots. Reconcile from the session,
        // not from a prop captured before the blur.
        const latest = latestState.current.getSnapshot().notes.find((item) => item.id === note.id);
        if (latest && canonicalDocument(editor.getJSON()) !== canonicalDocument(latest.document))
          editor.chain().setContent(latest.document, { emitUpdate: false })
            .setMeta("addToHistory", false).run();
        localDocument.current = undefined;
      });
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
            if (editor) {
              const document = editor.getJSON() as RichNode;
              localDocument.current = canonicalDocument(document);
              latestState.current.edit(
                note.id,
                titleRef.current,
                document,
              );
            }
          });
          return false;
        },
      },
    },
  });
  useEffect(() => {
    // The shared session changes synchronously, but a React commit for an older
    // snapshot can arrive while contenteditable is replacing its selection.
    // Never reconcile against a prop that is already behind the session.
    if (!editor || composition.current) return;
    const current = canonicalDocument(editor.getJSON());
    const incoming = canonicalDocument(note.document);
    const latest = latestState.current.getSnapshot().notes.find((item) => item.id === note.id);
    if (!latest || incoming !== canonicalDocument(latest.document)) return;
    if (current === incoming) {
      // Keep the focus-local guard through the entire edit gesture. Clearing it
      // at an intermediate empty document lets a delayed snapshot append the
      // former text after a replacement fill.
      if (!editor.isFocused) localDocument.current = undefined;
      return;
    }
    if (editor.isFocused && localDocument.current !== undefined) return;
    editor.chain().setContent(note.document, { emitUpdate: false })
      .setMeta("addToHistory", false).run();
    localDocument.current = undefined;
  }, [editor, note.document]);
  useImperativeHandle(ref, () => ({
    insertSourceReference(referenceId: string) {
      editor?.chain().focus().insertContent({
        type: "sourceReference",
        attrs: { referenceId },
      }).run();
    },
  }), [editor]);
  if (!editor) return null;
  return (
    <>
      <input
        className="note-title"
        aria-label="笔记标题"
        value={note.title}
        maxLength={200}
        onChange={(e) => {
          titleRef.current = e.target.value;
          latestState.current.edit(note.id, e.target.value, editor.getJSON() as RichNode);
        }}
      />
      <div className="editor-toolbar" role="toolbar" aria-label="笔记格式">
        <button
          type="button"
          title="粗体"
          aria-pressed={editor.isActive("bold")}
          onClick={() => editor.chain().focus().toggleBold().run()}
        >
          <b>B</b>
        </button>
        <button
          type="button"
          title="斜体"
          aria-pressed={editor.isActive("italic")}
          onClick={() => editor.chain().focus().toggleItalic().run()}
        >
          <i>I</i>
        </button>
        <button
          type="button"
          title="标题"
          aria-pressed={editor.isActive("heading", { level: 2 })}
          onClick={() =>
            editor.chain().focus().toggleHeading({ level: 2 }).run()
          }
        >
          H
        </button>
        <button
          type="button"
          title="无序列表"
          aria-pressed={editor.isActive("bulletList")}
          onClick={() => editor.chain().focus().toggleBulletList().run()}
        >
          • 列表
        </button>
        <button
          type="button"
          title="有序列表"
          aria-pressed={editor.isActive("orderedList")}
          onClick={() => editor.chain().focus().toggleOrderedList().run()}
        >
          1. 列表
        </button>
        <button
          type="button"
          title="引用"
          aria-pressed={editor.isActive("blockquote")}
          onClick={() => editor.chain().focus().toggleBlockquote().run()}
        >
          ❞
        </button>
        <button
          type="button"
          title="代码块"
          aria-pressed={editor.isActive("codeBlock")}
          onClick={() => editor.chain().focus().toggleCodeBlock().run()}
        >
          &lt;/&gt;
        </button>
        <button
          type="button"
          title="链接"
          onClick={() =>
            setLink(editor.getAttributes("link").href ?? "https://")
          }
        >
          链接
        </button>
        <span className="editor-toolbar-separator" aria-hidden="true" />
        <button
          type="button"
          title="行内公式"
          onClick={() => setMath({ kind: "inline", latex: "" })}
        >
          ƒx
        </button>
        <button
          type="button"
          title="公式块"
          onClick={() => setMath({ kind: "block", latex: "" })}
        >
          ∑
        </button>
        <button
          type="button"
          title="插入表格"
          onClick={() =>
            editor.chain().focus().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run()
          }
        >
          表格
        </button>
        {editor.isActive("table") && <>
          <button type="button" title="在下方添加一行"
            onClick={() => editor.chain().focus().addRowAfter().run()}>＋行</button>
          <button type="button" title="在右侧添加一列"
            onClick={() => editor.chain().focus().addColumnAfter().run()}>＋列</button>
          <button type="button" title="删除当前行"
            onClick={() => editor.chain().focus().deleteRow().run()}>－行</button>
          <button type="button" title="删除当前列"
            onClick={() => editor.chain().focus().deleteColumn().run()}>－列</button>
          <button type="button" title="删除表格"
            onClick={() => editor.chain().focus().deleteTable().run()}>删表</button>
        </>}
        <span className="editor-toolbar-separator" aria-hidden="true" />
        <button
          type="button"
          title="撤销编辑"
          onClick={() => editor.chain().focus().undo().run()}
        >
          ↶
        </button>
      </div>
      {link !== undefined && (
        <form
          className="note-link-form"
          onKeyDown={(event) => {
            if (event.key !== "Escape" || event.nativeEvent.isComposing) return;
            event.preventDefault();
            event.stopPropagation();
            setLink(undefined);
            editor.commands.focus();
          }}
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
      {math && (
        <form
          className="note-math-form"
          onKeyDown={(event) => {
            if (event.key !== "Escape" || event.nativeEvent.isComposing) return;
            event.preventDefault();
            event.stopPropagation();
            setMath(undefined);
            editor.commands.focus();
          }}
          onSubmit={(event) => {
            event.preventDefault();
            const latex = math.latex.trim();
            if (!latex) return;
            const chain = editor.chain().focus();
            if (math.kind === "inline") {
              if (math.pos === undefined) chain.insertInlineMath({ latex }).run();
              else chain.updateInlineMath({ latex, pos: math.pos }).run();
            } else if (math.pos === undefined) chain.insertBlockMath({ latex }).run();
            else chain.updateBlockMath({ latex, pos: math.pos }).run();
            setMath(undefined);
          }}
        >
          <label htmlFor={`note-math-${note.id}`}>
            {math.pos === undefined ? "插入" : "编辑"}{math.kind === "inline" ? "行内公式" : "公式块"}
          </label>
          <textarea
            id={`note-math-${note.id}`}
            autoFocus
            aria-label="LaTeX 公式"
            value={math.latex}
            maxLength={20000}
            rows={math.kind === "inline" ? 2 : 4}
            placeholder="输入 LaTeX，不包含 $ 分隔符"
            onChange={(event) => setMath({ ...math, latex: event.target.value })}
          />
          <div>
            <button type="submit" disabled={!math.latex.trim()}>应用公式</button>
            <button type="button" onClick={() => setMath(undefined)}>取消</button>
          </div>
        </form>
      )}
      <div onClick={(event) => {
        const target = (event.target as HTMLElement).closest<HTMLElement>("[data-source-reference]");
        const referenceId = target?.dataset.referenceId;
        if (referenceId) onOpenSource?.(referenceId);
      }} onKeyDown={(event) => {
        if (event.key !== "Enter" && event.key !== " ") return;
        const target = (event.target as HTMLElement).closest<HTMLElement>("[data-source-reference]");
        const referenceId = target?.dataset.referenceId;
        if (!referenceId) return;
        event.preventDefault();
        onOpenSource?.(referenceId);
      }}>
        <EditorContent editor={editor} />
      </div>
    </>
  );
});
