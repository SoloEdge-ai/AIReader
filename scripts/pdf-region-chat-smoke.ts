import { chromium, expect, type Page } from "@playwright/test";
import { PDFDocument, PDFName, PDFHexString, rgb } from "pdf-lib";
import { PNG } from "pngjs";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { createCore } from "../apps/core/src/server";
import type { Book, ChatImageInput } from "../packages/protocol/src";

async function dragCentralRegion(page: Page) {
  await expect(page.locator("#page-1")).toHaveAttribute(
    "data-render-ready",
    "true",
  );
  await expect(page.locator(".pdf-scroll")).toHaveAttribute("data-workspace-ready", "true", { timeout: 15_000 });
  const box = (await page.locator("#page-1").boundingBox())!;
  await page.mouse.move(box.x + box.width / 4, box.y + box.height / 4);
  await page.mouse.down();
  await page.mouse.move(
    box.x + (box.width * 3) / 4,
    box.y + (box.height * 3) / 4,
    { steps: 8 },
  );
  await page.mouse.up();
  await expect(page.locator(".composer .image-attachment")).toHaveCount(1);
}

async function expectImageQuadrants(page: Page, colors: number[][]) {
  const image = page.locator(".composer .image-thumbnail img");
  await expect
    .poll(() => image.evaluate((node: HTMLImageElement) => node.naturalWidth))
    .toBeGreaterThan(0);
  const dataUrl = await image.evaluate((node: HTMLImageElement) => {
    const canvas = document.createElement("canvas");
    canvas.width = node.naturalWidth;
    canvas.height = node.naturalHeight;
    canvas.getContext("2d")!.drawImage(node, 0, 0);
    return canvas.toDataURL("image/png");
  });
  const png = PNG.sync.read(Buffer.from(dataUrl.split(",")[1], "base64"));
  expect(png.width).toBeGreaterThan(100);
  expect(Math.abs(png.width - png.height)).toBeLessThanOrEqual(2);
  const coordinates = [
    [0.25, 0.25],
    [0.75, 0.25],
    [0.25, 0.75],
    [0.75, 0.75],
  ];
  for (const [index, [x, y]] of coordinates.entries()) {
    const offset =
      (Math.floor(y * png.height) * png.width + Math.floor(x * png.width)) * 4;
    expect([...png.data.subarray(offset, offset + 4)]).toEqual([
      ...colors[index],
      255,
    ]);
  }
  return png;
}

// Real PDF rendering, pointer input, Core HTTP and model transport. Only Codex is replaced.
const dpi = Number(process.argv[2] ?? 1);
if (![1, 1.5, 2].includes(dpi)) throw new Error("DPI must be 1, 1.5 or 2");
await mkdir(".local/screenshots", { recursive: true });
const data = await mkdtemp(resolve(".local/pdf-region-chat-"));
const pdf = await PDFDocument.create();
const pdfPage = pdf.addPage([400, 400]);
pdf.catalog.set(
  PDFName.of("PageLabels"),
  pdf.context.obj({
    Nums: [0, { S: PDFName.of("D"), P: PDFHexString.fromText("fig-"), St: 1 }],
  }),
);
// The central PDF rectangle [100,100,300,300] contains all four known quadrants.
pdfPage.drawRectangle({
  x: 0,
  y: 200,
  width: 200,
  height: 200,
  color: rgb(1, 0, 0),
});
pdfPage.drawRectangle({
  x: 200,
  y: 200,
  width: 200,
  height: 200,
  color: rgb(0, 1, 0),
});
pdfPage.drawRectangle({
  x: 0,
  y: 0,
  width: 200,
  height: 200,
  color: rgb(0, 0, 1),
});
pdfPage.drawRectangle({
  x: 200,
  y: 0,
  width: 200,
  height: 200,
  color: rgb(1, 1, 0),
});
const file = resolve(data, "region-quadrants.pdf");
await writeFile(file, await pdf.save());
const otherPdf = await PDFDocument.create();
otherPdf
  .addPage([400, 400])
  .drawText("A separate book has a separate question draft.", {
    x: 15,
    y: 300,
    size: 12,
  });
const otherFile = resolve(data, "separate-region-book.pdf");
await writeFile(otherFile, await otherPdf.save());
const core = createCore(data, resolve("dist/web"), {
  path: process.execPath,
  version: "fixture",
  args: [resolve("tests/fixtures/fake-codex.mjs")],
});
await new Promise<void>((done) => core.server.listen(0, "127.0.0.1", done));
const address = core.server.address();
if (!address || typeof address === "string") throw new Error("Missing port");
const base = `http://127.0.0.1:${address.port}`;
const browser = await chromium.launch({ channel: "msedge", headless: true });
let page: Page | undefined;
try {
  const context = await browser.newContext({
    viewport: { width: 1440, height: 960 },
    deviceScaleFactor: dpi,
  });
  page = await context.newPage();
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto(base);
  await page
    .locator('input[type=file][accept="application/pdf"]')
    .setInputFiles(file);
  await page.locator('[data-book-status="ready"]').waitFor();
  const [book]: Book[] = await (
    await context.request.get(base + "/api/books")
  ).json();
  await page.getByRole("button", { name: "问答", exact: true }).first().click();
  await context.request.post(base + "/api/ai/connect", {
    headers: { Origin: base },
  });
  await expect(
    page.getByRole("button", { name: "模型与思考强度" }),
  ).toContainText("Fixture A", { timeout: 15000 });
  await page.getByRole("button", { name: "框选书中图表", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "取消框选", exact: true }),
  ).toBeVisible();
  await dragCentralRegion(page);
  const png = await expectImageQuadrants(page, [
    [255, 0, 0],
    [0, 255, 0],
    [0, 0, 255],
    [255, 255, 0],
  ]);
  await expect(page.locator(".composer .image-attachment")).toContainText(
    "本书第 fig-1 页",
  );
  await page.locator(".composer .image-thumbnail").click();
  await expect(page.getByRole("dialog", { name: "图片预览" })).toContainText(
    "本书第 fig-1 页区域（物理页 1）",
  );
  await expect(page.getByRole("dialog", { name: "图片预览" })).toContainText(
    "PDF 坐标 100, 100, 300, 300",
  );
  await page.keyboard.press("Escape");
  await expect(page.locator(".turn")).toHaveCount(0);
  await page
    .getByRole("textbox", { name: "问题", exact: true })
    .fill("CHECK_IMAGE region");
  const [sent] = await Promise.all([
    page.waitForRequest(
      (request) =>
        request.method() === "POST" &&
        /\/books\/[^/]+\/turns$/.test(new URL(request.url()).pathname),
    ),
    page.getByRole("button", { name: "发送问题", exact: true }).click(),
  ]);
  const payload: { images: ChatImageInput[] } = sent.postDataJSON();
  expect(payload.images).toHaveLength(1);
  expect(payload.images[0].source).toMatchObject({
    kind: "pdf-region",
    bookId: book.id,
    fingerprint: book.fingerprint,
    page: 1,
  });
  for (const [index, coordinate] of [100, 100, 300, 300].entries())
    expect(payload.images[0].source!.rect[index]).toBeCloseTo(coordinate, 0);
  await expect(page.locator(".turn .answer")).toContainText(
    `Images received: 1; ${png.width}x${png.height}:255,0,0,255`,
  );
  const capture = page.getByRole("button", {
    name: "框选书中图表",
    exact: true,
  });
  await capture.click();
  await page.getByRole("button", { name: "取消框选", exact: true }).click();
  await expect(page.locator(".annotation-capture")).toHaveCount(0);
  await expect(page.locator(".floating-chat")).toBeVisible();
  await capture.click();
  await page.getByRole("button", { name: "指针（V）", exact: true }).click();
  await expect(page.locator(".annotation-capture")).toHaveCount(0);
  await expect(page.locator(".floating-chat")).toBeVisible();
  await expect(page.locator(".composer .image-attachment")).toHaveCount(0);
  await capture.click();
  const cancelBox = (await page.locator("#page-1").boundingBox())!;
  await page.mouse.move(cancelBox.x + 100, cancelBox.y + 100);
  await page.mouse.down();
  await page.mouse.move(cancelBox.x + 160, cancelBox.y + 160);
  await page.keyboard.press("Escape");
  await page.mouse.up();
  await expect(page.locator(".annotation-capture")).toHaveCount(0);
  await expect(page.locator(".composer .image-attachment")).toHaveCount(0);
  await page.getByRole("button", { name: "旋转页面", exact: true }).click();
  await capture.click();
  await dragCentralRegion(page);
  const clockwiseColors = [
    [0, 0, 255],
    [255, 0, 0],
    [255, 255, 0],
    [0, 255, 0],
  ];
  await expectImageQuadrants(page, clockwiseColors);
  await page.locator(".composer .image-thumbnail").click();
  await expect(page.getByRole("dialog", { name: "图片预览" })).toContainText(
    "PDF 坐标 100, 100, 300, 300",
  );
  await page.keyboard.press("Escape");
  await page.locator(".composer .image-remove").click();
  await page.getByRole("button", { name: "放大", exact: true }).click();
  await capture.click();
  await dragCentralRegion(page);
  await expectImageQuadrants(page, clockwiseColors);
  await page.locator(".composer .image-thumbnail").click();
  await expect(page.getByRole("dialog", { name: "图片预览" })).toContainText(
    "PDF 坐标 100, 100, 300, 300",
  );
  await page.keyboard.press("Escape");
  await page.screenshot({
    path: `.local/screenshots/pdf-region-rotated-${dpi}.png`,
  });
  // A session change cancels the unfinished capture, not the already attached draft.
  await capture.click();
  await expect(page.locator(".floating-chat")).toHaveCount(0);
  await page.getByRole("button", { name: "问答", exact: true }).first().click();
  await page.getByRole("button", { name: "新建会话", exact: true }).click();
  await expect(page.locator(".annotation-capture")).toHaveCount(0);
  await expect(page.locator(".composer .image-attachment")).toHaveCount(0);
  await page.getByRole("button", { name: "历史会话", exact: true }).click();
  await page
    .getByRole("button", { name: "CHECK_IMAGE region", exact: true })
    .click();
  await expect(page.locator(".composer .image-attachment")).toHaveCount(1);
  await expectImageQuadrants(page, clockwiseColors);
  // A book change cannot receive or send the previous book's unfinished selection.
  await capture.click();
  await page.getByRole("button", { name: "返回书库", exact: true }).click();
  await expect(page.locator(".library")).toBeVisible();
  await page
    .locator('input[type=file][accept="application/pdf"]')
    .setInputFiles(otherFile);
  await page.locator('[data-book-status="ready"]').waitFor();
  await page.getByRole("button", { name: "问答", exact: true }).first().click();
  await expect(page.locator(".annotation-capture")).toHaveCount(0);
  await expect(page.locator(".composer .image-attachment")).toHaveCount(0);
  await expect(page.locator(".turn")).toHaveCount(0);
  await page.getByRole("button", { name: "返回书库", exact: true }).click();
  await page
    .locator(".book-card")
    .filter({ hasText: "region-quadrants" })
    .click();
  await expect(page.locator(".composer .image-attachment")).toHaveCount(1);
  const rotatedPng = await expectImageQuadrants(page, clockwiseColors);
  await page
    .getByRole("textbox", { name: "问题", exact: true })
    .fill("CHECK_IMAGE rotated");
  const [rotatedSent] = await Promise.all([
    page.waitForRequest(
      (request) =>
        request.method() === "POST" &&
        /\/books\/[^/]+\/turns$/.test(new URL(request.url()).pathname),
    ),
    page.getByRole("button", { name: "发送问题", exact: true }).click(),
  ]);
  const rotatedPayload: { images: ChatImageInput[] } =
    rotatedSent.postDataJSON();
  expect(rotatedPayload.images[0].source).toMatchObject({
    kind: "pdf-region",
    bookId: book.id,
    fingerprint: book.fingerprint,
    page: 1,
  });
  for (const [index, coordinate] of [100, 100, 300, 300].entries())
    expect(rotatedPayload.images[0].source!.rect[index]).toBeCloseTo(
      coordinate,
      0,
    );
  await expect(page.locator(".turn").last().locator(".answer")).toContainText(
    `Images received: 1; ${rotatedPng.width}x${rotatedPng.height}:0,0,255,255`,
  );
  await page.reload();
  await page
    .locator(".book-card")
    .filter({ hasText: "region-quadrants" })
    .click();
  await expect(page.locator(".turn .image-attachment")).toHaveCount(2);
  await page.locator(".turn .image-thumbnail").last().click();
  await expect(page.getByRole("dialog", { name: "图片预览" })).toContainText(
    "PDF 坐标 100, 100, 300, 300",
  );
  await page.keyboard.press("Escape");
  await page.setViewportSize({ width: 860, height: 760 });
  await capture.click();
  await expect(page.locator(".floating-chat")).toHaveCount(0);
  await dragCentralRegion(page);
  await expectImageQuadrants(page, clockwiseColors);
  await expect(
    page.getByRole("button", { name: "发送问题", exact: true }),
  ).toBeInViewport();
  await page.screenshot({
    path: `.local/screenshots/pdf-region-narrow-${dpi}.png`,
  });
  await page.locator(".composer .image-remove").click();
  expect(
    await (
      await context.request.get(`${base}/api/books/${book.id}/annotations`)
    ).json(),
  ).toEqual([]);
  expect(
    await (
      await context.request.get(`${base}/api/books/${book.id}/notes`)
    ).json(),
  ).toEqual([]);
  expect(errors).toEqual([]);
  console.log(
    `PDF region chat: crop pixels, coordinates, model input, cancellation, rotation, zoom, session/book isolation, history and narrow floating chat passed at ${dpi}x DPI.`,
  );
} catch (error) {
  await page
    ?.screenshot({ path: `.local/screenshots/pdf-region-failure-${dpi}.png` })
    .catch(() => {});
  throw error;
} finally {
  await browser.close();
  core.close();
}
