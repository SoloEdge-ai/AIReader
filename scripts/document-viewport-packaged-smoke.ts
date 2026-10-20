import { _electron as electron, expect } from "@playwright/test";
import { mkdtemp, mkdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { PDFDocument } from "pdf-lib";
import { Library } from "../apps/core/src/library";
import { Preferences } from "../apps/core/src/preferences";

const executable = resolve(process.argv[2] ?? "release/win-unpacked/AIReader.exe");
const directory = await mkdtemp(join(tmpdir(), "aireader-document-viewport-"));
const library = new Library(directory);
let libraryOpen = true, desktop: Awaited<ReturnType<typeof electron.launch>> | undefined;
try {
  const pdf = await PDFDocument.create();
  for (let index = 1; index <= 3; index++) pdf.addPage([500, 700]).drawText(`Document viewport fixture page ${index}`, { x: 40, y: 620 });
  const book = await library.import(Buffer.from(await pdf.save()), "Document viewport fixture.pdf");
  await library.waitForBook(book.id);
  new Preferences(library).saveForBook(book.id, { deskLayout: "spatial", chromeCollapsed: true, panel: "none", navigation: false,
    documentRect: { x: 170, y: 24, width: 1400, height: 1800 } });
  library.close(); libraryOpen = false;
  const env: Record<string, string> = {};
  for (const [key, value] of Object.entries(process.env)) if (key !== "ELECTRON_RUN_AS_NODE" && value !== undefined) env[key] = value;
  env.AIREADER_DATA = directory; env.AIREADER_CI = "1";
  const launch = async () => {
    desktop = await electron.launch({ executablePath: executable, args: [], env });
    const page = await desktop.firstWindow();
    await page.setViewportSize({ width: 3440, height: 1343 });
    await page.locator(".book-card").filter({ hasText: "Document viewport fixture" }).click();
    await expect(page.locator(".pdf-pane .pdf-page").first()).toBeVisible();
    return page;
  };
  let page = await launch();
  let pdfPane = page.getByRole("region", { name: "原文", exact: true });
  let widthControl = pdfPane.getByRole("separator", { name: "调整文档宽度", exact: true });
  await expect(widthControl).toBeInViewport({ ratio: 1 });
  await expect(pdfPane.getByRole("separator", { name: "调整文档大小", exact: true })).toBeInViewport({ ratio: 1 });
  await widthControl.focus(); await page.keyboard.press("ArrowLeft");
  const preferences = () => page.evaluate(async (id) => (await fetch(`/api/books/${id}/preferences`)).json(), book.id);
  await expect.poll(async () => (await preferences()).documentRect.width).toBe(1380);
  expect((await preferences()).documentRect.height).toBe(1800);
  const grip = (await widthControl.boundingBox())!;
  await page.mouse.move(grip.x + 6, grip.y + grip.height / 2); await page.mouse.down();
  await page.mouse.move(grip.x - 154, grip.y + grip.height / 2 + 60, { steps: 8 }); await page.mouse.up();
  await expect.poll(async () => (await preferences()).documentRect.width).toBe(1220);
  expect((await preferences()).documentRect.height).toBe(1800);
  await mkdir(".local/screenshots", { recursive: true });
  await page.screenshot({ path: ".local/screenshots/document-viewport-packaged-wide.png" });
  await page.setViewportSize({ width: 1000, height: 640 });
  await expect(widthControl).toBeInViewport({ ratio: 1 });
  await expect(pdfPane.getByRole("separator", { name: "调整文档大小", exact: true })).toBeInViewport({ ratio: 1 });
  expect((await preferences()).documentRect.width).toBe(1220);
  await page.screenshot({ path: ".local/screenshots/document-viewport-packaged-narrow.png" });
  await desktop!.close(); desktop = undefined;
  page = await launch(); pdfPane = page.getByRole("region", { name: "原文", exact: true });
  widthControl = pdfPane.getByRole("separator", { name: "调整文档宽度", exact: true });
  await expect.poll(async () => (await pdfPane.boundingBox())!.width).toBe(1220);
  await expect(widthControl).toBeInViewport({ ratio: 1 });
  await expect(pdfPane.getByRole("separator", { name: "调整文档大小", exact: true })).toBeInViewport({ ratio: 1 });
  expect((await preferences()).documentRect.height).toBe(1800);
  await desktop!.close(); desktop = undefined;
  console.log("Packaged document viewport: visible bottom, side/keyboard width resize, untouched height, viewport shrink and restart passed.");
} finally {
  await desktop?.close(); if (libraryOpen) library.close();
  await rm(directory, { recursive: true, force: true });
}
