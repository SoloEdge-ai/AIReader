import { useEffect, useMemo, useSyncExternalStore } from "react";
import { NoteEditingSession } from "./NoteEditingSession";

export function useBookNotes(bookId?: string) {
  const session = useMemo(() => new NoteEditingSession(bookId), [bookId]);
  const snapshot = useSyncExternalStore(session.subscribe, session.getSnapshot);
  useEffect(() => {
    void session.refresh().catch(() => {});
    const warn = (event: BeforeUnloadEvent) => {
      if (session.getSnapshot().dirty) { event.preventDefault(); event.returnValue = ""; }
    };
    window.addEventListener("beforeunload", warn);
    return () => { session.pause(); window.removeEventListener("beforeunload", warn); };
  }, [session]);
  return {
    ...snapshot,
    setSelected: session.setSelected, edit: session.edit, flush: session.flush,
    selectAnnotation: session.selectAnnotation, comment: session.comment,
    removeAnnotation: session.removeAnnotation,
    retryWithLatest: session.retryWithLatest, refresh: session.refresh,
    create: session.create, remove: session.remove, color: session.color,
    undoLast: session.undoLast, recordUndo: session.recordUndo,
  };
}
export type BookNotes = ReturnType<typeof useBookNotes>;
