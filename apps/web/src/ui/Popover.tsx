import { useEffect, useId, useRef, useState, type ReactNode } from "react";

/** Shared native top-layer surface, bounded to the viewport rather than a feature panel. */
export function Popover({
  label,
  triggerLabel,
  trigger,
  triggerClass,
  className = "",
  disabled,
  placement = "bottom",
  width = 300,
  role = "dialog",
  autoFocusFirst = false,
  children,
}: {
  label: string;
  triggerLabel?: string;
  trigger: ReactNode;
  triggerClass?: string;
  className?: string;
  disabled?: boolean;
  placement?: "top" | "bottom";
  width?: number;
  role?: "dialog" | "menu";
  autoFocusFirst?: boolean;
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
        aria-label={triggerLabel ?? label}
        title={triggerLabel ?? label}
        aria-haspopup={role}
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
        role={role}
        aria-label={label}
        onKeyDown={(event) => {
          if (role !== "menu") return;
          const items = Array.from(panel.current?.querySelectorAll<HTMLElement>(
            '[role^="menuitem"]:not([disabled])',
          ) ?? []);
          const current = items.indexOf(document.activeElement as HTMLElement);
          const next = event.key === "ArrowDown" ? (current + 1) % items.length
            : event.key === "ArrowUp" ? (current + items.length - 1) % items.length
            : event.key === "Home" ? 0 : event.key === "End" ? items.length - 1 : -1;
          if (next < 0 || !items.length) return;
          event.preventDefault();
          items[next].focus({ preventScroll: true });
        }}
        onToggle={(e) => {
          setOpen(e.newState === "open");
          if (e.newState === "open" && autoFocusFirst)
            requestAnimationFrame(() => panel.current
              ?.querySelector<HTMLElement>('[role^="menuitem"]:not([disabled])')
              ?.focus({ preventScroll: true }));
          if (e.newState === "closed" &&
              (document.activeElement === document.body || panel.current?.contains(document.activeElement)))
            button.current?.focus({ preventScroll: true });
        }}
      >
        {children(close)}
      </div>
    </>
  );
}
