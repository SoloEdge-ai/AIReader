import { useCallback, useEffect, useRef, useState } from "react";
import { ToolPreferencesSchema, type ReaderTool, type ToolPreferences } from "../../../packages/protocol/src";

/** Tool and selection state is transient; only the palette's layout is persisted. */
export function useReaderToolController({
  bookId,
  clearSelection,
  cancelExternal,
  onEscape,
}: {
  bookId: string | undefined;
  clearSelection: () => void;
  cancelExternal: () => void;
  onEscape: (event: KeyboardEvent) => boolean;
}) {
  const [tool, setTool] = useState<ReaderTool>("pointer");
  const [preferences, setPreferences] = useState<ToolPreferences>(() => ToolPreferencesSchema.parse({}));
  const selectionPinned = useRef(false);
  const finish = useCallback((next: ReaderTool = "pointer") => {
    selectionPinned.current = false;
    clearSelection();
    setTool(next);
  }, [clearSelection]);
  const activate = useCallback((next: ReaderTool) => {
    cancelExternal();
    finish(next);
  }, [cancelExternal, finish]);
  useEffect(() => {
    selectionPinned.current = false;
    setTool("pointer");
  }, [bookId]);
  useEffect(() => {
    const keydown = (event: KeyboardEvent) => {
      if (event.isComposing || event.key === "Process" || event.ctrlKey || event.altKey || event.metaKey) return;
      if (event.key === "Escape") {
        if (onEscape(event)) finish();
        return;
      }
      if ((event.target as HTMLElement)?.closest("input,textarea,select,[contenteditable]")) return;
      const shortcut = ({ v: "pointer", t: "text", r: "region" } as const)[event.key.toLowerCase() as "v" | "t" | "r"];
      if (shortcut && bookId) {
        event.preventDefault();
        activate(shortcut);
      }
    };
    window.addEventListener("keydown", keydown);
    return () => window.removeEventListener("keydown", keydown);
  }, [activate, bookId, finish, onEscape]);
  return { tool, preferences, setPreferences, selectionPinned, activate, finish, setTool };
}
