import { chromium, expect } from "@playwright/test";
import { PDFDocument } from "pdf-lib";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { createCore } from "../apps/core/src/server";

const data = await mkdtemp(join(tmpdir(), "aireader-objects-smoke-"));
const core = createCore(data, resolve("dist/web"));
const pdf = await PDFDocument.create();
pdf.addPage([400, 320]).drawText("Object page one", { x: 30, y: 260 });
const book = await core.library.import(Buffer.from(await pdf.save()), "Object acceptance.pdf");
await core.library.waitForBook(book.id);
await new Promise<void>((done) => core.server.listen(0, "127.0.0.1", done));
const address = core.server.address();
if (!address || typeof address === "string") throw new Error("Missing port");
const origin = `http://127.0.0.1:${address.port}`;
const browser = await chromium.launch({ channel: "msedge", headless: true });
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto(origin);
  await page.locator(".book-card").first().click();
  const board = page.getByRole("region", { name: "工作台" });
  const viewport = board.locator(".pdf-scroll");
  await expect(viewport).toHaveAttribute("data-workspace-ready", "true");
  const rect = (await viewport.boundingBox())!;
  const workspace = async () => (await (await page.request.get(
    `${origin}/api/books/${book.id}/workspace`)).json());

  await page.getByRole("button", { name: "添加文本或卡片" }).click();
  await page.getByRole("menuitem", { name: "文本" }).click();
  await page.mouse.click(rect.x + 110, rect.y + 120);
  await page.getByLabel("编辑画布文本").fill("中文想法：比较两个概念");
  await page.getByLabel("编辑画布文本").press("Tab");
  await expect.poll(async () => (await workspace()).objects[0]?.text)
    .toBe("中文想法：比较两个概念");
  const text = (await workspace()).objects[0];
  expect(text.surface.kind).toBe("board");
  await page.getByRole("button", { name: "对象格式" }).click();
  await page.getByLabel("文字字号").fill("20");
  await page.getByLabel("粗体文字").check();
  await page.getByLabel("文字对齐").selectOption("center");
  await expect.poll(async () => (await workspace()).objects[0]?.align).toBe("center");
  await page.getByRole("button", { name: "对象格式" }).click();

  await page.getByRole("button", { name: "添加形状" }).click();
  await page.getByRole("menuitem", { name: "矩形" }).click();
  await page.mouse.move(rect.x + 260, rect.y + 190);
  await page.mouse.down();
  await page.mouse.move(rect.x + 390, rect.y + 260, { steps: 6 });
  await page.mouse.up();
  await expect.poll(async () => (await workspace()).objects.length).toBe(2);
  expect((await workspace()).objects[1]).toMatchObject({ kind: "shape", shape: "rectangle",
    surface: { kind: "board" } });
  const originalWidth = (await workspace()).objects[1].width;
  const resize = (await page.getByRole("button", { name: "调整对象大小" }).boundingBox())!;
  await page.mouse.move(resize.x + 6, resize.y + 6);
  await page.mouse.down();
  await page.mouse.move(resize.x + 36, resize.y + 26, { steps: 5 });
  await page.mouse.up();
  await expect.poll(async () => (await workspace()).objects[1]?.width).toBeGreaterThan(originalWidth);
  await page.getByRole("button", { name: "对象格式" }).click();
  await page.getByLabel("形状线宽").selectOption("4");
  await page.getByLabel("填充形状").check();
  await page.getByLabel("形状填充透明度").selectOption("0.3");
  await expect.poll(async () => (await workspace()).objects[1]?.fillOpacity).toBe(.3);
  await page.getByRole("button", { name: "对象格式" }).click();

  await board.getByRole("button", { name: "新建笔记" }).click();
  const card = board.locator(".workspace-card.note");
  await expect(card).toHaveCount(1);
  const header = (await card.locator("header").boundingBox())!;
  await page.mouse.move(header.x + 35, header.y + 12);
  await page.mouse.down();
  await page.mouse.move(header.x + 335, header.y + 212, { steps: 8 });
  await page.mouse.up();
  await page.getByRole("button", { name: "关系连线" }).click();
  await page.locator(`[data-object-id="${text.id}"]`).click();
  await card.click();
  await expect.poll(async () => (await workspace()).links.length).toBe(1);
  expect((await workspace()).links[0]).toMatchObject({ from: text.id });
  await page.getByRole("button", { name: "关联" }).focus();
  await page.keyboard.press("Enter");
  const linkEditor = page.getByRole("toolbar", { name: "关系操作" });
  await linkEditor.getByLabel("关系名称").fill("概念对照");
  await linkEditor.getByLabel("关系方向").check();
  await linkEditor.getByLabel("关系名称").press("Tab");
  await expect.poll(async () => (await workspace()).links[0]?.label).toBe("概念对照");
  expect((await workspace()).links[0].directed).toBe(true);
  await page.getByRole("button", { name: "指针（V）" }).click();
  await page.getByRole("button", { name: "返回书库" }).click();
  await page.locator(".book-card").first().click();
  expect((await workspace()).objects).toHaveLength(2);
  expect((await workspace()).cards).toHaveLength(1);
  expect((await workspace()).links).toHaveLength(1);
  expect(errors).toEqual([]);
  console.log("Board text, shape, styling, relation and restart passed.");
} finally {
  await browser.close();
  core.close();
}
