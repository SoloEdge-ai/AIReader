import { useEffect, useMemo, useSyncExternalStore } from "react";
import { WorkspaceEditingSession } from "./features/workspace/WorkspaceEditingSession";

/** React subscription only; the book session owns drafts, commands and history. */
export function useWorkspace(bookId: string, externalEndpointIds: string[] = []) {
  const session = useMemo(() => new WorkspaceEditingSession(bookId), [bookId]);
  session.setExternalEndpointIds(externalEndpointIds);
  const snapshot = useSyncExternalStore(session.subscribe, session.getSnapshot);
  useEffect(() => {
    session.activate();
    void session.load();
    const warn = (event: BeforeUnloadEvent) => {
      if (session.isDirty()) { event.preventDefault(); event.returnValue = ""; }
    };
    window.addEventListener("beforeunload", warn);
    return () => { session.dispose(); window.removeEventListener("beforeunload", warn); };
  }, [session]);
  return {
    ...snapshot,
    change: session.change, undo: session.undo, redo: session.redo,
    recordExternal: session.recordExternal, flush: session.flush,
    reload: session.reload, revision: session.revision,
    acceptExternal: session.acceptExternal,
  };
}
