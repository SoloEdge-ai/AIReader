import { useSyncExternalStore } from "react";
import type { WorkspaceEditingSession } from "./features/workspace/WorkspaceEditingSession";

/** React subscription only; the book session owns drafts, commands and history. */
export function useWorkspace(session: WorkspaceEditingSession, externalEndpointIds: string[] = []) {
  session.setExternalEndpointIds(externalEndpointIds);
  const snapshot = useSyncExternalStore(session.subscribe, session.getSnapshot);
  return {
    ...snapshot,
    change: session.change, undo: session.undo, redo: session.redo,
    recordExternal: session.recordExternal, flush: session.flush,
    reload: session.reload, revision: session.revision,
    acceptExternal: session.acceptExternal,
  };
}
