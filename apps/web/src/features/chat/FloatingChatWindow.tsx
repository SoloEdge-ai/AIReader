import { useEffect, useRef, useState, type PointerEvent, type ReactNode } from "react";
import type { ChatWindowRect } from "../../../../../packages/protocol/src/preferences";
import { Icon } from "../../ui/Icon";
import {
  clampChatWindow, defaultChatWindow, moveChatWindow, persistedChatWindow, resizeChatWindow,
  type ResizeEdge, type WindowBounds,
} from "./floating-geometry";

const edges: ResizeEdge[] = ["n", "ne", "e", "se", "s", "sw", "w", "nw"];
const edgeNames: Record<ResizeEdge, string> = {
  n: "上", ne: "右上", e: "右", se: "右下", s: "下", sw: "左下", w: "左", nw: "左上",
};

type Gesture = {
  pointerId: number;
  target: HTMLElement;
  startX: number;
  startY: number;
  initial: ChatWindowRect;
  saved: ChatWindowRect;
  edge?: ResizeEdge;
};

export function FloatingChatWindow({ rect, bounds, onCommit, onClose, children }: {
  rect?: ChatWindowRect;
  bounds: WindowBounds;
  onCommit: (rect: ChatWindowRect) => void;
  onClose: () => void;
  children: ReactNode;
}) {
  const [frame, setFrame] = useState(() => clampChatWindow(rect ?? defaultChatWindow(bounds), bounds));
  const frameRef = useRef(frame);
  const savedRef = useRef(rect ?? defaultChatWindow(bounds));
  const gesture = useRef<Gesture | undefined>(undefined);
  function show(next: ChatWindowRect) {
    frameRef.current = next;
    setFrame(next);
  }
  useEffect(() => {
    if (!gesture.current) {
      savedRef.current = rect ?? defaultChatWindow(bounds);
      show(clampChatWindow(savedRef.current, bounds));
    }
  }, [rect, bounds.width, bounds.height]);
  function commit(display: ChatWindowRect, operation: "move" | "reset" | ResizeEdge, saved = savedRef.current) {
    const next = persistedChatWindow(display, saved, operation);
    savedRef.current = next;
    onCommit(next);
  }
  useEffect(() => {
    const cancel = () => {
      const current = gesture.current;
      if (!current) return;
      gesture.current = undefined;
      show(clampChatWindow(current.initial, bounds));
      if (current.target.hasPointerCapture(current.pointerId))
        current.target.releasePointerCapture(current.pointerId);
    };
    window.addEventListener("blur", cancel);
    return () => {
      window.removeEventListener("blur", cancel);
      const current = gesture.current;
      gesture.current = undefined;
      if (current?.target.hasPointerCapture(current.pointerId))
        current.target.releasePointerCapture(current.pointerId);
    };
  }, [bounds.width, bounds.height]);
  function begin(event: PointerEvent<HTMLElement>, edge?: ResizeEdge) {
    if (event.button !== 0 || gesture.current) return;
    if (!edge && (event.target as HTMLElement).closest("button")) return;
    event.preventDefault();
    gesture.current = {
      pointerId: event.pointerId, target: event.currentTarget,
      startX: event.clientX, startY: event.clientY,
      initial: frameRef.current, saved: savedRef.current, edge,
    };
    event.currentTarget.setPointerCapture(event.pointerId);
  }
  function project(event: PointerEvent<HTMLElement>) {
    const current = gesture.current;
    if (!current || current.pointerId !== event.pointerId) return;
    const dx = event.clientX - current.startX;
    const dy = event.clientY - current.startY;
    show(current.edge
      ? resizeChatWindow(current.initial, current.edge, dx, dy, bounds)
      : moveChatWindow(current.initial, dx, dy, bounds));
  }
  function finish(event: PointerEvent<HTMLElement>, cancelled = false) {
    const current = gesture.current;
    if (!current || current.pointerId !== event.pointerId) return;
    if (!cancelled) project(event);
    const next = cancelled ? current.initial : frameRef.current;
    gesture.current = undefined;
    if (event.currentTarget.hasPointerCapture(event.pointerId))
      event.currentTarget.releasePointerCapture(event.pointerId);
    if (cancelled) show(clampChatWindow(next, bounds));
    else if (next.x !== current.initial.x || next.y !== current.initial.y ||
      next.width !== current.initial.width || next.height !== current.initial.height)
      commit(next, current.edge ?? "move", current.saved);
  }
  function keyboardResize(event: React.KeyboardEvent<HTMLDivElement>, edge: ResizeEdge) {
    const step = event.shiftKey ? 48 : 16;
    const dx = event.key === "ArrowLeft" ? -step : event.key === "ArrowRight" ? step : 0;
    const dy = event.key === "ArrowUp" ? -step : event.key === "ArrowDown" ? step : 0;
    if ((!dx && !dy) || (dx && !/[ew]/.test(edge)) || (dy && !/[ns]/.test(edge))) return;
    event.preventDefault();
    const next = resizeChatWindow(frameRef.current, edge, dx, dy, bounds);
    show(next);
    commit(next, edge);
  }
  return <aside className="floating-chat" aria-label="AI 问答浮窗" style={{
    left: frame.x, top: frame.y, width: frame.width, height: frame.height,
  }}>
    <header className="floating-chat-header" aria-label="拖动移动问答浮窗" title="拖动移动问答浮窗"
      tabIndex={0}
      onPointerDown={(event) => begin(event)} onPointerMove={project}
      onPointerUp={finish} onPointerCancel={(event) => finish(event, true)}
      onKeyDown={(event) => {
        if (event.target !== event.currentTarget) return;
        const dx = event.key === "ArrowLeft" ? -24 : event.key === "ArrowRight" ? 24 : 0;
        const dy = event.key === "ArrowUp" ? -24 : event.key === "ArrowDown" ? 24 : 0;
        if (!dx && !dy) return;
        event.preventDefault();
        const next = moveChatWindow(frameRef.current, dx, dy, bounds);
        show(next); commit(next, "move");
      }}>
      <Icon name="grip" />
      <strong>问答</strong>
      <span className="floating-chat-hint">拖动移动</span>
      <button type="button" aria-label="重置问答浮窗" title="恢复默认位置和大小" onClick={() => {
        const next = defaultChatWindow(bounds);
        show(next); commit(next, "reset");
      }}><Icon name="reset" /></button>
      <button type="button" aria-label="关闭问答浮窗" title="关闭问答浮窗" onClick={onClose}>
        <Icon name="close" />
      </button>
    </header>
    {children}
    {edges.map((edge) => <div key={edge} className="floating-chat-resize" data-edge={edge}
      role={edge.length === 1 ? "separator" : "button"} tabIndex={0}
      aria-label={`调整问答浮窗${edgeNames[edge]}${edge.length === 1 ? "边缘" : "角落"}`}
      {...(edge.length === 1 ? {
        "aria-orientation": /[ew]/.test(edge) ? "vertical" as const : "horizontal" as const,
        "aria-valuemin": 320,
        "aria-valuemax": /[ew]/.test(edge) ? Math.max(320, bounds.width - 24) : Math.max(320, bounds.height - 72),
        "aria-valuenow": /[ew]/.test(edge) ? Math.round(frame.width) : Math.round(frame.height),
      } : {})}
      title="拖动调整大小 · 方向键微调"
      onPointerDown={(event) => begin(event, edge)} onPointerMove={project}
      onPointerUp={finish} onPointerCancel={(event) => finish(event, true)}
      onKeyDown={(event) => keyboardResize(event, edge)} />)}
  </aside>;
}
