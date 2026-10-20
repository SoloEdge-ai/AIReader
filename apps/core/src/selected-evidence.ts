import { readFile } from "node:fs/promises";
import { PDFDocument } from "pdf-lib";
import type { PdfAnchor, Passage, SourceAnchor } from "../../../packages/protocol/src";

/** Convert immutable PDF anchors into the normalized citation coordinates used by retrieval. */
export async function selectedCitations(file: string, passages: Passage[], selections: {
  text: string; anchors?: PdfAnchor[]; id: string;
}[]): Promise<Map<string, SourceAnchor>> {
  const result = new Map<string, SourceAnchor>();
  if (!selections.length) return result;
  const pdf = await PDFDocument.load(await readFile(file), { updateMetadata: false });
  const normalize = (text: string) => text.replace(/\s+/g, " ").trim();
  for (const selection of selections) {
    if (!normalize(selection.text) || selection.anchors?.length !== 1) continue;
    const anchor = selection.anchors[0];
    const page = pdf.getPage(anchor.page - 1);
    const crop = page.getCropBox(), media = page.getMediaBox();
    const x = Math.max(crop.x, media.x), y = Math.max(crop.y, media.y);
    const width = Math.min(crop.x + crop.width, media.x + media.width) - x;
    const height = Math.min(crop.y + crop.height, media.y + media.height) - y;
    const rotation = ((page.getRotation().angle % 360) + 360) % 360;
    const viewWidth = rotation % 180 ? height : width, viewHeight = rotation % 180 ? width : height;
    const point = (px: number, py: number) => {
      const dx = px - x, dy = py - y;
      return rotation === 90 ? [dy, dx] : rotation === 180 ? [width - dx, dy] :
        rotation === 270 ? [height - dy, width - dx] : [dx, height - dy];
    };
    const rects = anchor.rects.map(([x1, y1, x2, y2]) => {
      const corners = [point(x1, y1), point(x2, y2)];
      const left = Math.min(...corners.map((p) => p[0])) / viewWidth;
      const top = Math.min(...corners.map((p) => p[1])) / viewHeight;
      return [left, top, Math.abs(corners[1][0] - corners[0][0]) / viewWidth,
        Math.abs(corners[1][1] - corners[0][1]) / viewHeight];
    });
    const passage = passages.find((p) => p.page === anchor.page && normalize(p.text).includes(normalize(selection.text)) &&
      p.anchor.rects.some((r) => rects.some((s) => r[0] < s[0] + s[2] && r[0] + r[2] > s[0] &&
        r[1] < s[1] + s[3] && r[1] + r[3] > s[1])));
    if (passage && rects.every((r) => r.every(Number.isFinite) && r[0] >= 0 && r[1] >= 0 &&
      r[2] > 0 && r[3] > 0 && r[0] + r[2] <= 1 && r[1] + r[3] <= 1))
      result.set(selection.id, { ...structuredClone(passage.anchor), passageId: selection.id, rects });
  }
  return result;
}
