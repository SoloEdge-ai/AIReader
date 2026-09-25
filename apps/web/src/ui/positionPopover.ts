export type PopoverPlacement = "top" | "bottom" | "left" | "right";

/** Place a native top-layer popover relative to an anchor, within the viewport. */
export function positionPopover(
  panel: HTMLElement,
  anchor: HTMLElement,
  placement: PopoverPlacement,
  width: number,
  align: "start" | "center" = "start",
): void {
  const rect = anchor.getBoundingClientRect();
  const size = Math.min(width, innerWidth - 16);
  if (placement === "left" || placement === "right") {
    const leftRoom = rect.left - 16, rightRoom = innerWidth - rect.right - 16;
    const useLeft = placement === "left"
      ? leftRoom >= size + 8 || leftRoom >= rightRoom
      : rightRoom < size + 8 && leftRoom > rightRoom;
    Object.assign(panel.style, {
      width: `${size}px`,
      left: `${Math.max(8, Math.min(innerWidth - size - 8,
        useLeft ? rect.left - size - 8 : rect.right + 8))}px`,
      top: `${Math.max(8, Math.min(rect.top, innerHeight - panel.offsetHeight - 8))}px`,
      bottom: "auto",
      maxHeight: `${Math.max(0, innerHeight - 16)}px`,
    });
    return;
  }
  const above = rect.top - 16,
    below = innerHeight - rect.bottom - 16;
  const useAbove = placement === "top"
    ? above >= 180 || above >= below
    : below < 180 && above > below;
  const desiredLeft = align === "center" ? rect.left + rect.width / 2 - size / 2 : rect.left;
  Object.assign(panel.style, {
    width: `${size}px`,
    left: `${Math.max(8, Math.min(desiredLeft, innerWidth - size - 8))}px`,
    top: useAbove ? "auto" : `${rect.bottom + 8}px`,
    bottom: useAbove ? `${innerHeight - rect.top + 8}px` : "auto",
    maxHeight: `${Math.max(0, useAbove ? above : below)}px`,
  });
}
