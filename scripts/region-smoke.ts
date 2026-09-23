import { chromium, expect } from "@playwright/test";
import { PDFDocument, rgb } from "pdf-lib";
import { mkdir, mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { createCore } from "../apps/core/src/server";

const data = await mkdtemp(join(tmpdir(), "aireader-region-smoke-"));
await mkdir(".local/screenshots", { recursive: true });
const core = createCore(data, resolve("dist/web"));
const pdf = await PDFDocument.create();
pdf.addPage([500, 700]).drawRectangle({ x: 60, y: 400, width: 220, height: 160, color: rgb(.3, .6, .8) });
const book = await core.library.import(Buffer.from(await pdf.save()), "Region acceptance.pdf");
await core.library.waitForBook(book.id);
await new Promise<void>((done) => core.server.listen(0, "127.0.0.1", done));
const address = core.server.address();
if (!address || typeof address === "string") throw new Error("Missing Core port");
const origin = `http://127.0.0.1:${address.port}`;
const browser = await chromium.launch({ channel: "msedge", headless: true });
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto(origin);
  await page.getByRole("button", { name: /Region acceptance/ }).click();
  await expect(page.locator("#page-1")).toHaveAttribute("data-render-ready", "true");
  await page.getByRole("button", { name: "区域摘录（R）" }).click();
  const pageBox = (await page.locator("#page-1").boundingBox())!;
  await page.mouse.move(pageBox.x + 50, pageBox.y + 145);
  await page.mouse.down();
  await page.mouse.move(pageBox.x + 300, pageBox.y + 315, { steps: 8 });
  await page.mouse.up();
  const actions = page.getByRole("toolbar", { name: "区域摘录操作" });
  await expect(actions).toBeVisible();
  await page.screenshot({ path: ".local/screenshots/region-preview.png" });
  await actions.getByRole("button", { name: "创建图片卡片" }).click();
  const card = page.locator(".workspace-card.region");
  await expect(card).toHaveCount(1);
  await expect.poll(() => card.locator("img").evaluate((image: HTMLImageElement) => image.naturalWidth)).toBeGreaterThan(0);
  await page.getByRole("button", { name: "撤销工作区修改" }).click();
  await expect(card).toHaveCount(0);
  await page.getByRole("button", { name: "重做工作区修改" }).click();
  await expect(card).toHaveCount(1);
  await expect(page.getByRole("status", { name: "工作区保存状态" })).toContainText("已保存");
  await expect(page.getByRole("button", { name: "指针（V）" })).toHaveAttribute("aria-pressed", "true");
  await page.screenshot({ path: ".local/screenshots/region-card.png" });
  const saved = await (await page.request.get(`${origin}/api/books/${book.id}/workspace`)).json();
  expect(saved.cards[0].region).toMatchObject({ page: 1, includePersonalMarks: false });
  const originalPixels = Buffer.from(await (await page.request.get(
    `${origin}/api/books/${book.id}/workspace-assets/${saved.cards[0].region.assetId}`)).body());
  await card.getByRole("button", { name: /第 1 页/ }).click();
  await expect(page.locator(".workspace-source-focus")).toHaveCount(1);
  const highlight = await page.request.post(`${origin}/api/books/${book.id}/annotations`, {
    headers: { Origin: origin },
    data: { kind: "highlight", color: "yellow", quote: "", anchors: [{ page: 1, rects: [[70, 420, 180, 500]] }] },
  });
  expect(highlight.ok()).toBe(true);
  await page.reload();
  await page.getByRole("button", { name: /Region acceptance/ }).click();
  await expect(page.locator(".workspace-card.region")).toHaveCount(1);
  await expect(page.locator(".annotation-highlight")).toHaveCount(1);
  await page.getByRole("button", { name: "区域摘录（R）" }).click();
  const next = (await page.locator("#page-1").boundingBox())!;
  await page.mouse.move(next.x + 50, next.y + 145);
  await page.mouse.down();
  await page.mouse.move(next.x + 300, next.y + 315, { steps: 8 });
  await page.mouse.up();
  const secondActions = page.getByRole("toolbar", { name: "区域摘录操作" });
  await secondActions.getByLabel("包含个人标注").check();
  await secondActions.getByRole("button", { name: "创建图片卡片" }).click();
  await expect(page.locator(".workspace-card.region")).toHaveCount(2);
  const marked = await (await page.request.get(`${origin}/api/books/${book.id}/workspace`)).json();
  expect(marked.cards[1].region.includePersonalMarks).toBe(true);
  const markedPixels = Buffer.from(await (await page.request.get(
    `${origin}/api/books/${book.id}/workspace-assets/${marked.cards[1].region.assetId}`)).body());
  expect(markedPixels.equals(originalPixels)).toBe(false);
  await page.getByRole("button", { name: "区域摘录（R）" }).click();
  const third = (await page.locator("#page-1").boundingBox())!;
  await page.mouse.move(third.x + 70, third.y + 160);
  await page.mouse.down();
  await page.mouse.move(third.x + 260, third.y + 300, { steps: 8 });
  await page.mouse.up();
  await page.getByRole("toolbar", { name: "区域摘录操作" }).getByRole("button", { name: "加入提问" }).click();
  await expect(page.getByLabel("待发送图片")).toContainText("第 1 页区域");
  expect(errors).toEqual([]);
  console.log("Region card creation, source jump, restart persistence and explicit question attachment passed.");
} finally {
  await browser.close();
  core.close();
}
