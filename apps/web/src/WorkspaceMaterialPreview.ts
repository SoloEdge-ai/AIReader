import type { Annotation, QuestionMaterialInput } from "../../../packages/protocol/src";
import type { BookWorkspace, WorkspaceObject } from "../../../packages/protocol/src/workspace";
import type { WorkspacePage } from "../../../packages/workspace-engine/src/surfaces";
import type { InkPoint } from "../../../packages/workspace-engine/src/ink";
import { objectRect, shapeEndpoints } from "../../../packages/workspace-engine/src/objects";

type Surface = { kind: "board" } | { kind: "pdf"; page: number };
type Rectangle = { x: number; y: number; width: number; height: number };
type DrawItem = { id: string; rect: Rectangle; draw: (context: CanvasRenderingContext2D) => void };
type Group = { surface: Surface; page?: WorkspacePage; ids: Set<string>; items: DrawItem[]; bounds?: Rectangle };
const sameKey = (surface: Surface) => `${surface.kind}:${surface.kind === "pdf" ? surface.page : ""}`;
const bound = (points: InkPoint[]): Rectangle => ({
  x: Math.min(...points.map((point) => point[0])), y: Math.min(...points.map((point) => point[1])),
  width: Math.max(...points.map((point) => point[0])) - Math.min(...points.map((point) => point[0])),
  height: Math.max(...points.map((point) => point[1])) - Math.min(...points.map((point) => point[1])),
});
const merge = (a: Rectangle | undefined, b: Rectangle): Rectangle => a ? {
  x: Math.min(a.x, b.x), y: Math.min(a.y, b.y),
  width: Math.max(a.x + a.width, b.x + b.width) - Math.min(a.x, b.x),
  height: Math.max(a.y + a.height, b.y + b.height) - Math.min(a.y, b.y),
} : b;
const padded = (rect: Rectangle, limit?: Rectangle): Rectangle => {
  const margin = 24;
  const x = Math.max(limit?.x ?? 0, rect.x - margin);
  const y = Math.max(limit?.y ?? 0, rect.y - margin);
  const right = Math.min(limit ? limit.x + limit.width : Infinity, rect.x + rect.width + margin);
  const bottom = Math.min(limit ? limit.y + limit.height : Infinity, rect.y + rect.height + margin);
  return { x, y, width: Math.max(1, right - x), height: Math.max(1, bottom - y) };
};
const colors: Record<Annotation["color"], string> = {
  yellow: "#e8bb3f", green: "#7cb982", blue: "#6da7d8", pink: "#dc89ae",
};

/** Only selected personal objects are composited over raw PDF pixels. */
export function captureMaterialPreviews(ids: string[], workspace: BookWorkspace,
  annotations: Annotation[], pages: WorkspacePage[]): QuestionMaterialInput["previews"] {
  const selected = new Set(ids);
  const groups = new Map<string, Group>();
  function add(surface: Surface, id: string, item: DrawItem) {
    const key = sameKey(surface);
    let group = groups.get(key);
    if (!group) {
      const page = surface.kind === "pdf" ? pages.find((value) => value.page === surface.page) : undefined;
      if (surface.kind === "pdf" && !page) throw new Error("所选页面尚未加载，请稍后重试");
      group = { surface, page, ids: new Set(), items: [] };
      groups.set(key, group);
    }
    group.ids.add(id);
    group.items.push(item);
    group.bounds = merge(group.bounds, item.rect);
  }
  for (const object of workspace.objects.filter((item) => selected.has(item.id))) {
    if (object.kind === "ink") {
      for (const segment of object.segments) {
        const surface = segment.surface;
        const page = surface.kind === "pdf" ? pages.find((value) => value.page === surface.page) : undefined;
        if (surface.kind === "pdf" && !page) throw new Error("笔迹页面尚未加载，请稍后重试");
        const points = surface.kind === "pdf" ? segment.points.map((point) => page!.toWorld(point)) : segment.points;
        const rect = bound(points);
        add(surface, object.id, { id: object.id, rect,
          draw(context) {
            context.save(); context.globalAlpha = object.opacity; context.strokeStyle = object.color;
            context.lineWidth = object.width; context.lineCap = "round"; context.lineJoin = "round";
            context.beginPath();
            points.forEach((point, index) => index ? context.lineTo(point[0], point[1]) :
              context.moveTo(point[0], point[1]));
            context.stroke(); context.restore();
          } });
      }
    } else if (object.kind === "shape") {
      const rect = objectRect(object, pages);
      if (!rect) throw new Error("形状页面尚未加载，请稍后重试");
      add(object.surface, object.id, { id: object.id, rect,
        draw(context) { drawShape(context, object, rect, pages); } });
    }
  }
  for (const annotation of annotations.filter((item) => selected.has(item.id) && !item.assetId))
    for (const anchor of annotation.anchors) {
      const page = pages.find((value) => value.page === anchor.page);
      if (!page) throw new Error("批注页面尚未加载，请稍后重试");
      for (const rect of anchor.rects) {
        const world = bound([[rect[0], rect[1]], [rect[2], rect[1]],
          [rect[0], rect[3]], [rect[2], rect[3]]].map((point) => page.toWorld(point as InkPoint)));
        add({ kind: "pdf", page: anchor.page }, annotation.id, { id: annotation.id, rect: world,
          draw(context) {
            context.save();
            const color = colors[annotation.color];
            if (annotation.kind === "underline" || annotation.kind === "strike") {
              const y = annotation.kind === "underline" ? rect[1] : (rect[1] + rect[3]) / 2;
              const start = page.toWorld([rect[0], y]), end = page.toWorld([rect[2], y]);
              context.strokeStyle = color; context.lineWidth = 2;
              context.beginPath(); context.moveTo(start[0], start[1]);
              context.lineTo(end[0], end[1]); context.stroke();
            } else {
              context.fillStyle = color; context.globalAlpha = annotation.kind === "sticky" ? 1 : .3;
              context.fillRect(world.x, world.y, world.width, world.height);
              if (annotation.kind === "sticky") {
                context.globalAlpha = 1; context.fillStyle = "#333";
                context.font = "15px sans-serif"; context.fillText("▤", world.x + 1, world.y + 15);
              }
            }
            context.restore();
          } });
      }
    }
  if (groups.size > 4) throw new Error("所选视觉材料跨越超过 4 个区域，请分次加入提问");
  return [...groups.values()].map((group) => {
    const limits = group.page ? { x: group.page.x, y: group.page.y,
      width: group.page.width, height: group.page.height } : undefined;
    const rect = padded(group.bounds!, limits);
    if (rect.width > 2048 || rect.height > 2048)
      throw new Error("视觉材料范围太大，请缩小选择以保持图片清晰");
    const scale = Math.min(2, 1024 / rect.width, 1024 / rect.height);
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(rect.width * scale));
    canvas.height = Math.max(1, Math.round(rect.height * scale));
    const context = canvas.getContext("2d");
    if (!context) throw new Error("无法生成材料预览");
    context.fillStyle = "#ffffff"; context.fillRect(0, 0, canvas.width, canvas.height);
    context.setTransform(scale, 0, 0, scale, -rect.x * scale, -rect.y * scale);
    if (group.page) {
      const source = document.querySelector<HTMLCanvasElement>(`#page-${group.page.page} > canvas`);
      const host = source?.parentElement;
      if (!source?.width || !source.height || host?.getAttribute("data-render-ready") !== "true")
        throw new Error("PDF 页面仍在渲染，请稍后重试");
      const sx = (rect.x - group.page.x) / group.page.width * source.width;
      const sy = (rect.y - group.page.y) / group.page.height * source.height;
      const sw = rect.width / group.page.width * source.width;
      const sh = rect.height / group.page.height * source.height;
      context.drawImage(source, sx, sy, sw, sh, rect.x, rect.y, rect.width, rect.height);
    }
    for (const item of group.items) item.draw(context);
    const image = canvas.toDataURL("image/png");
    if (image.length > 10 * 1024 * 1024) throw new Error("材料预览超过图片大小限制，请缩小选择");
    return { objectIds: [...group.ids], surface: group.surface.kind,
      ...(group.surface.kind === "pdf" ? { page: group.surface.page } : {}),
      includesPdfBackground: Boolean(group.page), image };
  });
}

function drawShape(context: CanvasRenderingContext2D,
  object: Extract<WorkspaceObject, { kind: "shape" }>, rect: Rectangle, pages: WorkspacePage[]) {
  context.save(); context.strokeStyle = object.color; context.lineWidth = object.strokeWidth;
  context.lineCap = "round"; context.lineJoin = "round";
  if (object.fill) { context.fillStyle = object.fill; context.globalAlpha = object.fillOpacity ?? .2; }
  if (object.shape === "rectangle") {
    if (object.fill) context.fillRect(rect.x, rect.y, rect.width, rect.height);
    context.globalAlpha = 1; context.strokeRect(rect.x, rect.y, rect.width, rect.height);
  } else if (object.shape === "ellipse") {
    context.beginPath(); context.ellipse(rect.x + rect.width / 2, rect.y + rect.height / 2,
      Math.max(.5, rect.width / 2), Math.max(.5, rect.height / 2), 0, 0, Math.PI * 2);
    if (object.fill) context.fill();
    context.globalAlpha = 1; context.stroke();
  } else {
    const [a, b] = shapeEndpoints(object, pages);
    if (a && b) {
      context.beginPath(); context.moveTo(a[0], a[1]); context.lineTo(b[0], b[1]); context.stroke();
      if (object.shape === "arrow") {
        const angle = Math.atan2(b[1] - a[1], b[0] - a[0]);
        const size = Math.max(8, object.strokeWidth * 4);
        context.beginPath(); context.moveTo(b[0], b[1]);
        context.lineTo(b[0] - size * Math.cos(angle - .55), b[1] - size * Math.sin(angle - .55));
        context.moveTo(b[0], b[1]);
        context.lineTo(b[0] - size * Math.cos(angle + .55), b[1] - size * Math.sin(angle + .55));
        context.stroke();
      }
    }
  }
  context.restore();
}
