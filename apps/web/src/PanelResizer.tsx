export function PanelResizer({
  width,
  maximum,
  onChange,
  onCommit,
}: {
  width: number;
  maximum: number;
  onChange: (width: number) => void;
  onCommit: (width: number) => void;
}) {
  const clamp = (value: number) =>
    Math.round(Math.max(320, Math.min(maximum, value)));
  const fromPointer = (event: React.PointerEvent<HTMLDivElement>) =>
    clamp(
      event.currentTarget.parentElement!.getBoundingClientRect().right -
        event.clientX,
    );
  return (
    <div
      className="splitter"
      role="separator"
      tabIndex={0}
      aria-label="调整侧栏宽度"
      aria-orientation="vertical"
      aria-valuemin={320}
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
              ? 320
              : event.key === "End"
                ? maximum
                : width + (event.key === "ArrowLeft" ? 24 : -24),
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
