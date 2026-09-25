import { chromium, expect } from "@playwright/test";
import { createHash } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { cpus, platform, release, tmpdir, totalmem } from "node:os";
import { join, resolve, sep } from "node:path";
import { performance } from "node:perf_hooks";
import { PDFDocument } from "pdf-lib";
import { createCore } from "../apps/core/src/server";
import { Workspaces } from "../apps/core/src/workspace";
import type { BookWorkspace } from "../packages/protocol/src/workspace";
import { commandPayload } from "../packages/protocol/src/workspace-commands";

// Manual generated-data benchmark: no user PDF or local database leaves the machine.
const directory = await mkdtemp(join(tmpdir(), "aireader-workspace-perf-"));
const core = createCore(directory, resolve("dist/web"));
let browser: Awaited<ReturnType<typeof chromium.launch>> | undefined;
try {
  const pdf = await PDFDocument.create();
  for (let index = 0; index < 516; index++) {
    const page = pdf.addPage([540, 720]);
    if (index === 0) page.drawText("Generated performance sample", { x: 40, y: 670 });
  }
  const importedAt = performance.now();
  const book = await core.library.import(Buffer.from(await pdf.save()), "Generated 516-page sample.pdf");
  let parseTimeout: ReturnType<typeof setTimeout> | undefined;
  const parsed = await Promise.race([
    core.library.waitForBook(book.id),
    new Promise<never>((_, reject) => { parseTimeout = setTimeout(() =>
      reject(new Error("PDF parse exceeded 120 seconds")), 120_000); }),
  ]).finally(() => clearTimeout(parseTimeout));
  if (parsed.status !== "ready") throw new Error(`PDF parse ended as ${parsed.status}: ${parsed.error}`);
  const parseMs = Math.round(performance.now() - importedAt);
  const rssStages = [{ stage: "parsed", mib: Math.round(process.memoryUsage().rss / 2 ** 20) }];
  const cards: BookWorkspace["cards"] = Array.from({ length: 500 }, (_, index) => ({
    id: `card-${index}`, kind: "note", title: `Card ${index}`, text: "Generated note", comment: "",
    x: index % 2 ? 2250 : 800, y: 80 + Math.floor(index / 2) * 70, width: 250, height: 170,
  }));
  const objects: BookWorkspace["objects"] = Array.from({ length: 5000 }, (_, index) => ({
    id: `ink-${index}`, kind: "ink", brush: "pen", color: "#345d84", width: 2, opacity: 1,
    segments: [{ surface: { kind: "board" }, points: Array.from({ length: 50 }, (_, point) =>
      [800 + (index % 50) * 20 + point, 100 + Math.floor(index / 50) * 80 + point] as [number, number]) }],
  }));
  const links: BookWorkspace["links"] = Array.from({ length: 1000 }, (_, index) => ({
    id: `link-${index}`, from: `card-${index % 500}`, to: `card-${(index + 1) % 500}`,
    label: "Generated relation",
  }));
  const repository = core.library.store.workspaces;
  const seedAt = performance.now();
  repository.save({ bookId: book.id, revision: 0, formatVersion: 4, layoutVersion: 2,
    cards, objects, links });
  const seedMs = Math.round(performance.now() - seedAt);
  rssStages.push({ stage: "seeded", mib: Math.round(process.memoryUsage().rss / 2 ** 20) });
  const workspaces = new Workspaces(core.library);
  const readAt = performance.now();
  const workspace = workspaces.get(book.id);
  const readMs = Math.round(performance.now() - readAt);
  rssStages.push({ stage: "read", mib: Math.round(process.memoryUsage().rss / 2 ** 20) });
  expect(workspace.objects).toHaveLength(5000);
  const input = { bookId: book.id, commandId: "perf-one-ink", expectedContentVersion: 0,
    changes: [{ type: "upsert-object" as const, object: { ...objects[0], color: "#3b6b90" } }] };
  const commandAt = performance.now();
  const receipt = workspaces.commandV2(book.id, { ...input,
    payloadHash: createHash("sha256").update(commandPayload(input)).digest("hex") });
  const commandMs = Math.round(performance.now() - commandAt);
  rssStages.push({ stage: "first command", mib: Math.round(process.memoryUsage().rss / 2 ** 20) });
  expect(receipt.contentVersion).toBe(1);
  const repeatedCommands: number[] = [];
  for (let index = 1; index <= 10; index++) {
    const next = { bookId: book.id, commandId: `perf-repeat-${index}`, expectedContentVersion: index,
      changes: [{ type: "upsert-object" as const, object: { ...objects[0],
        color: index % 2 ? "#345d84" : "#3b6b90" } }] };
    const start = performance.now();
    workspaces.commandV2(book.id, { ...next,
      payloadHash: createHash("sha256").update(commandPayload(next)).digest("hex") });
    repeatedCommands.push(Math.round(performance.now() - start));
    rssStages.push({ stage: `command ${index + 1}`, mib: Math.round(process.memoryUsage().rss / 2 ** 20) });
  }
  await new Promise<void>((done) => core.server.listen(0, "127.0.0.1", done));
  const address = core.server.address();
  if (!address || typeof address === "string") throw new Error("Core port missing");
  browser = await chromium.launch({ channel: "msedge", headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  await page.addInitScript(() => {
    const record = window as typeof window & { __longTasks: number[]; __frames: number[] };
    record.__longTasks = []; record.__frames = [];
    new PerformanceObserver((list) => record.__longTasks.push(...list.getEntries().map((entry) => entry.duration)))
      .observe({ entryTypes: ["longtask"] });
  });
  const uiAt = performance.now();
  await page.goto(`http://127.0.0.1:${address.port}`);
  await page.locator(".book-card").first().click();
  await expect(page.locator(".workspace-card")).toHaveCount(500, { timeout: 60_000 });
  const uiOpenMs = Math.round(performance.now() - uiAt);
  const openLongTasks = await page.evaluate(() => {
    const record = window as typeof window & { __longTasks: number[] };
    const values = [...record.__longTasks]; record.__longTasks = [];
    return values;
  });
  await page.evaluate(`(() => {
    window.__frames = [];
    let previous = performance.now();
    function frame(now) {
      window.__frames.push(now - previous); previous = now;
      if (window.__frames.length < 180) requestAnimationFrame(frame);
    }
    requestAnimationFrame(frame);
  })()`);
  await page.locator(".pdf-scroll").hover();
  await page.mouse.wheel(0, 1500);
  await page.waitForTimeout(3200);
  const browserStats = await page.evaluate(() => {
    const record = window as typeof window & { __longTasks: number[]; __frames: number[] };
    const memory = window.performance as Performance & { memory?: { usedJSHeapSize: number } };
    return { longTasks: record.__longTasks, frames: record.__frames,
      heapBytes: memory.memory?.usedJSHeapSize };
  });
  const percentile = (values: number[], p: number) => {
    if (!values.length) return null;
    const sorted = [...values].sort((a, b) => a - b);
    return Math.round(sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * p))] * 10) / 10;
  };
  const beforeGc = process.memoryUsage();
  global.gc?.();
  const afterGc = process.memoryUsage();
  console.log(JSON.stringify({
    host: { platform: platform(), release: release(), cpu: cpus()[0]?.model,
      ramGiB: Math.round(totalmem() / 2 ** 30) },
    sample: { pages: 516, cards: 500, links: 1000, objects: 5000, inkPoints: 250000 },
    timingsMs: { parse: parseMs, seed: seedMs, read: readMs, oneCommand: commandMs,
      repeatedCommandP50: percentile(repeatedCommands, .5), repeatedCommandP95: percentile(repeatedCommands, .95),
      uiOpen: uiOpenMs,
      frameP95: percentile(browserStats.frames, .95), frameP99: percentile(browserStats.frames, .99),
      longestTaskOnOpen: percentile(openLongTasks, 1),
      longestTaskOnScroll: percentile(browserStats.longTasks, 1) },
    memoryMiB: { coreRssBeforeGc: Math.round(beforeGc.rss / 2 ** 20),
      coreRssAfterGc: Math.round(afterGc.rss / 2 ** 20),
      coreHeapUsedAfterGc: Math.round(afterGc.heapUsed / 2 ** 20),
      coreHeapReservedAfterGc: Math.round(afterGc.heapTotal / 2 ** 20),
      coreExternalAfterGc: Math.round(afterGc.external / 2 ** 20),
      coreArrayBuffersAfterGc: Math.round(afterGc.arrayBuffers / 2 ** 20),
      browserHeap: browserStats.heapBytes && Math.round(browserStats.heapBytes / 2 ** 20) },
    longTaskCount: { onOpen: openLongTasks.length, onScroll: browserStats.longTasks.length },
    rssStages,
  }, null, 2));
} finally {
  await browser?.close();
  core.close();
  if (directory.startsWith(tmpdir() + sep)) await rm(directory, { recursive: true, force: true });
}
