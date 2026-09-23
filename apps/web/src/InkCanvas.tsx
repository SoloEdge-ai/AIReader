import { forwardRef, useEffect, useImperativeHandle, useRef } from "react";
import type { BrushStyle } from "../../../packages/protocol/src/reader-tools";
import type { InkPoint, ProjectedInk } from "./InkGeometry";

export interface InkCanvasHandle {
  preview(points: InkPoint[], brush: BrushStyle | undefined, erased: ReadonlySet<string>): void;
  clear(): void;
}

/** A viewport-sized drawing surface; a 516-page document never creates a 516-page canvas. */
export const InkCanvas = forwardRef<InkCanvasHandle, {
  strokes: ProjectedInk[];
  viewport: HTMLDivElement;
  zoom: number;
}>(function InkCanvas({ strokes, viewport, zoom }, ref) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const live = useRef<{ points: InkPoint[]; brush?: BrushStyle; erased: ReadonlySet<string> }>({
    points: [], erased: new Set(),
  });
  const frame = useRef(0);
  const latest = useRef({ strokes, viewport, zoom });
  latest.current = { strokes, viewport, zoom };

  function draw() {
    frame.current = 0;
    const element = canvas.current;
    if (!element) return;
    const { strokes, viewport, zoom } = latest.current;
    const bounds = element.getBoundingClientRect();
    const ratio = window.devicePixelRatio || 1;
    const width = Math.max(1, Math.ceil(bounds.width * ratio));
    const height = Math.max(1, Math.ceil(bounds.height * ratio));
    if (element.width !== width || element.height !== height) {
      element.width = width;
      element.height = height;
    }
    const context = element.getContext("2d")!;
    context.setTransform(ratio, 0, 0, ratio, 0, 0);
    context.clearRect(0, 0, bounds.width, bounds.height);
    const world = viewport.querySelector(".pdf-world")?.getBoundingClientRect();
    if (!world) return;
    const offsetX = world.left - bounds.left, offsetY = world.top - bounds.top;
    const visible = [(-offsetX) / zoom, (-offsetY) / zoom,
      (bounds.width - offsetX) / zoom, (bounds.height - offsetY) / zoom];
    const paint = (points: InkPoint[], color: string, opacity: number, lineWidth: number) => {
      if (!points.length) return;
      context.strokeStyle = color;
      context.fillStyle = color;
      context.globalAlpha = opacity;
      context.lineWidth = Math.max(.5, lineWidth * zoom);
      context.lineCap = context.lineJoin = "round";
      context.beginPath();
      context.moveTo(offsetX + points[0][0] * zoom, offsetY + points[0][1] * zoom);
      for (let i = 1; i < points.length; i++)
        context.lineTo(offsetX + points[i][0] * zoom, offsetY + points[i][1] * zoom);
      if (points.length === 1) {
        context.arc(offsetX + points[0][0] * zoom, offsetY + points[0][1] * zoom,
          Math.max(.5, lineWidth * zoom / 2), 0, Math.PI * 2);
        context.fill();
      } else context.stroke();
    };
    for (const stroke of strokes)
      for (const path of stroke.paths) {
        const [left, top, right, bottom] = path.bounds;
        if (right + stroke.width < visible[0] || bottom + stroke.width < visible[1] ||
            left - stroke.width > visible[2] || top - stroke.width > visible[3]) continue;
        paint(path.points, stroke.color, live.current.erased.has(stroke.id) ? .12 : stroke.opacity, stroke.width);
      }
    if (live.current.brush)
      paint(live.current.points, live.current.brush.color, live.current.brush.opacity, live.current.brush.width);
    context.globalAlpha = 1;
  }
  function schedule() { if (!frame.current) frame.current = requestAnimationFrame(draw); }
  useImperativeHandle(ref, () => ({
    preview(points, brush, erased) {
      live.current = { points, brush, erased };
      schedule();
    },
    clear() {
      live.current = { points: [], erased: new Set() };
      schedule();
    },
  }));
  useEffect(() => {
    const observer = new ResizeObserver(schedule);
    observer.observe(viewport);
    viewport.addEventListener("scroll", schedule, { passive: true });
    schedule();
    return () => {
      observer.disconnect();
      viewport.removeEventListener("scroll", schedule);
      cancelAnimationFrame(frame.current);
      frame.current = 0;
    };
  }, [viewport]);
  useEffect(schedule, [strokes, zoom]);
  return <canvas ref={canvas} className="workspace-ink-canvas" aria-hidden="true" />;
});
