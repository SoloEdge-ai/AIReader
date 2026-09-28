import type { PdfRect } from "./focus-model";

type ViewportProjector = { convertToViewportRectangle: (rect: number[]) => number[] };
export type ScreenRect = { left: number; top: number; width: number; height: number };

/** PDF.js applies page rotation and CropBox when projecting a native source window. */
export function projectNativeRegion(pdfRect: PdfRect, viewport: ViewportProjector): ScreenRect {
  const [x1, y1, x2, y2] = viewport.convertToViewportRectangle(pdfRect);
  return { left: Math.min(x1, x2), top: Math.min(y1, y2),
    width: Math.abs(x2 - x1), height: Math.abs(y2 - y1) };
}
