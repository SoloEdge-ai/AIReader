/** Contact geometry has no UI or persistence dependencies. Distances are desk units. */
export type ContactRect = { id: string; x: number; y: number; width: number; height: number };
export type CardContact = { targetId: string; axis: "x" | "y"; gap: number };
export function cardContact(a: ContactRect, b: ContactRect, distance = 20): CardContact | undefined {
  if (a.id === b.id) return;
  const overlapX = Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x);
  const overlapY = Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y);
  const gapX = Math.max(a.x, b.x) - Math.min(a.x + a.width, b.x + b.width);
  const gapY = Math.max(a.y, b.y) - Math.min(a.y + a.height, b.y + b.height);
  if (overlapY >= 32 && gapX >= -8 && gapX <= distance) return { targetId: b.id, axis: "x", gap: gapX };
  if (overlapX >= 32 && gapY >= -8 && gapY <= distance) return { targetId: b.id, axis: "y", gap: gapY };
}
export function nearestContact(card: ContactRect, cards: ContactRect[], distance = 20) {
  return cards.flatMap((other) => { const contact = cardContact(card, other, distance); return contact ? [contact] : []; })
    .sort((a, b) => Math.abs(a.gap) - Math.abs(b.gap) || a.targetId.localeCompare(b.targetId))[0];
}
/** A filled, concave paper bridge, never a semantic relationship. */
export function paperBridge(a: ContactRect, b: ContactRect): string | undefined {
  const contact = cardContact(a, b, 44);
  if (!contact || contact.gap <= 0) return;
  const vertical = contact.axis === "y";
  const project = (r: ContactRect) => vertical ? { x: r.y, y: r.x, width: r.height, height: r.width } : r;
  let left = project(a), right = project(b);
  if (left.x > right.x) [left, right] = [right, left];
  const x1 = left.x + left.width, x2 = right.x, mid = (x1 + x2) / 2;
  const y1 = Math.max(left.y, right.y) + 12, y2 = Math.min(left.y + left.height, right.y + right.height) - 12;
  const pinch = Math.min(36, (y2 - y1) * .35);
  const p = (x: number, y: number) => vertical ? `${y},${x}` : `${x},${y}`;
  return `M ${p(x1, y1)} C ${p(mid, y1 + pinch)} ${p(mid, y1 + pinch)} ${p(x2, y1)} L ${p(x2, y2)} C ${p(mid, y2 - pinch)} ${p(mid, y2 - pinch)} ${p(x1, y2)} Z`;
}
