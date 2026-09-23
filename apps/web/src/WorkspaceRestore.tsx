import { useRef, useState } from "react";
import type { Book } from "../../../packages/protocol/src";
import { api } from "./api";
import { Icon } from "./Icon";

export function WorkspaceRestore({
  disabled,
  onRestore,
  onError,
}: {
  disabled: boolean;
  onRestore: (book: Book) => Promise<void>;
  onError: (message: string) => void;
}) {
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  async function restore(file: File) {
    setBusy(true);
    onError("");
    try {
      if (file.size > 384 * 1024 * 1024)
        throw new Error("工作区文件超过 384 MB");
      const book = await api<Book>("workspace-archives", {
        method: "POST",
        body: file,
        headers: { "Content-Type": "application/zip" },
      });
      await onRestore(book);
    } catch (error) {
      onError(String(error));
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <input
        ref={input}
        hidden
        type="file"
        accept=".aireader"
        aria-label="选择工作区包"
        onChange={(event) => {
          const file = event.target.files?.[0];
          event.target.value = "";
          if (file) void restore(file);
        }}
      />
      <button
        disabled={busy || disabled}
        title="从 .aireader 文件恢复为独立副本，保留现有书籍和笔记"
        onClick={() => input.current?.click()}
      >
        <Icon name="reset" />
        {busy ? "恢复中…" : "恢复工作区"}
      </button>
    </>
  );
}
