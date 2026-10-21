import { useEffect, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { FloatingWindow } from "../../ui/floating-window/FloatingWindow";
import type { WindowBounds, WindowRect } from "../../ui/floating-window/geometry";
import "./questions.css";

const initialRect = (bounds: WindowBounds): WindowRect => ({
  x: Math.max(12, (bounds.width - 720) / 2), y: 72,
  width: Math.min(720, bounds.width - 24), height: Math.min(760, bounds.height - 96),
});
export function ResearchWindow({ title, children, onClose }: { title: string; children: ReactNode; onClose: () => void }) {
  const [bounds, setBounds] = useState({ width: innerWidth, height: innerHeight });
  const [rect, setRect] = useState<WindowRect>();
  useEffect(() => {
    const resize = () => setBounds({ width: innerWidth, height: innerHeight });
    addEventListener("resize", resize); return () => removeEventListener("resize", resize);
  }, []);
  return createPortal(<FloatingWindow title={title} label={title} className="research-window"
    rect={rect} bounds={bounds} defaultRect={initialRect} onCommit={setRect} onClose={onClose}>
    <div className="research-window-body">{children}</div>
  </FloatingWindow>, document.body);
}
