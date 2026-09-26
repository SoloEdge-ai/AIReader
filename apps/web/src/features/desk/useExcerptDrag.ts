import { useEffect, useRef, useState, type PointerEvent } from "react";
import type { ReadingSelection } from "../../../../../packages/protocol/src";

/** Freeze the real PDF anchors before native selection can collapse on re-grab. */
export function useExcerptDrag(onDrop: (selection: ReadingSelection, x: number, y: number) => void) {
  const [preview, setPreview] = useState<{ x: number; y: number; text: string }>();
  const active = useRef<{ id: number; x: number; y: number; selection: ReadingSelection;
    moved: boolean; target: HTMLElement } | undefined>(undefined);
  const drop = useRef(onDrop); drop.current = onDrop;
  useEffect(() => {
    const cancel = () => {
      const current = active.current; active.current = undefined; setPreview(undefined);
      if (current?.target.hasPointerCapture(current.id)) current.target.releasePointerCapture(current.id);
    };
    const move = (event: globalThis.PointerEvent) => {
      const current = active.current;
      if (!current || current.id !== event.pointerId) return;
      if (Math.hypot(event.clientX - current.x, event.clientY - current.y) < 5 && !current.moved) return;
      current.moved = true;
      setPreview({ x: event.clientX, y: event.clientY, text: current.selection.text });
    };
    const finish = (event: globalThis.PointerEvent) => {
      const current = active.current;
      if (!current || current.id !== event.pointerId) return;
      cancel();
      if (current.moved) drop.current(current.selection, event.clientX, event.clientY);
    };
    const escape = (event: KeyboardEvent) => { if (!event.isComposing && event.key === "Escape") cancel(); };
    window.addEventListener("pointermove", move); window.addEventListener("pointerup", finish);
    window.addEventListener("pointercancel", cancel); window.addEventListener("blur", cancel);
    window.addEventListener("keydown", escape);
    return () => {
      cancel(); window.removeEventListener("pointermove", move); window.removeEventListener("pointerup", finish);
      window.removeEventListener("pointercancel", cancel); window.removeEventListener("blur", cancel);
      window.removeEventListener("keydown", escape);
    };
  }, []);
  function begin(event: PointerEvent<HTMLElement>, selection?: ReadingSelection): boolean {
    if (!selection || event.button !== 0 || !(event.target as HTMLElement).closest(".pdf-pane .textLayer")) return false;
    const native = window.getSelection();
    if (!native?.rangeCount || native.isCollapsed) return false;
    const hit = [...native.getRangeAt(0).getClientRects()].some((rect) => event.clientX >= rect.left &&
      event.clientX <= rect.right && event.clientY >= rect.top && event.clientY <= rect.bottom);
    if (!hit) return false;
    event.preventDefault(); event.stopPropagation();
    active.current = { id: event.pointerId, x: event.clientX, y: event.clientY,
      selection: structuredClone(selection), moved: false, target: event.currentTarget };
    event.currentTarget.setPointerCapture(event.pointerId);
    return true;
  }
  return { begin, preview };
}
