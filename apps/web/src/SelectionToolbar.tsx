import { useLayoutEffect, useRef, useState } from "react";
import type { Annotation, ReadingSelection } from "../../../packages/protocol/src";
import { Icon } from "./ui/Icon";
import { Popover } from "./ui/Popover";
import { ColorPopover } from "./ui/ColorPopover";
import { annotationColors } from "./ui/annotationColors";

export function SelectionToolbar({
  selection,
  color,
  onColor,
  onExcerpt,
  onExcerptDragStart,
  onExcerptDragEnd,
  onAnnotate,
  onAi,
  onFocus,
  onDismiss,
  onInteract,
}: {
  selection: ReadingSelection;
  color: Annotation["color"];
  onColor: (color: Annotation["color"]) => void;
  onExcerpt: () => void;
  onExcerptDragStart?: () => void;
  onExcerptDragEnd?: () => void;
  onAnnotate: (kind: "highlight" | "underline" | "strike") => void;
  onAi: (name: string) => void;
  onFocus: () => void;
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
      <button draggable aria-label="拖动摘录到工作台" title="拖入工作台以指定卡片位置，也可点击摘录"
        onClick={onExcerpt}
        onDragStart={(event) => {
          event.dataTransfer.setData("application/x-aireader-excerpt", "frozen-selection");
          event.dataTransfer.effectAllowed = "copy";
          onExcerptDragStart?.();
        }}
        onDragEnd={onExcerptDragEnd}>⠿</button>
      <button onClick={onFocus} title="只看所选原文附近的页面区域">聚焦原文</button>
      <Popover label="标注方式" trigger={<><Icon name="pen" /><span>标注</span></>} width={168}>
        {(close) => <div className="reader-context-menu">
          {(["highlight", "underline", "strike"] as const).map((kind, index) => (
            <button key={kind} onClick={() => { onAnnotate(kind); close(); }}>
              {["高亮", "下划线", "删除线"][index]}
            </button>
          ))}
        </div>}
      </Popover>
      <ColorPopover label="标注颜色" value={color} options={annotationColors} onChange={(value) => {
        const option = annotationColors.find((item) => item.value === value);
        if (option) onColor(option.value);
      }} />
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
