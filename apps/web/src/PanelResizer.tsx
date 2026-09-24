export function PanelResizer({
  width,
  maximum,
  minimum = 320,
  side = "right",
  label = "调整侧栏宽度",
  onChange,
  onCommit,
}: {
  width: number;
  maximum: number;
  minimum?: number;
  side?: "left" | "right";
  label?: string;
  onChange: (width: number) => void;
  onCommit: (width: number) => void;
}) {
  const clamp = (value: number) =>
    Math.round(Math.max(minimum, Math.min(maximum, value)));
  const fromPointer = (event: React.PointerEvent<HTMLDivElement>) =>
    clamp(
      side === "left"
        ? event.clientX - event.currentTarget.parentElement!.getBoundingClientRect().left
        : event.currentTarget.parentElement!.getBoundingClientRect().right - event.clientX,
    );
  return (
    <div
      className={`splitter ${side === "left" ? "navigation-resizer" : ""}`}
      role="separator"
      tabIndex={0}
      aria-label={label}
      aria-orientation="vertical"
      aria-valuemin={minimum}
      aria-valuemax={maximum}
      aria-valuenow={width}
      title="拖动调整宽度 · 方向键微调"
      onKeyDown={(event) => {
        if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key))
          return;
        event.preventDefault();
        onCommit(
          clamp(
            event.key === "Home"
              ? minimum
              : event.key === "End"
                ? maximum
                : width + (event.key === "ArrowLeft" ? (side === "left" ? -24 : 24) : (side === "left" ? 24 : -24)),
          ),
        );
      }}
      onPointerDown={(event) => {
        if (event.button !== 0) return;
        event.preventDefault();
        event.currentTarget.focus();
        event.currentTarget.setPointerCapture(event.pointerId);
      }}
      onPointerMove={(event) => {
        if (event.currentTarget.hasPointerCapture(event.pointerId))
          onChange(fromPointer(event));
      }}
      onPointerUp={(event) => {
        if (!event.currentTarget.hasPointerCapture(event.pointerId)) return;
        onCommit(fromPointer(event));
        event.currentTarget.releasePointerCapture(event.pointerId);
      }}
      onPointerCancel={() => onCommit(width)}
    />
  );
}
