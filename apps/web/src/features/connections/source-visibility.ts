import type { ConnectionRect } from "./geometry";

function intersection(a: ConnectionRect, b: ConnectionRect): ConnectionRect | undefined {
  const left = Math.max(a.left, b.left), top = Math.max(a.top, b.top);
  const right = Math.min(a.left + a.width, b.left + b.width);
  const bottom = Math.min(a.top + a.height, b.top + b.height);
  return right > left && bottom > top ? { left, top, width: right - left, height: bottom - top } : undefined;
}

/** Page margins must not make a nearby excerpt look distant. The endpoint remains on the source. */
export function nearbySourceRect(card: ConnectionRect, source: ConnectionRect,
  document: ConnectionRect, viewport: ConnectionRect, maxDistance = 480): ConnectionRect | undefined {
  const page = intersection(document, viewport);
  if (!page || !intersection(card, viewport)) return;
  const visibleSource = intersection(source, page);
  if (!visibleSource) return;
  const dx = Math.max(0, page.left - card.left - card.width, card.left - page.left - page.width);
  const dy = Math.max(0, visibleSource.top - card.top - card.height,
    card.top - visibleSource.top - visibleSource.height);
  return Math.hypot(dx, dy) <= maxDistance ? visibleSource : undefined;
}
