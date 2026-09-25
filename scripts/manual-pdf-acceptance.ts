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
  await new Promise<void>((done) => core.server.listen(0, "127.0.0.1", done));
  const address = core.server.address();
  if (!address || typeof address === "string") throw new Error("Core address unavailable");
  browser = await chromium.launch({ channel: "msedge", headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor });
  await page.goto(`http://127.0.0.1:${address.port}`);
  const start = performance.now();
  await page.locator('input[type=file][accept="application/pdf"]').setInputFiles({
    name: "Private 516-page acceptance.pdf", mimeType: "application/pdf", buffer: bytes,
  });
  await page.locator('[data-book-status="ready"]').waitFor({ timeout: 180000 });
  const importReadyMs = Math.round(performance.now() - start);
  const book = core.library.books()[0];
  if (!book || book.status !== "ready") throw new Error(`Book did not finish importing: ${book?.status ?? "missing"}`);
  if (!Number.isInteger(requestedPage) || requestedPage < 1 || requestedPage > book.pages)
    throw new Error(`Page must be between 1 and ${book.pages}`);
  const startedInitialRender = performance.now();
  await page.locator('.pdf-page[data-render-ready="true"]').first().waitFor({ timeout: 30000 });
  const initialRenderMs = Math.round(performance.now() - startedInitialRender);
  const startedPageRender = performance.now();
  const pageInput = page.getByRole("textbox", { name: "页码" });
  await pageInput.fill(String(requestedPage));
  await pageInput.press("Enter");
  const targetPage = page.locator(`#page-${requestedPage}[data-render-ready="true"]`);
  await targetPage.waitFor({ timeout: 30000 });
  const pageRenderMs = Math.round(performance.now() - startedPageRender);
  const canvasSize = await targetPage.locator("canvas").evaluate((element) => {
    const canvas = element as HTMLCanvasElement;
    return { width: canvas.width, height: canvas.height };
  });
  if (!canvasSize.width || !canvasSize.height) throw new Error("Target PDF canvas is empty");
  await mkdir(resolve(".local/screenshots"), { recursive: true });
  await page.screenshot({ path: resolve(`.local/screenshots/manual-pdf-page-${requestedPage}-scale-${deviceScaleFactor}.png`) });
  console.log(JSON.stringify({ pages: book.pages, importReadyMs, initialRenderMs, pageRenderMs,
    requestedPage, deviceScaleFactor, canvasSize,
    coreRssMiB: Math.round(process.memoryUsage().rss / 2 ** 20) }));
} finally {
  await browser?.close();
  core.close();
  const target = resolve(directory);
  if (!target.startsWith(tempRoot + sep) || !basename(target).startsWith("aireader-private-pdf-"))
    throw new Error("Refusing to remove an unexpected temporary directory");
  await rm(target, { recursive: true, force: true });
}
