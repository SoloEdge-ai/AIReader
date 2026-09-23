import { useLayoutEffect, useRef, useState } from "react";
import type { Annotation, ReadingSelection } from "../../../packages/protocol/src";
import { Icon } from "./Icon";
import { Popover } from "./Popover";

const colors = [
  { id: "yellow", name: "黄色", hex: "#f5d549" },
  { id: "green", name: "绿色", hex: "#60c88c" },
  { id: "blue", name: "蓝色", hex: "#65a8ed" },
  { id: "pink", name: "粉色", hex: "#eb88b4" },
] as const;

export function SelectionToolbar({
  selection,
  color,
  onColor,
  onExcerpt,
  onAnnotate,
  onAi,
  onDismiss,
  onInteract,
}: {
  selection: ReadingSelection;
  color: Annotation["color"];
  onColor: (color: Annotation["color"]) => void;
  onExcerpt: () => void;
  onAnnotate: (kind: "highlight" | "underline" | "strike") => void;
  onAi: (name: string) => void;
  onDismiss: () => void;
  onInteract: () => void;
}) {
  const bar = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState({ left: 8, top: 65, maxWidth: 360 });
  const [compact, setCompact] = useState(false);
  useLayoutEffect(() => {
    const node = bar.current;
    const reading = node?.closest(".reading");
    if (!node || !reading) return;
    const update = () => {
      const bounds = reading.getBoundingClientRect();
      setCompact(bounds.width < 560);
      const width = node.offsetWidth;
      const height = node.offsetHeight;
      const selected = getSelection();
      const range = selected?.rangeCount && selected.toString().trim()
        ? selected.getRangeAt(0).getBoundingClientRect()
        : undefined;
      const x = range?.width ? range.left + range.width / 2 : selection.screen.x;
      const y = range?.height ? range.bottom : selection.screen.y;
      const yTop = range?.height ? range.top : selection.screen.y;
      const left = Math.max(bounds.left + 8, Math.min(bounds.right - width - 8, x - width / 2));
      const below = y + 12;
      const above = yTop - height - 12;
      const palette = reading.querySelector(".reader-tool-palette")?.getBoundingClientRect();
      const clear = (top: number) => top >= bounds.top + 8 && top + height <= bounds.bottom - 8 &&
        (!palette || left + width <= palette.left || left >= palette.right ||
          top + height <= palette.top || top >= palette.bottom);
      const top = clear(below) ? below : clear(above) ? above
        : Math.max(bounds.top + 8, Math.min(bounds.bottom - height - 8,
            palette && left < palette.right && left + width > palette.left
              ? palette.top - height - 8 : below));
      setPosition({ left, top, maxWidth: Math.max(120, bounds.width - 16) });
    };
    update();
    const resize = new ResizeObserver(update);
    resize.observe(reading);
    resize.observe(node);
    window.addEventListener("scroll", update, true);
    return () => {
      resize.disconnect();
      window.removeEventListener("scroll", update, true);
    };
  }, [selection]);
  return (
    <div
      ref={bar}
      className={`reader-context-bar selection-bar${compact ? " is-compact" : ""}`}
      role="toolbar"
      aria-label="文字选区操作"
      style={position}
      onPointerDownCapture={onInteract}
    >
      <span className="context-count">{selection.text.length} 字</span>
      <button onClick={onExcerpt} title="将文字和来源放到白板">摘录卡片</button>
      <Popover label="标注方式" trigger={<><Icon name="pen" /><span>标注</span></>} width={168}>
        {(close) => <div className="reader-context-menu">
          {(["highlight", "underline", "strike"] as const).map((kind, index) => (
            <button key={kind} onClick={() => { onAnnotate(kind); close(); }}>
              {["高亮", "下划线", "删除线"][index]}
            </button>
          ))}
        </div>}
      </Popover>
      <Popover
        label={`标注颜色：${colors.find((item) => item.id === color)?.name}`}
        trigger={<span className="reader-color-dot" style={{ background: colors.find((item) => item.id === color)?.hex }} />}
        width={180}
      >
        {(close) => <div className="reader-color-options">
          {colors.map((item) => <button key={item.id} aria-label={item.name} aria-pressed={color === item.id} onClick={() => { onColor(item.id); close(); }}>
            <span className="reader-color-dot" style={{ background: item.hex }} />{item.name}
          </button>)}
        </div>}
      </Popover>
      <Popover label="AI 处理选区" trigger={<><Icon name="bolt" /><span>AI</span></>} width={150}>
        {(close) => <div className="reader-context-menu">
          {["提问", "解释", "总结", "翻译"].map((name) => <button key={name} onClick={() => { onAi(name); close(); }}>{name}</button>)}
        </div>}
      </Popover>
      <Popover label="更多选区操作" trigger={<Icon name="more" />} width={150}>
        {(close) => <div className="reader-context-menu">
          <button onClick={() => { void navigator.clipboard.writeText(selection.text); close(); }}>复制文字</button>
        </div>}
      </Popover>
      <button aria-label="取消选区" title="取消选区" onClick={onDismiss}><Icon name="close" /></button>
    </div>
  );
}
