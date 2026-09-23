import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties } from "react";
import type { ReaderTool, ToolPreferences } from "../../../packages/protocol/src";
import { Icon } from "./Icon";

const tools = [
  { id: "pointer", label: "指针（V）", icon: "pointer" },
  { id: "text", label: "选择文字（T）", icon: "textSelect" },
  { id: "region", label: "区域摘录（R）", icon: "crop" },
  { id: "sticky", label: "页内便签", icon: "sticky" },
] as const;

export function ReaderToolPalette({
  tool,
  preferences,
  onTool,
  onPreferences,
}: {
  tool: ReaderTool;
  preferences: ToolPreferences;
  onTool: (tool: ReaderTool) => void;
  onPreferences: (next: ToolPreferences) => void;
}) {
  const [drag, setDrag] = useState<{ x: number; y: number }>();
  const moved = useRef(false);
  const palette = useRef<HTMLDivElement>(null);
  const grip = useRef<HTMLButtonElement>(null);
  const dragPointer = useRef<number | undefined>(undefined);
  const [size, setSize] = useState({ width: 0, height: 0 });
  useEffect(() => {
    const cancel = () => {
      const pointerId = dragPointer.current;
      if (pointerId !== undefined && grip.current?.hasPointerCapture(pointerId))
        grip.current.releasePointerCapture(pointerId);
      dragPointer.current = undefined;
      setDrag(undefined);
    };
    window.addEventListener("blur", cancel);
    return () => window.removeEventListener("blur", cancel);
  }, []);
  useLayoutEffect(() => {
    const node = palette.current;
    if (!node) return;
    const observer = new ResizeObserver(() =>
      setSize({ width: node.offsetWidth, height: node.offsetHeight }),
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, []);
  const active = tools.find((item) => item.id === tool) ?? tools[0];
  const style = drag
    ? ({ left: drag.x, top: drag.y, transform: "translate(-50%, -50%)" } as CSSProperties)
    : ({
        "--tool-offset": `${preferences.offset * 100}%`,
        "--palette-half-width": `${size.width / 2 + 16}px`,
        "--palette-half-height": `${size.height / 2 + 16}px`,
      } as CSSProperties);
  return (
    <div
      ref={palette}
      className={`reader-tool-palette ${preferences.collapsed ? "is-collapsed" : ""} ${drag ? "is-dragging" : ""}`}
      data-dock={preferences.dock}
      style={style}
      role="toolbar"
      aria-label="阅读工具盘"
      onPointerDown={(event) => event.stopPropagation()}
    >
      {!preferences.collapsed && (
        <button
          ref={grip}
          className="palette-grip"
          aria-label="拖动工具盘"
          title="拖动后靠近边缘以停靠"
          onPointerDown={(event) => {
            if (event.button !== 0) return;
            moved.current = false;
            dragPointer.current = event.pointerId;
            event.currentTarget.setPointerCapture(event.pointerId);
          }}
          onPointerMove={(event) => {
            if (!event.currentTarget.hasPointerCapture(event.pointerId)) return;
            const area = event.currentTarget.closest(".reading")?.getBoundingClientRect();
            if (!area) return;
            moved.current = true;
            setDrag({
              x: Math.max(24, Math.min(area.width - 24, event.clientX - area.left)),
              y: Math.max(24, Math.min(area.height - 24, event.clientY - area.top)),
            });
          }}
          onPointerUp={(event) => {
            if (!event.currentTarget.hasPointerCapture(event.pointerId)) return;
            event.currentTarget.releasePointerCapture(event.pointerId);
            dragPointer.current = undefined;
            const area = event.currentTarget.closest(".reading")?.getBoundingClientRect();
            if (area && moved.current) {
              const x = Math.max(0, Math.min(1, (event.clientX - area.left) / area.width));
              const y = Math.max(0, Math.min(1, (event.clientY - area.top) / area.height));
              const distances = [
                { dock: "bottom", distance: 1 - y, offset: x },
                { dock: "left", distance: x, offset: y },
                { dock: "right", distance: 1 - x, offset: y },
              ] as const;
              const nearest = [...distances].sort((a, b) => a.distance - b.distance)[0];
              onPreferences({ ...preferences, dock: nearest.dock, offset: nearest.offset });
            }
            setDrag(undefined);
          }}
          onPointerCancel={() => {
            dragPointer.current = undefined;
            setDrag(undefined);
          }}
        >
          <Icon name="grip" />
        </button>
      )}
      {preferences.collapsed ? (
        <button
          className="palette-current"
          aria-label={`展开工具盘，当前${active.label}`}
          title="展开工具盘"
          onClick={() => onPreferences({ ...preferences, collapsed: false })}
        >
          <Icon name={active.icon} />
        </button>
      ) : (
        <>
          {tools.map((item) => (
            <button
              key={item.id}
              aria-label={item.label}
              title={item.label}
              aria-pressed={tool === item.id}
              onClick={() => onTool(item.id)}
            >
              <Icon name={item.icon} />
            </button>
          ))}
          <span className="palette-separator" />
          <button
            aria-label="收起工具盘"
            title="收起工具盘"
            onClick={() => onPreferences({ ...preferences, collapsed: true })}
          >
            <Icon name="chevron" />
          </button>
        </>
      )}
    </div>
  );
}
