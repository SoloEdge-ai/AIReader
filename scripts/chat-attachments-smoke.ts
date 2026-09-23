import { chromium, expect } from "@playwright/test";
import { PDFDocument } from "pdf-lib";
import { PNG } from "pngjs";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { createCore } from "../apps/core/src/server";

await mkdir(".local/screenshots", { recursive: true });
const data = await mkdtemp(resolve(".local/attachments-acceptance-"));
const pdf = await PDFDocument.create();
pdf
  .addPage()
  .drawText("Screenshot and resizable chat acceptance", { x: 30, y: 700 });
const file = resolve(data, "fixture.pdf");
await writeFile(file, await pdf.save());
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
try {
  const context = await browser.newContext({
    viewport: { width: 1440, height: 960 },
    permissions: ["clipboard-read", "clipboard-write"],
  });
  const page = await context.newPage();
  await page.goto(base);
  await page
    .locator('input[type=file][accept="application/pdf"]')
    .setInputFiles(file);
  await page.locator('[data-book-status="ready"]').waitFor();
  await page.getByRole("button", { name: "问答", exact: true }).first().click();
  const panel = page.locator(".side-panel");
  const splitter = page.getByRole("separator", { name: "调整侧栏宽度" });
  const initial = (await panel.boundingBox())!;
  const handle = (await splitter.boundingBox())!;
  await page.mouse.move(
    handle.x + handle.width / 2,
    handle.y + handle.height / 2,
  );
  await page.mouse.down();
  await page.mouse.move(handle.x - 380, handle.y + handle.height / 2, {
    steps: 12,
  });
  await page.mouse.up();
  await expect
    .poll(async () => (await panel.boundingBox())!.width)
    .toBeGreaterThan(initial.width + 250);
  await expect
    .poll(async () => (await panel.boundingBox())!.width)
    .toBeGreaterThan(650);
  const wide = (await panel.boundingBox())!.width;
  await splitter.focus();
  await page.keyboard.press("ArrowLeft");
  await expect
    .poll(async () => (await panel.boundingBox())!.width)
    .toBe(wide + 24);
  await page.reload();
  await page.locator(".book-card").first().click();
  await expect
    .poll(async () => (await panel.boundingBox())!.width)
    .toBe(wide + 24);
  await page.setViewportSize({ width: 900, height: 900 });
  await expect(splitter).toBeVisible();
  await splitter.focus();
  await page.keyboard.press("Home");
  await expect.poll(async () => (await panel.boundingBox())!.width).toBe(320);
  const narrowHandle = (await splitter.boundingBox())!;
  await page.mouse.move(narrowHandle.x + 4, narrowHandle.y + 200);
  await page.mouse.down();
  await page.mouse.move(narrowHandle.x - 280, narrowHandle.y + 200, {
    steps: 10,
  });
  await page.mouse.up();
  await expect
    .poll(async () => (await panel.boundingBox())!.width)
    .toBeGreaterThan(560);
  await page.setViewportSize({ width: 1440, height: 960 });
  await context.request.post(base + "/api/ai/connect", {
    headers: { Origin: base },
  });
  await expect(
    page.getByRole("button", { name: "模型与思考强度" }),
  ).toContainText("Fixture A", { timeout: 15000 });
  const input = page.getByRole("textbox", { name: "问题", exact: true });
  // Real OS clipboard paste into the actual renderer, not a simulated paste handler.
  await page.evaluate(async () => {
    const canvas = document.createElement("canvas");
    canvas.width = 120;
    canvas.height = 80;
    const draw = canvas.getContext("2d")!;
    draw.fillStyle = "#ff0000";
    draw.fillRect(0, 0, 120, 80);
    const blob = await new Promise<Blob>((resolve) =>
      canvas.toBlob((value) => resolve(value!), "image/png"),
    );
    await navigator.clipboard.write([new ClipboardItem({ "image/png": blob })]);
  });
  await input.fill("CHECK_IMAGE");
  await input.press("Control+V");
  await expect(page.locator(".composer .image-attachment")).toHaveCount(1);
  await page.locator(".composer .image-thumbnail").click();
  await expect(page.getByRole("dialog", { name: "图片预览" })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog", { name: "图片预览" })).toHaveCount(0);
  await page.getByRole("button", { name: "收起侧栏", exact: true }).click();
  await page.getByRole("button", { name: "问答", exact: true }).first().click();
  await expect(page.locator(".composer .image-attachment")).toHaveCount(1);
  const picker = page.getByLabel("选择图片", { exact: true });
  await picker.setInputFiles({
    name: "broken.png",
    mimeType: "image/png",
    buffer: Buffer.from("not a png"),
  });
  await expect(page.getByRole("alert")).toContainText("图片无法读取");
  await expect(input).toHaveValue("CHECK_IMAGE");
  await expect(page.locator(".composer .image-attachment")).toHaveCount(1);
  await page.locator(".composer .image-remove").click();
  await expect(input).toHaveValue("CHECK_IMAGE");
  await expect(page.locator(".composer .image-attachment")).toHaveCount(0);
  await input.press("Control+V");
  await expect(page.locator(".composer .image-attachment")).toHaveCount(1);
  await page.screenshot({ path: ".local/screenshots/chat-images-draft.png" });
  await page.getByRole("button", { name: "发送问题", exact: true }).click();
  await expect(page.locator(".turn .answer")).toContainText(
    "Images received: 1; 120x80:255,0,0,255",
  );
  await expect(page.locator(".composer .image-attachment")).toHaveCount(0);
  await expect(page.locator(".turn .image-attachment")).toHaveCount(1);
  await expect
    .poll(() =>
      page
        .locator(".turn .image-thumbnail img")
        .evaluate((image: HTMLImageElement) => image.naturalWidth),
    )
    .toBe(120);
  await input.press("Control+V");
  await expect(page.locator(".composer .image-attachment")).toHaveCount(1);
  await page.getByRole("button", { name: "新建会话", exact: true }).click();
  await expect(page.locator(".composer .image-attachment")).toHaveCount(0);
  await page.getByRole("button", { name: "历史会话", exact: true }).click();
  await page.getByRole("button", { name: "CHECK_IMAGE", exact: true }).click();
  await expect(page.locator(".composer .image-attachment")).toHaveCount(1);
  await picker.setInputFiles(
    Array.from({ length: 4 }, () => ({
      name: "excess.png",
      mimeType: "image/png",
      buffer: Buffer.from("x"),
    })),
  );
  await expect(page.getByRole("alert")).toContainText("最多添加 4 张图片");
  await picker.setInputFiles({
    name: "large.png",
    mimeType: "image/png",
    buffer: Buffer.alloc(8 * 1024 * 1024 + 1),
  });
  await expect(page.getByRole("alert")).toContainText("不能超过 8 MB");
  await expect(page.locator(".composer .image-attachment")).toHaveCount(1);
  await page.getByRole("button", { name: "发送问题", exact: true }).click();
  await expect(page.locator(".turn")).toHaveCount(2);
  await expect(page.locator(".turn").last().locator(".question")).toHaveText(
    "请解释这些图片。",
  );
  await expect(
    page
      .locator(".turn")
      .last()
      .getByRole("button", { name: "复制回答", exact: true }),
  ).toBeEnabled();
  await page.reload();
  await page.locator(".book-card").first().click();
  await expect(page.locator(".turn .image-attachment")).toHaveCount(2);
  await page.screenshot({ path: ".local/screenshots/chat-images-history.png" });
  await input.fill("文本仍可粘贴：");
  await page.evaluate(() => navigator.clipboard.writeText("正常文本"));
  await input.press("Control+End");
  await input.press("Control+V");
  await expect(input).toHaveValue("文本仍可粘贴：正常文本");
  const rasterFiles = await page.evaluate(() => {
    const canvas = document.createElement("canvas");
    canvas.width = 160;
    canvas.height = 100;
    const draw = canvas.getContext("2d")!;
    draw.fillStyle = "#607da8";
    draw.fillRect(0, 0, 160, 100);
    return ["png", "jpeg", "webp", "png"].map((format, index) => ({
      name: `diagram-${index}.${format}`,
      mimeType: `image/${format}`,
      base64: canvas.toDataURL(`image/${format}`).split(",")[1],
    }));
  });
  await picker.setInputFiles(
    rasterFiles.map(({ base64, ...file }) => ({
      ...file,
      buffer: Buffer.from(base64, "base64"),
    })),
  );
  await expect(page.locator(".composer .image-attachment")).toHaveCount(4);
  await page.setViewportSize({ width: 900, height: 600 });
  await splitter.focus();
  await page.keyboard.press("Home");
  await page.getByRole("button", { name: "选择文字（T）" }).click();
  await page
    .locator(".textLayer span")
    .first()
    .evaluate((element) => {
      const range = document.createRange();
      range.selectNodeContents(element);
      getSelection()!.removeAllRanges();
      getSelection()!.addRange(range);
      element.dispatchEvent(
        new MouseEvent("mouseup", {
          bubbles: true,
          clientX: 150,
          clientY: 170,
        }),
      );
    });
  await page
    .locator(".selection-bar")
    .getByRole("button", { name: "AI 处理选区" })
    .click();
  await page.getByRole("button", { name: "提问", exact: true }).click();
  await expect(page.locator(".question-attachment")).toHaveCount(1);
  await expect(
    page.getByRole("button", { name: "发送问题", exact: true }),
  ).toBeInViewport();
  await page.screenshot({ path: ".local/screenshots/chat-images-narrow.png" });
  for (let i = 0; i < 4; i++)
    await page.locator(".composer .image-remove").first().click();
  await picker.setInputFiles({
    name: "长截图.png",
    mimeType: "image/png",
    buffer: PNG.sync.write(new PNG({ width: 16, height: 9000 })),
  });
  await expect(page.locator(".composer .image-attachment")).toHaveCount(1);
  console.log(
    "Real clipboard image/text paste, preview/removal, invalid-file recovery, draft/history persistence, actual model image input, desktop/drawer resize and width persistence passed.",
  );
} finally {
  await browser.close();
  core.close();
}
