import type { BookWorkspace } from "../../protocol/src/workspace";
import type { Inquiry } from "../../protocol/src/inquiry";

type Rect = { x: number; y: number; width: number; height: number };
export function answerPlacement<T extends Rect>(placement: T, workspace: BookWorkspace, inquiry?: Inquiry): T {
  const sources = workspace.cards.filter((card) => card.placed !== false && inquiry?.targetIds.includes(card.id));
  const origin = sources.length ? {
    x: Math.min(...sources.map((card) => card.x)), y: Math.min(...sources.map((card) => card.y)),
    right: Math.max(...sources.map((card) => card.x + card.width)),
    bottom: Math.max(...sources.map((card) => card.y + card.height)),
  } : inquiry?.bounds ? { ...inquiry.bounds, right: inquiry.bounds.x + inquiry.bounds.width,
    bottom: inquiry.bounds.y + inquiry.bounds.height } : undefined;
  const cards = workspace.cards.filter((card) => card.placed !== false);
  const free = (candidate: Rect) => candidate.x <= 1000000 && candidate.y <= 1000000 && !cards.some((card) =>
    candidate.x < card.x + card.width + 16 && candidate.x + candidate.width + 16 > card.x &&
    candidate.y < card.y + card.height + 16 && candidate.y + candidate.height + 16 > card.y);
  const candidates = origin ? [{ ...placement, x: origin.right + 32, y: origin.y },
    { ...placement, x: origin.x, y: origin.bottom + 32 }] : [placement];
  for (const candidate of candidates) if (free(candidate)) return candidate;
  const candidate = { ...candidates[candidates.length - 1] };
  for (let i = 0; i <= cards.length; i++) {
    if (free(candidate)) return candidate;
    const bottom = cards.filter((card) => candidate.x < card.x + card.width + 16 &&
      candidate.x + candidate.width + 16 > card.x && candidate.y < card.y + card.height + 16 &&
      candidate.y + candidate.height + 16 > card.y).map((card) => card.y + card.height + 16);
    candidate.y = Math.max(candidate.y + 16, ...bottom);
  }
  throw new Error("附近没有可用的卡片位置，请整理画布后重试或只存为笔记");
}
