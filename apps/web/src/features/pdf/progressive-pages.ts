/** Publish each contiguous batch so the first PDF page can render while later pages load. */
export async function loadPagesProgressively<T>(
  count: number,
  getPage: (page: number) => Promise<T>,
  publish: (pages: T[]) => void,
  active: () => boolean,
  batchSize = 16,
): Promise<void> {
  const pages: T[] = [];
  for (let first = 1; first <= count; first += batchSize) {
    const batch = await Promise.all(Array.from(
      { length: Math.min(batchSize, count - first + 1) },
      (_, index) => getPage(first + index),
    ));
    if (!active()) return;
    pages.push(...batch);
    publish([...pages]);
  }
}
