import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties } from "react";
import type { ReaderTool, ToolPreferences } from "../../../packages/protocol/src";
import { Icon } from "./ui/Icon";
import { Popover } from "./ui/Popover";
import { positionPopover } from "./ui/positionPopover";

const tools = [
  { id: "pointer", label: "指针（V）", icon: "pointer" },
  { id: "text", label: "选择文字（T）", icon: "textSelect" },
  { id: "region", label: "区域摘录（R）", icon: "crop" },
  { id: "pen", label: "画笔（P）", icon: "pen" },
  { id: "highlighter", label: "荧光笔（H）", icon: "highlighter" },
  { id: "eraser", label: "整笔橡皮（E）", icon: "eraser" },
  { id: "link", label: "关系连线", icon: "link" },
  { id: "lasso", label: "套索（L）", icon: "lasso" },
] as const;
const addTools = [
  { id: "free-text", label: "文本", icon: "textSelect" },
  { id: "note-card", label: "个人笔记卡片", icon: "note" },
  { id: "sticky", label: "页内便签", icon: "sticky" },
] as const;
const shapeTools = [
  { id: "rectangle", label: "矩形", icon: "rectangle" },
  { id: "ellipse", label: "椭圆", icon: "ellipse" },
  { id: "line", label: "直线", icon: "line" },
  { id: "arrow", label: "箭头", icon: "shapeArrow" },
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
  const settings = useRef<HTMLDivElement>(null);
  const [settingTool, setSettingTool] = useState<"pen" | "highlighter">("pen");
  const [brushOpen, setBrushOpen] = useState(false);
  const brushPlacement = preferences.dock === "bottom" ? "top"
    : preferences.dock === "left" ? "right" : "left";
  function placeBrush() {
    if (!palette.current || !settings.current) return;
    positionPopover(settings.current, palette.current, brushPlacement, 266, "center");
  }
  function updateBrush(patch: Partial<ToolPreferences["pen"]>) {
    onPreferences({ ...preferences, [settingTool]: { ...preferences[settingTool], ...patch } });
  }
  function openBrush(next: "pen" | "highlighter") {
    setSettingTool(next);
    settings.current?.showPopover();
    placeBrush();
  }
  useEffect(() => {
    if (!brushOpen) return;
    window.addEventListener("resize", placeBrush);
    window.addEventListener("scroll", placeBrush, true);
    return () => {
      window.removeEventListener("resize", placeBrush);
      window.removeEventListener("scroll", placeBrush, true);
    };
  }, [brushOpen, preferences.dock, preferences.offset]);
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
  const active = [...tools, ...addTools, ...shapeTools].find((item) => item.id === tool) ?? tools[0];
  const style = drag
    ? ({ left: drag.x, top: drag.y, transform: "translate(-50%, -50%)" } as CSSProperties)
    : ({
        "--tool-offset": `${(preferences.collapsed ? preferences.collapsedOffset : preferences.offset) * 100}%`,
        "--palette-half-width": preferences.collapsed ? "24px" : `${size.width / 2 + 16}px`,
        "--palette-half-height": preferences.collapsed ? "24px" : `${size.height / 2 + 16}px`,
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
          {tools.slice(0, 3).map((item) => (
            <button
              key={item.id}
              aria-label={item.label}
              title={item.label}
              aria-pressed={tool === item.id}
              onClick={() => {
                if ((item.id === "pen" || item.id === "highlighter") && tool === item.id)
                  openBrush(item.id);
                else {
                  if (settings.current?.matches(":popover-open")) settings.current.hidePopover();
                  onTool(item.id);
                }
              }}
            >
              <Icon name={item.icon} />
            </button>
          ))}
          <span className="palette-separator" />
          {tools.slice(3, 6).map((item) => (
            <button key={item.id} aria-label={item.label} title={item.label}
              aria-pressed={tool === item.id}
              onClick={() => {
                if ((item.id === "pen" || item.id === "highlighter") && tool === item.id)
                  openBrush(item.id);
                else { if (settings.current?.matches(":popover-open")) settings.current.hidePopover(); onTool(item.id); }
              }}><Icon name={item.icon} /></button>
          ))}
          <span className="palette-separator" />
          <Popover label="添加内容" triggerLabel="添加文本或卡片" trigger={<Icon name="plus" />}
            role="menu" className="reader-tool-menu" autoFocusFirst width={176}
            pressed={addTools.some((item) => item.id === tool)}
            placement={preferences.dock === "bottom" ? "top" : preferences.dock === "left" ? "right" : "left"}>
            {(close) => addTools.map((item) =>
              <button key={item.id} role="menuitem" onClick={() => { onTool(item.id); close(); }}>
                <Icon name={item.icon} />{item.label}
              </button>)}
          </Popover>
          <Popover label="添加形状" trigger={<Icon name="rectangle" />}
            role="menu" className="reader-tool-menu" autoFocusFirst width={176}
            pressed={shapeTools.some((item) => item.id === tool)}
            placement={preferences.dock === "bottom" ? "top" : preferences.dock === "left" ? "right" : "left"}>
            {(close) => shapeTools.map((item) =>
              <button key={item.id} role="menuitem" onClick={() => { onTool(item.id); close(); }}>
                <Icon name={item.icon} />{item.label}
              </button>)}
          </Popover>
          {tools.slice(6).map((item) => (
            <button key={item.id} aria-label={item.label} title={item.label}
              aria-pressed={tool === item.id} onClick={() => onTool(item.id)}>
              <Icon name={item.icon} /></button>
          ))}
          <span className="palette-separator" />
          <button
            aria-label="收起工具盘"
            title="收起工具盘"
            onClick={(event) => {
              const area = palette.current?.closest(".reading")?.getBoundingClientRect();
              if (!area) return onPreferences({ ...preferences, collapsed: true });
              const button = event.currentTarget.getBoundingClientRect();
              const clickX = event.detail === 0 ? button.left + button.width / 2 : event.clientX;
              const clickY = event.detail === 0 ? button.top + button.height / 2 : event.clientY;
              const collapsedOffset = preferences.dock === "bottom"
                ? (clickX - area.left) / area.width
                : (clickY - area.top) / area.height;
              onPreferences({ ...preferences, collapsed: true,
                collapsedOffset: Math.max(0, Math.min(1, collapsedOffset)) });
            }}
          >
            <Icon name="chevron" />
          </button>
        </>
      )}
      <div ref={settings} popover="auto" role="dialog" aria-label="画笔设置"
        className="reader-popover reader-brush-settings"
        onToggle={(event) => {
          setBrushOpen(event.newState === "open");
          if (event.newState === "open") requestAnimationFrame(placeBrush);
        }}>
        <header>{settingTool === "pen" ? "画笔" : "荧光笔"}<span>再次点击工具可调整</span></header>
        <div className="brush-swatches" role="group" aria-label="画笔颜色">
          {["#345d84", "#222222", "#d35e45", "#e6b72d", "#69b28d"].map((color) =>
            <button key={color} title={color} aria-label={`颜色 ${color}`}
              aria-pressed={preferences[settingTool].color === color}
              style={{ background: color }} onClick={() => updateBrush({ color })} />)}
          <input type="color" aria-label="自定义画笔颜色" value={preferences[settingTool].color}
            onChange={(event) => updateBrush({ color: event.target.value })} />
        </div>
        <label>粗细 <strong>{preferences[settingTool].width} px</strong></label>
        <div className="brush-sizes" role="group" aria-label="画笔粗细预设">
          {(settingTool === "pen" ? [1, 2, 4, 8, 12] : [6, 12, 18, 24, 32]).map((width) =>
            <button key={width} aria-label={`粗细 ${width}`} aria-pressed={preferences[settingTool].width === width}
              onClick={() => updateBrush({ width })}><span style={{ width: Math.min(22, width + 2), height: Math.min(22, width + 2) }} /></button>)}
        </div>
        <input type="range" aria-label="调整画笔粗细" min="0.5" max="40" step="0.5"
          value={preferences[settingTool].width} onChange={(event) => updateBrush({ width: Number(event.target.value) })} />
        <label>透明度 <strong>{Math.round(preferences[settingTool].opacity * 100)}%</strong></label>
        <input type="range" aria-label="调整画笔透明度" min="5" max="100" step="5"
          value={Math.round(preferences[settingTool].opacity * 100)}
          onChange={(event) => updateBrush({ opacity: Number(event.target.value) / 100 })} />
        <div className="brush-preview" aria-label="笔迹预览"><i style={{
          height: Math.max(1, preferences[settingTool].width),
          background: preferences[settingTool].color,
          opacity: preferences[settingTool].opacity,
        }} /></div>
      </div>
    </div>
  );
}
