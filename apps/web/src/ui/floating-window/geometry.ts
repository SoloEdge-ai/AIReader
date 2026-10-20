export type WindowRect = { x: number; y: number; width: number; height: number };

export type WindowBounds = { width: number; height: number };
export type ResizeEdge = "n" | "s" | "e" | "w" | "ne" | "nw" | "se" | "sw";
export type WindowConstraints = {
  inset?: number; topInset?: number; minimumWidth?: number; minimumHeight?: number;
  maximumWidth?: number; maximumHeight?: number;
};

const inset = 12;
const topInset = 60;
const minimumWidth = 320;
const minimumHeight = 320;

function limits(bounds: WindowBounds, constraints: WindowConstraints = {}) {
  const gap = constraints.inset ?? inset, top = constraints.topInset ?? topInset;
  return {
    inset: gap, topInset: top,
    minimumWidth: constraints.minimumWidth ?? minimumWidth,
    minimumHeight: constraints.minimumHeight ?? minimumHeight,
    maxWidth: Math.min(constraints.maximumWidth ?? Infinity, Math.max(1, bounds.width - gap * 2)),
    maxHeight: Math.min(constraints.maximumHeight ?? Infinity, Math.max(1, bounds.height - top - gap)),
  };
}

function between(value: number, minimum: number, maximum: number) {
  return Math.max(minimum, Math.min(maximum, value));
}

export function defaultWindow(bounds: WindowBounds): WindowRect {
  const { maxWidth, maxHeight } = limits(bounds);
  const width = Math.min(420, maxWidth);
  // Leave the bottom tool palette clear on the first open; users may resize over it later.
  const height = Math.min(680, maxHeight, Math.max(320, bounds.height - 162));
  return {
    x: Math.max(inset, bounds.width - width - 20),
    y: Math.min(72, Math.max(topInset, bounds.height - height - inset)),
    width,
    height,
  };
}

export function clampWindow(rect: WindowRect, bounds: WindowBounds, constraints?: WindowConstraints): WindowRect {
  const { maxWidth, maxHeight, inset, topInset, minimumWidth, minimumHeight } = limits(bounds, constraints);
  const width = between(rect.width, Math.min(minimumWidth, maxWidth), maxWidth);
  const height = between(rect.height, Math.min(minimumHeight, maxHeight), maxHeight);
  return {
    x: between(rect.x, inset, Math.max(inset, bounds.width - width - inset)),
    y: between(rect.y, topInset, Math.max(topInset, bounds.height - height - inset)),
    width,
    height,
  };
}

export function moveWindow(rect: WindowRect, dx: number, dy: number, bounds: WindowBounds, constraints?: WindowConstraints) {
  return clampWindow({ ...rect, x: rect.x + dx, y: rect.y + dy }, bounds, constraints);
}

export function resizeWindow(rect: WindowRect, edge: ResizeEdge, dx: number, dy: number, bounds: WindowBounds, constraints?: WindowConstraints) {
  const start = clampWindow(rect, bounds, constraints);
  const { maxWidth, maxHeight, inset, topInset, minimumWidth, minimumHeight } = limits(bounds, constraints);
  const minWidth = Math.min(minimumWidth, maxWidth);
  const minHeight = Math.min(minimumHeight, maxHeight);
  let left = start.x, right = start.x + start.width;
  let top = start.y, bottom = start.y + start.height;
  if (edge.includes("w")) left = between(left + dx, Math.max(inset, right - maxWidth), right - minWidth);
  if (edge.includes("e")) right = between(right + dx, left + minWidth, Math.min(bounds.width - inset, left + maxWidth));
  if (edge.includes("n")) top = between(top + dy, Math.max(topInset, bottom - maxHeight), bottom - minHeight);
  if (edge.includes("s")) bottom = between(bottom + dy, top + minHeight, Math.min(bounds.height - inset, top + maxHeight));
  return { x: left, y: top, width: right - left, height: bottom - top };
}

/** Keep axes unaffected by an interaction at their saved size when the viewport temporarily shrinks. */
export function persistedWindow(display: WindowRect, saved: WindowRect, operation: "move" | "reset" | ResizeEdge): WindowRect {
  const next = operation === "move"
    ? { ...display, width: saved.width, height: saved.height }
    : operation === "reset" || (/[ew]/.test(operation) && /[ns]/.test(operation))
      ? display
      : /[ew]/.test(operation)
        ? { ...display, y: saved.y, height: saved.height }
        : { ...display, x: saved.x, width: saved.width };
  // The native window is wide enough for this minimum. A narrow browser preview can
  // display less, but must not persist a rectangle rejected by the Core schema.
  return { ...next, width: Math.max(minimumWidth, next.width), height: Math.max(minimumHeight, next.height) };
}
