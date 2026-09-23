import type { WorkspaceObject, SurfaceAnchor, InkStroke } from "../../../packages/protocol/src/workspace";
import type { WorkspacePage } from "./PdfReader";
import { projectStroke, splitStroke, type InkPoint } from "./InkGeometry";

export type WorldRect = { x: number; y: number; width: number; height: number };
export function pageAt(point: InkPoint, pages: WorkspacePage[]) {
  return pages.find((page) => point[0] >= page.x && point[0] <= page.x + page.width &&
    point[1] >= page.y && point[1] <= page.y + page.height);
}
export function worldToSurface(point: InkPoint, pages: WorkspacePage[], fingerprint: string) {
  const page = pageAt(point, pages);
  return page ? { surface: { kind: "pdf", fingerprint, page: page.page } as SurfaceAnchor,
    point: page.toPdf(point), page } :
    { surface: { kind: "board" } as SurfaceAnchor, point };
}
export function surfaceToWorld(surface: SurfaceAnchor, point: InkPoint, pages: WorkspacePage[]): InkPoint | undefined {
  if (surface.kind === "board") return point;
  return pages.find((page) => page.page === surface.page)?.toWorld(point);
}
export function objectRect(object: Exclude<WorkspaceObject, InkStroke>, pages: WorkspacePage[]): WorldRect | undefined {
  if (object.surface.kind === "board")
    return { x: object.x, y: object.y, width: object.width, height: object.height };
  const pageNumber = object.surface.page;
  const page = pages.find((item) => item.page === pageNumber);
  if (!page) return;
  const corners = [
    [object.x, object.y], [object.x + object.width, object.y],
    [object.x, object.y + object.height], [object.x + object.width, object.y + object.height],
  ].map((point) => page.toWorld(point as InkPoint));
  const xs = corners.map((point) => point[0]), ys = corners.map((point) => point[1]);
  const x = Math.min(...xs), y = Math.min(...ys);
  return { x, y, width: Math.max(...xs) - x, height: Math.max(...ys) - y };
}
export function shapeEndpoints(object: Extract<WorkspaceObject, { kind: "shape" }>, pages: WorkspacePage[]) {
  const start = object.startCorner ?? "top-left";
  const a: InkPoint = [object.x + (start.endsWith("right") ? object.width : 0),
    object.y + (start.startsWith("bottom") ? object.height : 0)];
  const b: InkPoint = [object.x + (start.endsWith("right") ? 0 : object.width),
    object.y + (start.startsWith("bottom") ? 0 : object.height)];
  return [surfaceToWorld(object.surface, a, pages), surfaceToWorld(object.surface, b, pages)] as const;
}
export function newShape(kind: Extract<WorkspaceObject, { kind: "shape" }>["shape"],
  start: InkPoint, end: InkPoint, pages: WorkspacePage[], fingerprint: string): Extract<WorkspaceObject, { kind: "shape" }> {
  const at = worldToSurface(start, pages, fingerprint);
  const bounded: InkPoint = at.page ? [Math.max(at.page.x, Math.min(at.page.x + at.page.width, end[0])),
    Math.max(at.page.y, Math.min(at.page.y + at.page.height, end[1]))] : end;
  const final = at.page ? at.page.toPdf(bounded) : bounded;
  const x = Math.min(at.point[0], final[0]), y = Math.min(at.point[1], final[1]);
  return {
    id: crypto.randomUUID(), kind: "shape", shape: kind, surface: at.surface,
    x, y, width: Math.max(1, Math.abs(at.point[0] - final[0])),
    height: Math.max(1, Math.abs(at.point[1] - final[1])),
    color: "#345d84", strokeWidth: 2,
    startCorner: `${at.point[1] > final[1] ? "bottom" : "top"}-${at.point[0] > final[0] ? "right" : "left"}`,
  };
}
export function translateObject(object: WorkspaceObject, dx: number, dy: number,
  pages: WorkspacePage[], fingerprint: string): WorkspaceObject {
  if (object.kind === "ink") {
    const segments = projectStroke(object, pages).paths.flatMap((path) =>
      splitStroke(path.points.map((point) => [point[0] + dx, point[1] + dy]), pages, fingerprint));
    return segments.length ? { ...object, segments } : object;
  }
  if (object.surface.kind === "board") return { ...object,
    x: Math.max(0, object.x + dx), y: Math.max(0, object.y + dy) };
  const pageNumber = object.surface.page;
  const page = pages.find((item) => item.page === pageNumber);
  if (!page) return object;
  const origin = page.toWorld([object.x, object.y]);
  const shifted = page.toPdf([origin[0] + dx, origin[1] + dy]);
  return { ...object, x: shifted[0], y: shifted[1] };
}
export function resizeObject(object: Exclude<WorkspaceObject, InkStroke>, dx: number, dy: number,
  pages: WorkspacePage[]): WorkspaceObject {
  const rect = objectRect(object, pages);
  if (!rect) return object;
  const minimum = object.kind === "text" ? 20 : 1;
  const maximum = object.kind === "text" ? 2000 : 10000;
  let width = Math.max(minimum, Math.min(maximum, rect.width + dx));
  let height = Math.max(minimum, Math.min(maximum, rect.height + dy));
  if (object.surface.kind === "board") return { ...object, width, height };
  const pageNumber = object.surface.page;
  const page = pages.find((item) => item.page === pageNumber);
  if (!page) return object;
  width = Math.min(width, page.x + page.width - rect.x);
  height = Math.min(height, page.y + page.height - rect.y);
  const corners = [page.toPdf([rect.x, rect.y]), page.toPdf([rect.x + width, rect.y + height])];
  const x = Math.min(corners[0][0], corners[1][0]);
  const y = Math.min(corners[0][1], corners[1][1]);
  return { ...object, x, y,
    width: Math.max(minimum, Math.abs(corners[0][0] - corners[1][0])),
    height: Math.max(minimum, Math.abs(corners[0][1] - corners[1][1])) };
}

const cross = (a: InkPoint, b: InkPoint, c: InkPoint) =>
  (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
const segmentsIntersect = (a: InkPoint, b: InkPoint, c: InkPoint, d: InkPoint) => {
  const ac = cross(a, b, c), ad = cross(a, b, d);
  const ca = cross(c, d, a), cb = cross(c, d, b);
  if (Math.abs(ac) < 1e-9 && Math.abs(ad) < 1e-9 &&
      Math.abs(ca) < 1e-9 && Math.abs(cb) < 1e-9)
    return Math.max(Math.min(a[0], b[0]), Math.min(c[0], d[0])) <=
        Math.min(Math.max(a[0], b[0]), Math.max(c[0], d[0])) &&
      Math.max(Math.min(a[1], b[1]), Math.min(c[1], d[1])) <=
        Math.min(Math.max(a[1], b[1]), Math.max(c[1], d[1]));
  return ac * ad <= 0 && ca * cb <= 0;
};
export function pointInPolygon(point: InkPoint, polygon: InkPoint[]) {
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const a = polygon[i], b = polygon[j];
    if ((a[1] > point[1]) !== (b[1] > point[1]) &&
        point[0] < (b[0] - a[0]) * (point[1] - a[1]) / (b[1] - a[1]) + a[0]) inside = !inside;
  }
  return inside;
}
export function lassoHitsPath(polygon: InkPoint[], path: InkPoint[]) {
  if (polygon.length < 3 || !path.length) return false;
  if (path.some((point) => pointInPolygon(point, polygon))) return true;
  for (let p = 1; p < path.length; p++)
    for (let i = 0; i < polygon.length; i++)
      if (segmentsIntersect(path[p - 1], path[p], polygon[i], polygon[(i + 1) % polygon.length])) return true;
  return false;
}
export function lassoHitsRect(polygon: InkPoint[], rect: WorldRect) {
  const points: InkPoint[] = [[rect.x, rect.y], [rect.x + rect.width, rect.y],
    [rect.x + rect.width, rect.y + rect.height], [rect.x, rect.y + rect.height], [rect.x, rect.y]];
  return lassoHitsPath(polygon, points) || polygon.some((point) =>
    point[0] >= rect.x && point[0] <= rect.x + rect.width &&
    point[1] >= rect.y && point[1] <= rect.y + rect.height);
}
