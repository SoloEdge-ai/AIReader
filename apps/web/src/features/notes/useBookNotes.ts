import { useSyncExternalStore } from "react";
import type { NoteEditingSession } from "./NoteEditingSession";

export function useBookNotes(session: NoteEditingSession) {
  const snapshot = useSyncExternalStore(session.subscribe, session.getSnapshot);
  return {
    ...snapshot,
    getSnapshot: session.getSnapshot,
    setSelected: session.setSelected, edit: session.edit, flush: session.flush,
    selectAnnotation: session.selectAnnotation, comment: session.comment, promoteCard: session.promoteCard,
    removeAnnotation: session.removeAnnotation,
    retryWithLatest: session.retryWithLatest, refresh: session.refresh,
    create: session.create, remove: session.remove, color: session.color,
    undoLast: session.undoLast, recordUndo: session.recordUndo,
  };
}
export type BookNotes = ReturnType<typeof useBookNotes>;
