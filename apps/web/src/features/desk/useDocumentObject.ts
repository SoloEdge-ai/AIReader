import { useEffect, useRef, useState, type PointerEvent } from "react";
import { clampWindow, moveWindow, persistedWindow, resizeWindow, type ResizeEdge, type WindowBounds } from "../../ui/floating-window/geometry";

export type DocumentRect = { x: number; y: number; width: number; height: number };
export const initialDocumentRect: DocumentRect = { x: 40, y: 64, width: 620, height: 720 };
const constraints = { inset: 12, topInset: 12, minimumWidth: 360, minimumHeight: 320,
  maximumWidth: 1600, maximumHeight: 2000 };

/** Document geometry is relative to the reading surface, independent of the board camera.
 * Pointer motion is temporary; only release saves preferences. */
export function useDocumentObject(saved: DocumentRect | undefined,
  onCommit: (rect: DocumentRect) => void, bounds?: WindowBounds & { topInset: number }) {
  const displayConstraints = { ...constraints, topInset: bounds?.topInset ?? constraints.topInset };
  const preferred = saved ?? initialDocumentRect;
  const rect = bounds ? clampWindow(preferred, bounds, displayConstraints) : preferred;
  const [draft, setDraft] = useState<DocumentRect>();
  const pointer = useRef<{ id: number; x: number; y: number; rect: DocumentRect;
    edge?: ResizeEdge; saved: DocumentRect; target: HTMLElement } | undefined>(undefined);
  function cancel() {
    const active = pointer.current;
    pointer.current = undefined; setDraft(undefined);
    if (active?.target.hasPointerCapture(active.id)) active.target.releasePointerCapture(active.id);
  }
  useEffect(() => {
    const escape = (event: KeyboardEvent) => {
      if (!event.isComposing && event.key === "Escape" && pointer.current) {
        event.preventDefault(); event.stopImmediatePropagation(); cancel();
      }
    };
    window.addEventListener("keydown", escape, true);
    window.addEventListener("blur", cancel);
    return () => { window.removeEventListener("blur", cancel); window.removeEventListener("keydown", escape, true); cancel(); };
  }, []);
  useEffect(() => { cancel(); }, [bounds?.width, bounds?.height, bounds?.topInset]);
  function commit(next: DocumentRect, operation: "move" | ResizeEdge, original = preferred) {
    onCommit(persistedWindow(next, original, operation));
  }
  function project(event: PointerEvent<HTMLElement>) {
    const active = pointer.current;
    if (!active || active.id !== event.pointerId) return;
    const dx = event.clientX - active.x, dy = event.clientY - active.y;
    if (!bounds) return;
    return active.edge ? resizeWindow(active.rect, active.edge, dx, dy, bounds, displayConstraints)
      : moveWindow(active.rect, dx, dy, bounds, displayConstraints);
  }
  function handlers(edge?: ResizeEdge) {
    return {
      onPointerDown(event: PointerEvent<HTMLElement>) {
        if (event.button || (event.target as HTMLElement).closest("button, input, select")) return;
        event.preventDefault(); event.stopPropagation();
        pointer.current = { id: event.pointerId, x: event.clientX, y: event.clientY, rect, saved: preferred,
          edge, target: event.currentTarget };
        event.currentTarget.setPointerCapture(event.pointerId);
      },
      onPointerMove(event: PointerEvent<HTMLElement>) { const next = project(event); if (next) setDraft(next); },
      onPointerUp(event: PointerEvent<HTMLElement>) {
        const active = pointer.current, next = project(event); cancel();
        if (next && active && (next.x !== active.rect.x || next.y !== active.rect.y ||
            next.width !== active.rect.width || next.height !== active.rect.height)) commit(next, active.edge ?? "move", active.saved);
      },
      onPointerCancel: cancel,
      onLostPointerCapture: cancel,
    };
  }
  return { rect: draft ?? rect, move: handlers(), resize: handlers("se"), resizeWidth: handlers("e"),
    moveBy: (dx: number, dy: number) => { if (bounds) commit(moveWindow(rect, dx, dy, bounds, displayConstraints), "move"); },
    resizeBy: (edge: ResizeEdge, dx: number, dy: number) => {
      if (bounds) commit(resizeWindow(rect, edge, dx, dy, bounds, displayConstraints), edge);
    } };
}
