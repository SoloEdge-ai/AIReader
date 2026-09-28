export type ConnectionPoint = Readonly<{ x: number; y: number }>;

export type ConnectionRect = Readonly<{
  left: number;
  top: number;
  width: number;
  height: number;
}>;

export type ConnectionAnchor = ConnectionPoint | ConnectionRect;

export type ConnectionKind = "source" | "relation" | "ai-preview" | "ai-frozen";

export type ConnectionEdge = "top" | "right" | "bottom" | "left";

export type ConnectionOffscreenMetadata = Readonly<{
  /** A short viewport-edge label, for example `p. 42`. */
  label?: string;
}>;

export type ConnectionOverlayItem = Readonly<{
  id: string;
  from: ConnectionAnchor;
  to: ConnectionAnchor;
  kind: ConnectionKind;
  label?: string;
  selected?: boolean;
  /**
   * Presence forces that endpoint onto the container edge. Geometry also
   * detects endpoints that are outside the container when this is omitted.
   */
  offscreen?: Readonly<{
    from?: true | ConnectionOffscreenMetadata;
    to?: true | ConnectionOffscreenMetadata;
  }>;
  /** AI connections sharing this key are routed as one visual bundle. */
  convergeKey?: string;
}>;

export type ProjectedEndpoint = Readonly<{
  point: ConnectionPoint;
  offscreen: boolean;
  edge?: ConnectionEdge;
  edgeLabel?: string;
}>;

export type BezierCurve = Readonly<{
  path: string;
  control1: ConnectionPoint;
  control2: ConnectionPoint;
  midpoint: ConnectionPoint;
}>;

export type ProjectedConnection = Readonly<{
  id: string;
  kind: ConnectionKind;
  label?: string;
  selected: boolean;
  from: ProjectedEndpoint;
  to: ProjectedEndpoint;
  curve: BezierCurve;
  convergenceOffset: number;
}>;

const EPSILON = 0.0001;

function finite(value: number, fallback = 0) {
  return Number.isFinite(value) ? value : fallback;
}

function round(value: number) {
  const result = Math.round(value * 100) / 100;
  return Object.is(result, -0) ? 0 : result;
}

function normalizedRect(rect: ConnectionRect): ConnectionRect {
  return {
    left: finite(rect.left),
    top: finite(rect.top),
    width: Math.max(0, finite(rect.width)),
    height: Math.max(0, finite(rect.height)),
  };
}

export function isConnectionRect(
  anchor: ConnectionAnchor,
): anchor is ConnectionRect {
  return (
    "left" in anchor &&
    "top" in anchor &&
    "width" in anchor &&
    "height" in anchor
  );
}

export function rectCenter(rect: ConnectionRect): ConnectionPoint {
  const normalized = normalizedRect(rect);
  return {
    x: normalized.left + normalized.width / 2,
    y: normalized.top + normalized.height / 2,
  };
}

export function anchorCenter(anchor: ConnectionAnchor): ConnectionPoint {
  return isConnectionRect(anchor)
    ? rectCenter(anchor)
    : { x: finite(anchor.x), y: finite(anchor.y) };
}

export function clampPointToRect(
  point: ConnectionPoint,
  rect: ConnectionRect,
  inset = 0,
): ConnectionPoint {
  const normalized = normalizedRect(rect);
  const safeInset = Math.max(
    0,
    Math.min(finite(inset), normalized.width / 2, normalized.height / 2),
  );
  const left = normalized.left + safeInset;
  const right = normalized.left + normalized.width - safeInset;
  const top = normalized.top + safeInset;
  const bottom = normalized.top + normalized.height - safeInset;
  return {
    x: Math.min(right, Math.max(left, finite(point.x))),
    y: Math.min(bottom, Math.max(top, finite(point.y))),
  };
}

/**
 * Finds where a ray starting inside `rect` exits its edge. The function is
 * also safe for a zero-area rectangle, which is treated as a point.
 */
export function intersectRectEdge(
  rect: ConnectionRect,
  origin: ConnectionPoint,
  toward: ConnectionPoint,
): ConnectionPoint {
  const normalized = normalizedRect(rect);
  if (normalized.width <= EPSILON || normalized.height <= EPSILON)
    return rectCenter(normalized);
  const start = clampPointToRect(origin, normalized);
  const dx = finite(toward.x) - start.x;
  const dy = finite(toward.y) - start.y;
  if (Math.abs(dx) <= EPSILON && Math.abs(dy) <= EPSILON) return start;

  const right = normalized.left + normalized.width;
  const bottom = normalized.top + normalized.height;
  const candidates: Array<{ t: number; point: ConnectionPoint }> = [];
  if (Math.abs(dx) > EPSILON) {
    for (const x of [normalized.left, right]) {
      const t = (x - start.x) / dx;
      const y = start.y + t * dy;
      if (t >= 0 && y >= normalized.top - EPSILON && y <= bottom + EPSILON)
        candidates.push({ t, point: { x, y } });
    }
  }
  if (Math.abs(dy) > EPSILON) {
    for (const y of [normalized.top, bottom]) {
      const t = (y - start.y) / dy;
      const x = start.x + t * dx;
      if (t >= 0 && x >= normalized.left - EPSILON && x <= right + EPSILON)
        candidates.push({ t, point: { x, y } });
    }
  }
  candidates.sort((a, b) => a.t - b.t);
  return candidates[0]?.point ?? clampPointToRect(toward, normalized);
}

export function convergenceOffsets(
  count: number,
  spacing = 10,
  maxSpread = 28,
): number[] {
  const safeCount = Math.max(0, Math.floor(finite(count)));
  if (!safeCount) return [];
  if (safeCount === 1) return [0];
  const center = (safeCount - 1) / 2;
  const raw = Array.from(
    { length: safeCount },
    (_, index) => (index - center) * Math.max(0, finite(spacing)),
  );
  const largest = Math.max(...raw.map(Math.abs));
  const scale =
    largest > maxSpread && largest > 0 ? Math.max(0, maxSpread) / largest : 1;
  return raw.map((offset) => round(offset * scale));
}

function cubicPoint(
  from: ConnectionPoint,
  control1: ConnectionPoint,
  control2: ConnectionPoint,
  to: ConnectionPoint,
  t: number,
): ConnectionPoint {
  const inverse = 1 - t;
  return {
    x:
      inverse ** 3 * from.x +
      3 * inverse ** 2 * t * control1.x +
      3 * inverse * t ** 2 * control2.x +
      t ** 3 * to.x,
    y:
      inverse ** 3 * from.y +
      3 * inverse ** 2 * t * control1.y +
      3 * inverse * t ** 2 * control2.y +
      t ** 3 * to.y,
  };
}

export function createBezierCurve(
  from: ConnectionPoint,
  to: ConnectionPoint,
  approachOffset = 0,
): BezierCurve {
  const safeFrom = { x: finite(from.x), y: finite(from.y) };
  const safeTo = { x: finite(to.x), y: finite(to.y) };
  const dx = safeTo.x - safeFrom.x;
  const dy = safeTo.y - safeFrom.y;
  if (Math.abs(dx) <= EPSILON && Math.abs(dy) <= EPSILON) {
    const path = `M ${round(safeFrom.x)} ${round(safeFrom.y)}`;
    return {
      path,
      control1: safeFrom,
      control2: safeTo,
      midpoint: safeFrom,
    };
  }

  const horizontal = Math.abs(dx) >= Math.abs(dy);
  const dominantDistance = horizontal ? Math.abs(dx) : Math.abs(dy);
  const bend = Math.min(180, Math.max(28, dominantDistance * 0.38));
  const offset = finite(approachOffset);
  const control1 = horizontal
    ? {
        x: safeFrom.x + Math.sign(dx || 1) * bend,
        y: safeFrom.y + offset * 0.18,
      }
    : {
        x: safeFrom.x + offset * 0.18,
        y: safeFrom.y + Math.sign(dy || 1) * bend,
      };
  const control2 = horizontal
    ? {
        x: safeTo.x - Math.sign(dx || 1) * bend,
        y: safeTo.y + offset,
      }
    : {
        x: safeTo.x + offset,
        y: safeTo.y - Math.sign(dy || 1) * bend,
      };
  const midpoint = cubicPoint(safeFrom, control1, control2, safeTo, 0.5);
  return {
    path: `M ${round(safeFrom.x)} ${round(safeFrom.y)} C ${round(control1.x)} ${round(control1.y)}, ${round(control2.x)} ${round(control2.y)}, ${round(safeTo.x)} ${round(safeTo.y)}`,
    control1,
    control2,
    midpoint,
  };
}

export function bezierPath(
  from: ConnectionPoint,
  to: ConnectionPoint,
  approachOffset = 0,
) {
  return createBezierCurve(from, to, approachOffset).path;
}

function pointInside(point: ConnectionPoint, rect: ConnectionRect) {
  const normalized = normalizedRect(rect);
  return (
    point.x >= normalized.left &&
    point.x <= normalized.left + normalized.width &&
    point.y >= normalized.top &&
    point.y <= normalized.top + normalized.height
  );
}

function rectIntersects(a: ConnectionRect, b: ConnectionRect) {
  const left = Math.max(a.left, b.left);
  const right = Math.min(a.left + a.width, b.left + b.width);
  const top = Math.max(a.top, b.top);
  const bottom = Math.min(a.top + a.height, b.top + b.height);
  return right >= left && bottom >= top;
}

function localAnchor(
  anchor: ConnectionAnchor,
  container: ConnectionRect,
): ConnectionAnchor {
  if (isConnectionRect(anchor))
    return {
      left: finite(anchor.left) - container.left,
      top: finite(anchor.top) - container.top,
      width: Math.max(0, finite(anchor.width)),
      height: Math.max(0, finite(anchor.height)),
    };
  return {
    x: finite(anchor.x) - container.left,
    y: finite(anchor.y) - container.top,
  };
}

export function edgeForPoint(
  point: ConnectionPoint,
  rect: ConnectionRect,
): ConnectionEdge {
  const normalized = normalizedRect(rect);
  const distances: Array<[ConnectionEdge, number]> = [
    ["left", Math.abs(point.x - normalized.left)],
    ["right", Math.abs(normalized.left + normalized.width - point.x)],
    ["top", Math.abs(point.y - normalized.top)],
    ["bottom", Math.abs(normalized.top + normalized.height - point.y)],
  ];
  distances.sort((a, b) => a[1] - b[1]);
  return distances[0]![0];
}

function metadataLabel(
  metadata: true | ConnectionOffscreenMetadata | undefined,
) {
  return metadata === true ? undefined : metadata?.label;
}

function projectEndpoint(
  anchor: ConnectionAnchor,
  toward: ConnectionPoint,
  viewport: ConnectionRect,
  forcedOffscreen: true | ConnectionOffscreenMetadata | undefined,
  edgePadding: number,
): ProjectedEndpoint {
  const center = anchorCenter(anchor);
  const visible = isConnectionRect(anchor)
    ? rectIntersects(normalizedRect(anchor), viewport)
    : pointInside(center, viewport);
  const offscreen = Boolean(forcedOffscreen) || !visible;
  if (offscreen) {
    const innerViewport = {
      left: viewport.left + edgePadding,
      top: viewport.top + edgePadding,
      width: Math.max(0, viewport.width - edgePadding * 2),
      height: Math.max(0, viewport.height - edgePadding * 2),
    };
    const point = intersectRectEdge(
      innerViewport,
      rectCenter(innerViewport),
      center,
    );
    return {
      point,
      offscreen: true,
      edge: edgeForPoint(point, innerViewport),
      edgeLabel: metadataLabel(forcedOffscreen),
    };
  }
  const point = isConnectionRect(anchor)
    ? intersectRectEdge(anchor, center, toward)
    : center;
  return {
    point: clampPointToRect(point, viewport, edgePadding),
    offscreen: false,
  };
}

function targetKey(item: ConnectionOverlayItem) {
  if (item.convergeKey) return item.convergeKey;
  const center = anchorCenter(item.to);
  return `${round(center.x)}:${round(center.y)}`;
}

/**
 * Converts screen-space anchors into the overlay's local coordinate system.
 * No application state is read or retained by this function.
 */
export function projectConnections(
  containerInput: ConnectionRect,
  items: readonly ConnectionOverlayItem[],
  options: Readonly<{ edgePadding?: number }> = {},
): ProjectedConnection[] {
  const container = normalizedRect(containerInput);
  if (container.width <= EPSILON || container.height <= EPSILON) return [];
  const viewport = {
    left: 0,
    top: 0,
    width: container.width,
    height: container.height,
  };
  const edgePadding = Math.max(
    0,
    Math.min(24, finite(options.edgePadding ?? 8)),
  );
  const offsets = new Map<number, number>();
  const bundleKeys = new Map<number, string>();
  const bundles = new Map<string, number[]>();
  items.forEach((item, index) => {
    if (item.kind !== "ai-preview" && item.kind !== "ai-frozen") return;
    const key = targetKey(item);
    bundleKeys.set(index, key);
    const members = bundles.get(key) ?? [];
    members.push(index);
    bundles.set(key, members);
  });
  for (const members of bundles.values()) {
    convergenceOffsets(members.length).forEach((offset, index) => {
      offsets.set(members[index]!, offset);
    });
  }
  const bundleTargets = new Map<string, ProjectedEndpoint>();
  for (const [key, members] of bundles) {
    const targetItem = items[members[0]!]!;
    const target = localAnchor(targetItem.to, container);
    const sourceCenters = members.map((index) =>
      anchorCenter(localAnchor(items[index]!.from, container)),
    );
    const toward = {
      x:
        sourceCenters.reduce((sum, point) => sum + point.x, 0) /
        sourceCenters.length,
      y:
        sourceCenters.reduce((sum, point) => sum + point.y, 0) /
        sourceCenters.length,
    };
    bundleTargets.set(
      key,
      projectEndpoint(
        target,
        toward,
        viewport,
        targetItem.offscreen?.to,
        edgePadding,
      ),
    );
  }

  return items.map((item, index) => {
    const fromAnchor = localAnchor(item.from, container);
    const toAnchor = localAnchor(item.to, container);
    const fromCenter = anchorCenter(fromAnchor);
    const toCenter = anchorCenter(toAnchor);
    const from = projectEndpoint(
      fromAnchor,
      toCenter,
      viewport,
      item.offscreen?.from,
      edgePadding,
    );
    const bundleKey = bundleKeys.get(index);
    const to = bundleKey
      ? bundleTargets.get(bundleKey)!
      : projectEndpoint(
          toAnchor,
          fromCenter,
          viewport,
          item.offscreen?.to,
          edgePadding,
        );
    const convergenceOffset = offsets.get(index) ?? 0;
    return {
      id: item.id,
      kind: item.kind,
      label: item.label,
      selected: Boolean(item.selected),
      from,
      to,
      curve: createBezierCurve(from.point, to.point, convergenceOffset),
      convergenceOffset,
    };
  });
}
