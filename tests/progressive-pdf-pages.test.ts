import { describe, expect, it } from "vitest";
import { loadPagesProgressively } from "../apps/web/src/features/pdf/progressive-pages";

describe("progressive PDF pages", () => {
  it("shows the first pages before a long document finishes loading", async () => {
    let releaseLater!: () => void;
    const later = new Promise<void>((resolve) => { releaseLater = resolve; });
    const snapshots: number[][] = [];
    const task = loadPagesProgressively(516, async (page) => {
      if (page > 16) await later;
      return page;
    }, (pages) => snapshots.push(pages), () => true);

    await new Promise<void>((resolve) => setTimeout(resolve, 0));
    expect(snapshots).toEqual([Array.from({ length: 16 }, (_, index) => index + 1)]);
    releaseLater();
    await task;
    expect(snapshots.at(-1)).toHaveLength(516);
    expect(snapshots.at(-1)?.[515]).toBe(516);
  });

  it("does not publish pages after the reader is closed", async () => {
    let active = true;
    let release!: () => void;
    const pending = new Promise<void>((resolve) => { release = resolve; });
    const snapshots: number[][] = [];
    const task = loadPagesProgressively(20, async (page) => {
      if (page > 16) await pending;
      return page;
    }, (pages) => snapshots.push(pages), () => active);
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
    active = false;
    release();
    await task;
    expect(snapshots).toHaveLength(1);
    expect(snapshots[0]).toHaveLength(16);
  });
});
