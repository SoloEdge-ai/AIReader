type CardBounds = { x: number; y: number; width: number; height: number };

/** Find an empty vertical slot without changing positions the reader placed explicitly. */
export function findOpenCardPlacement<T extends CardBounds>(candidate: T, cards: CardBounds[]): T {
  const placed = { ...candidate };
  const gap = 16;
  for (let attempt = 0; attempt <= cards.length; attempt += 1) {
    const blocker = cards.find((card) =>
      placed.x < card.x + card.width + gap && placed.x + placed.width + gap > card.x &&
      placed.y < card.y + card.height + gap && placed.y + placed.height + gap > card.y);
    if (!blocker) return placed;
    placed.y = Math.max(placed.y + 1, blocker.y + blocker.height + gap);
  }
  return placed;
}
