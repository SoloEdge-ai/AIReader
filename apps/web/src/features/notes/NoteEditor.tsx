import { useEffect, useRef, useState } from "react";
import { EditorContent, useEditor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import type { Note, RichNode } from "../../../../../packages/protocol/src";
import type { BookNotes } from "./useBookNotes";
import { canonicalDocument } from "./NoteEditingSession";

export function NoteEditor({ note, state }: { note: Note; state: Pick<BookNotes, "edit" | "getSnapshot"> }) {
  const [link, setLink] = useState<string | undefined>();
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
      <EditorContent editor={editor} />
    </>
  );
}
