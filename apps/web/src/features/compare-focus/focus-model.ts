import type { PdfAnchor } from "../../../../../packages/protocol/src/anchors";

export type PdfRect = [number, number, number, number];

/** Native PDF CropBox coordinates. Rotation is applied only when the page is rendered. */
export type PdfPageBox = { page: number; rect: PdfRect };

export type FocusRegion = {
  kind: "region";
  id: string;
  page: number;
  /** Full page width, cropped vertically in native PDF coordinates. */
  pdfRect: PdfRect;
  sourceKeys: string[];
  fullPage: boolean;
};

export type FocusOmission = {
  kind: "omission";
  id: string;
  fromPage: number;
  toPage: number;
  omittedPages: number;
  /** True when the omitted content lies between two regions of one page. */
  samePage: boolean;
};

export type FocusEntry = FocusRegion | FocusOmission;

export type FocusPlan = {
  entries: FocusEntry[];
  regions: FocusRegion[];
  totalRegions: number;
  hasMore: boolean;
};

export type FocusOptions = {
  /** Added to the default 72 PDF points for individual source rectangles. */
  extraContext?: ReadonlyMap<string, number>;
  fullPages?: ReadonlySet<number>;
  visibleLimit?: number;
};

export const DEFAULT_FOCUS_CONTEXT = 72;
export const FOCUS_BATCH_SIZE = 20;

const ordered = (rect: PdfRect): PdfRect => [
  Math.min(rect[0], rect[2]), Math.min(rect[1], rect[3]),
  Math.max(rect[0], rect[2]), Math.max(rect[1], rect[3]),
];

export function focusSourceKey(anchorIndex: number, rectIndex: number) {
  return `${anchorIndex}:${rectIndex}`;
}

type Candidate = { page: number; lower: number; upper: number; sourceKeys: string[]; fullPage: boolean };

/**
 * Build clipped, ordered windows of the original PDF page. This never extracts or
 * reflows text; callers render each region by cropping the corresponding PDF page.
 */
export function buildFocusPlan(
  anchors: readonly PdfAnchor[], pageBoxes: readonly PdfPageBox[], options: FocusOptions = {},
): FocusPlan {
  const boxes = new Map(pageBoxes.map((box) => [box.page, ordered(box.rect)]));
  const candidates: Candidate[] = [];
  anchors.forEach((anchor, anchorIndex) => {
    const box = boxes.get(anchor.page);
    if (!box) return;
    anchor.rects.forEach((rawRect, rectIndex) => {
      const rect = ordered(rawRect);
      if (rect[2] < box[0] || rect[0] > box[2] || rect[3] < box[1] || rect[1] > box[3]) return;
      const key = focusSourceKey(anchorIndex, rectIndex);
      const fullPage = options.fullPages?.has(anchor.page) ?? false;
      const extra = Math.max(0, options.extraContext?.get(key) ?? 0);
      candidates.push({
        page: anchor.page,
        lower: fullPage ? box[1] : Math.max(box[1], rect[1] - DEFAULT_FOCUS_CONTEXT - extra),
        upper: fullPage ? box[3] : Math.min(box[3], rect[3] + DEFAULT_FOCUS_CONTEXT + extra),
        sourceKeys: [key], fullPage,
      });
    });
  });

  candidates.sort((a, b) => a.page - b.page || a.lower - b.lower || a.upper - b.upper);
  const merged: Candidate[] = [];
  for (const candidate of candidates) {
    const previous = merged.at(-1);
    if (previous?.page === candidate.page && candidate.lower <= previous.upper) {
      previous.upper = Math.max(previous.upper, candidate.upper);
      previous.sourceKeys.push(...candidate.sourceKeys);
      previous.fullPage ||= candidate.fullPage;
    } else merged.push({ ...candidate, sourceKeys: [...candidate.sourceKeys] });
  }
  const regions: FocusRegion[] = merged.map((candidate): FocusRegion => {
    const box = boxes.get(candidate.page)!;
    return {
      kind: "region", page: candidate.page,
      id: `page-${candidate.page}-${candidate.sourceKeys.join("-")}`,
      pdfRect: [box[0], candidate.lower, box[2], candidate.upper],
      sourceKeys: candidate.sourceKeys,
      fullPage: candidate.fullPage || candidate.lower === box[1] && candidate.upper === box[3],
    };
  }).sort((a, b) => a.page - b.page || b.pdfRect[3] - a.pdfRect[3]);

  const visibleLimit = Math.max(0, Math.floor(options.visibleLimit ?? FOCUS_BATCH_SIZE));
  const visible = regions.slice(0, visibleLimit);
  const entries: FocusEntry[] = [];
  visible.forEach((region, index) => {
    const previous = visible[index - 1];
    if (previous) {
      const samePage = previous.page === region.page;
      const gap = samePage ? previous.pdfRect[1] - region.pdfRect[3] : 1;
      if (gap > 0) entries.push({
        kind: "omission", id: `gap-${previous.id}-${region.id}`,
        fromPage: previous.page, toPage: region.page,
        omittedPages: Math.max(0, region.page - previous.page - 1), samePage,
      });
    }
    entries.push(region);
  });
  return { entries, regions: visible, totalRegions: regions.length, hasMore: visible.length < regions.length };
}
