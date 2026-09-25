import { chromium } from "@playwright/test";
import { readFile, mkdtemp, rm, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join, resolve, sep } from "node:path";
import { performance } from "node:perf_hooks";
import { createCore } from "../apps/core/src/server";

const input = process.argv[2];
if (!input) throw new Error("Provide a local PDF path");
const requestedPage = Number(process.argv[3] ?? 14);
const deviceScaleFactor = Number(process.argv[4] ?? 1);
if (![1, 1.5, 2].includes(deviceScaleFactor)) throw new Error("Scale must be 1, 1.5, or 2");
const tempRoot = resolve(tmpdir());
const directory = await mkdtemp(join(tempRoot, "aireader-private-pdf-"));
const core = createCore(directory, resolve("dist/web"));
let browser: Awaited<ReturnType<typeof chromium.launch>> | undefined;
try {
  const bytes = await readFile(input);
  const start = performance.now();
  const book = await core.library.import(bytes, "Private 516-page acceptance.pdf");
  let timeout: ReturnType<typeof setTimeout> | undefined;
  const ready = await Promise.race([
    core.library.waitForBook(book.id),
    new Promise<never>((_, reject) => { timeout = setTimeout(() => reject(new Error("Parse exceeded 180 s")), 180000); }),
  ]).finally(() => clearTimeout(timeout));
  const parsedMs = Math.round(performance.now() - start);
  if (ready.status !== "ready") throw new Error(`Book status ${ready.status}: ${ready.error}`);
  if (!Number.isInteger(requestedPage) || requestedPage < 1 || requestedPage > ready.pages)
    throw new Error(`Page must be between 1 and ${ready.pages}`);
  await new Promise<void>((done) => core.server.listen(0, "127.0.0.1", done));
  const address = core.server.address();
  if (!address || typeof address === "string") throw new Error("Core address unavailable");
  browser = await chromium.launch({ channel: "msedge", headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor });
  const startedUI = performance.now();
  await page.goto(`http://127.0.0.1:${address.port}`);
  await page.getByText("Private 516-page acceptance", { exact: true }).click();
  await page.locator(".pdf-page").first().waitFor();
  const openMs = Math.round(performance.now() - startedUI);
  const pageInput = page.getByRole("textbox", { name: "页码" });
  await pageInput.fill(String(requestedPage));
  await pageInput.press("Enter");
  await page.locator(`#page-${requestedPage} canvas`).waitFor({ timeout: 30000 });
  await mkdir(resolve(".local/screenshots"), { recursive: true });
  await page.screenshot({ path: resolve(`.local/screenshots/manual-pdf-page-${requestedPage}-scale-${deviceScaleFactor}.png`) });
  console.log(JSON.stringify({ pages: ready.pages, parsedMs, openMs, requestedPage, deviceScaleFactor,
    pageCanvas: await page.locator(`#page-${requestedPage} canvas`).count(),
    coreRssMiB: Math.round(process.memoryUsage().rss / 2 ** 20) }));
} finally {
  await browser?.close();
  core.close();
  const target = resolve(directory);
  if (!target.startsWith(tempRoot + sep) || !basename(target).startsWith("aireader-private-pdf-"))
    throw new Error("Refusing to remove an unexpected temporary directory");
  await rm(target, { recursive: true, force: true });
}
