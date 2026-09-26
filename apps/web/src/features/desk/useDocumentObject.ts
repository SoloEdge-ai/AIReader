import { useEffect, useRef, useState, type PointerEvent } from "react";

export type DocumentRect = { x: number; y: number; width: number; height: number };
export const initialDocumentRect: DocumentRect = { x: 40, y: 64, width: 620, height: 720 };

/** Geometry is in desk units. Pointer motion is temporary; only release saves preferences. */
export function useDocumentObject(saved: DocumentRect | undefined, zoom: number,
  onCommit: (rect: DocumentRect) => void) {
  const rect = saved ?? initialDocumentRect;
  const [draft, setDraft] = useState<DocumentRect>();
  const pointer = useRef<{ id: number; x: number; y: number; rect: DocumentRect;
    resize: boolean; target: HTMLElement } | undefined>(undefined);
  function cancel() {
    const active = pointer.current;
    pointer.current = undefined; setDraft(undefined);
    if (active?.target.hasPointerCapture(active.id)) active.target.releasePointerCapture(active.id);
  }
  useEffect(() => {
    window.addEventListener("blur", cancel);
    return () => { window.removeEventListener("blur", cancel); cancel(); };
  }, []);
  function project(event: PointerEvent<HTMLElement>) {
    const active = pointer.current;
    if (!active || active.id !== event.pointerId) return;
    const dx = (event.clientX - active.x) / zoom, dy = (event.clientY - active.y) / zoom;
    return active.resize ? { ...active.rect, width: Math.max(360, Math.min(1600, active.rect.width + dx)),
      height: Math.max(320, Math.min(2000, active.rect.height + dy)) } : { ...active.rect,
      x: Math.max(0, Math.min(10000, active.rect.x + dx)), y: Math.max(0, Math.min(10000, active.rect.y + dy)) };
  }
  function handlers(resize = false) {
    return {
      onPointerDown(event: PointerEvent<HTMLElement>) {
        if (event.button || (event.target as HTMLElement).closest("button, input, select")) return;
        event.preventDefault(); event.stopPropagation();
        pointer.current = { id: event.pointerId, x: event.clientX, y: event.clientY, rect,
          resize, target: event.currentTarget };
        event.currentTarget.setPointerCapture(event.pointerId);
      },
      onPointerMove(event: PointerEvent<HTMLElement>) { const next = project(event); if (next) setDraft(next); },
      onPointerUp(event: PointerEvent<HTMLElement>) {
        const next = project(event); cancel(); if (next) onCommit(next);
      },
      onPointerCancel: cancel,
      onLostPointerCapture: cancel,
    };
  }
  return { rect: draft ?? rect, move: handlers(), resize: handlers(true) };
}
