import type { ConnectionPoint, ConnectionRect } from "./geometry";

/** Source hints are local and transient; semantic and AI links use their own policies. */
export function sourceConnectorVisible(card: ConnectionRect, source: ConnectionPoint,
  viewport: ConnectionRect, maxDistance = 480): boolean {
  const right = viewport.left + viewport.width, bottom = viewport.top + viewport.height;
  if (source.x < viewport.left || source.x > right || source.y < viewport.top || source.y > bottom ||
      card.left >= right || card.top >= bottom || card.left + card.width <= viewport.left ||
      card.top + card.height <= viewport.top) return false;
  const x = Math.max(card.left, Math.min(card.left + card.width, source.x));
  const y = Math.max(card.top, Math.min(card.top + card.height, source.y));
  return Math.hypot(source.x - x, source.y - y) <= maxDistance;
}
