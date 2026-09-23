import { useEffect, useId, useRef, useState, type ReactNode } from "react";

/** Native top-layer surface, bounded to the viewport instead of the reader panel. */
export function Popover({
  label,
  trigger,
  triggerClass,
  className = "",
  disabled,
  placement = "bottom",
  width = 300,
  children,
}: {
  label: string;
  trigger: ReactNode;
  triggerClass?: string;
  className?: string;
  disabled?: boolean;
  placement?: "top" | "bottom";
  width?: number;
  children: (close: () => void) => ReactNode;
}) {
  const id = useId(),
    panel = useRef<HTMLDivElement>(null),
    button = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  function position() {
    if (!button.current || !panel.current) return;
    const rect = button.current.getBoundingClientRect();
    const above = rect.top - 16,
      below = innerHeight - rect.bottom - 16;
    const useAbove =
      placement === "top"
        ? above >= 180 || above >= below
        : below < 180 && above > below;
    const size = Math.min(width, innerWidth - 16);
    Object.assign(panel.current.style, {
      width: `${size}px`,
      left: `${Math.max(8, Math.min(rect.left, innerWidth - size - 8))}px`,
      top: useAbove ? "auto" : `${rect.bottom + 8}px`,
      bottom: useAbove ? `${innerHeight - rect.top + 8}px` : "auto",
      maxHeight: `${Math.max(0, useAbove ? above : below)}px`,
    });
  }
  function close() {
    panel.current?.hidePopover();
    button.current?.focus({ preventScroll: true });
  }
  useEffect(() => {
    if (!open) return;
    window.addEventListener("resize", position);
    window.addEventListener("scroll", position, true);
    return () => {
      window.removeEventListener("resize", position);
      window.removeEventListener("scroll", position, true);
    };
  }, [open, placement, width]);
  useEffect(() => {
    if (disabled) panel.current?.hidePopover();
  }, [disabled]);
  return (
    <>
      <button
        ref={button}
        className={triggerClass}
        disabled={disabled}
        aria-label={label}
        title={label}
        aria-haspopup="dialog"
        aria-expanded={open}
        popoverTarget={id}
        onClick={position}
      >
        {trigger}
      </button>
      <div
        ref={panel}
        id={id}
        className={`reader-popover ${className}`}
        popover="auto"
        role="dialog"
        aria-label={label}
        onToggle={(e) => setOpen(e.newState === "open")}
      >
        {children(close)}
      </div>
    </>
  );
}
