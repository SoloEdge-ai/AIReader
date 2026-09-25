import type { InkStroke, SurfaceAnchor } from "../../protocol/src/workspace";

export type InkPoint = [number, number];
export interface InkPage {
  page: number;
  x: number;
  y: number;
  width: number;
  height: number;
  toPdf(point: InkPoint): InkPoint;
  toWorld(point: InkPoint): InkPoint;
}
export type ProjectedInk = {
  id: string;
  color: string;
  width: number;
  opacity: number;
  brush: InkStroke["brush"];
  paths: { points: InkPoint[]; bounds: [number, number, number, number] }[];
};

const sameSurface = (a: SurfaceAnchor, b: SurfaceAnchor) =>
  a.kind === b.kind && (a.kind === "board" ||
    (b.kind === "pdf" && a.page === b.page && a.fingerprint === b.fingerprint));
const lerp = (a: InkPoint, b: InkPoint, t: number): InkPoint =>
  [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
const distanceToSegmentSquared = (point: InkPoint, a: InkPoint, b: InkPoint) => {
  const dx = b[0] - a[0], dy = b[1] - a[1];
  const t = dx * dx + dy * dy ? Math.max(0, Math.min(1,
    ((point[0] - a[0]) * dx + (point[1] - a[1]) * dy) / (dx * dx + dy * dy))) : 0;
  return (point[0] - a[0] - t * dx) ** 2 + (point[1] - a[1] - t * dy) ** 2;
};

/** Preserve crossings even when one sampled line jumps entirely over a page. */
export function splitStroke(points: InkPoint[], pages: InkPage[], fingerprint: string) {
  const segments: InkStroke["segments"] = [];
  if (!points.length) return segments;
  const samples = points.length === 1 ? [points[0], points[0]] : points;
  for (let index = 1; index < samples.length; index++) {
    const a = samples[index - 1], b = samples[index];
    const candidates = pages.filter((page) =>
      page.y <= Math.max(a[1], b[1]) && page.y + page.height >= Math.min(a[1], b[1]) &&
      page.x <= Math.max(a[0], b[0]) && page.x + page.width >= Math.min(a[0], b[0]));
    const crossings = [0, 1];
    for (const page of candidates) {
      for (const boundary of [page.x, page.x + page.width]) {
        const t = (boundary - a[0]) / (b[0] - a[0]);
        if (t > 0 && t < 1 && Number.isFinite(t)) crossings.push(t);
      }
      for (const boundary of [page.y, page.y + page.height]) {
        const t = (boundary - a[1]) / (b[1] - a[1]);
        if (t > 0 && t < 1 && Number.isFinite(t)) crossings.push(t);
      }
    }
    crossings.sort((left, right) => left - right);
    for (let part = 1; part < crossings.length; part++) {
      const first = crossings[part - 1], last = crossings[part];
      if (last - first < 1e-9) continue;
      const middle = lerp(a, b, (first + last) / 2);
      const page = candidates.find((item) => middle[0] >= item.x && middle[0] <= item.x + item.width &&
        middle[1] >= item.y && middle[1] <= item.y + item.height);
      const surface: SurfaceAnchor = page
        ? { kind: "pdf", fingerprint, page: page.page } : { kind: "board" };
      const start = page ? page.toPdf(lerp(a, b, first)) : lerp(a, b, first);
      const end = page ? page.toPdf(lerp(a, b, last)) : lerp(a, b, last);
      const current = segments.at(-1);
      if (current && sameSurface(current.surface, surface)) {
        const tail = current.points.at(-1)!;
        if (Math.hypot(tail[0] - start[0], tail[1] - start[1]) > 1e-6)
          current.points.push(start);
        current.points.push(end);
      } else segments.push({ surface, points: [start, end] });
    }
  }
  return segments;
}

/** Fixed world/PDF-unit tolerance: simplification does not vary with zoom. */
export function simplifyInk(points: InkPoint[], tolerance = 0.35): InkPoint[] {
  if (points.length <= 2) return points;
  const keep = new Uint8Array(points.length);
  keep[0] = keep[points.length - 1] = 1;
  const stack: [number, number][] = [[0, points.length - 1]];
  const threshold = tolerance * tolerance;
  while (stack.length) {
    const [first, last] = stack.pop()!;
    let furthest = -1, distance = threshold;
    for (let i = first + 1; i < last; i++) {
      const measured = distanceToSegmentSquared(points[i], points[first], points[last]);
      if (measured > distance) { distance = measured; furthest = i; }
    }
    if (furthest >= 0) {
      keep[furthest] = 1;
      stack.push([first, furthest], [furthest, last]);
    }
  }
  return points.filter((_, index) => keep[index]);
}

export function projectStroke(stroke: InkStroke, pages: InkPage[]): ProjectedInk {
  const paths = stroke.segments.flatMap((segment) => {
    const surface = segment.surface;
    const page = surface.kind === "pdf"
      ? pages.find((item) => item.page === surface.page) : undefined;
    if (surface.kind === "pdf" && !page) return [];
    const points = surface.kind === "pdf" ? segment.points.map((point) => page!.toWorld(point))
      : segment.points;
    return [{ points, bounds: [
      Math.min(...points.map((point) => point[0])), Math.min(...points.map((point) => point[1])),
      Math.max(...points.map((point) => point[0])), Math.max(...points.map((point) => point[1])),
    ] as [number, number, number, number] }];
  });
  return { id: stroke.id, color: stroke.color, width: stroke.width,
    opacity: stroke.opacity, brush: stroke.brush, paths };
}

export function hitStroke(stroke: ProjectedInk, point: InkPoint, radius: number) {
  const reach = radius + stroke.width / 2;
  for (const path of stroke.paths) {
    const [left, top, right, bottom] = path.bounds;
    if (point[0] < left - reach || point[0] > right + reach ||
        point[1] < top - reach || point[1] > bottom + reach) continue;
    for (let i = 1; i < path.points.length; i++)
      if (distanceToSegmentSquared(point, path.points[i - 1], path.points[i]) <= reach * reach)
        return true;
  }
  return false;
}
