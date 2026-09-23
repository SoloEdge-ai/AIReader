import { chromium, expect } from "@playwright/test";
import { PDFDocument } from "pdf-lib";
import { mkdtemp, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { createCore } from "../apps/core/src/server";

const data = await mkdtemp(join(tmpdir(), "aireader-objects-smoke-"));
await mkdir(".local/screenshots", { recursive: true });
const core = createCore(data, resolve("dist/web"));
const pdf = await PDFDocument.create();
pdf.addPage([400, 320]).drawText("Object page one", { x: 30, y: 260 });
pdf.addPage([400, 320]).drawText("Object page two", { x: 30, y: 260 });
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
  await page.getByRole("button", { name: /Object acceptance/ }).click();
  await expect(page.locator("#page-1")).toHaveAttribute("data-render-ready", "true");
  const first = (await page.locator("#page-1").boundingBox())!;
  const workspace = async () => (await (await page.request.get(`${origin}/api/books/${book.id}/workspace`)).json());
  await page.getByRole("button", { name: "添加文本或卡片" }).click();
  await page.getByRole("menuitem", { name: "文本" }).click();
  await page.mouse.click(first.x + 80, first.y + 100);
  await expect(page.getByLabel("编辑画布文本")).toBeVisible();
  await page.getByLabel("编辑画布文本").fill("中文想法：比较两个概念");
  await page.getByLabel("编辑画布文本").press("Tab");
  await expect.poll(async () => (await workspace()).objects.length).toBe(1);
  await expect.poll(async () => (await workspace()).objects[0]?.text).toBe("中文想法：比较两个概念");
  const text = (await workspace()).objects[0];
  expect(text).toMatchObject({ kind: "text", text: "中文想法：比较两个概念", surface: { kind: "pdf", page: 1 } });
  await page.getByRole("button", { name: "对象格式" }).click();
  await page.getByLabel("文字字号").fill("20");
  await page.getByLabel("粗体文字").check();
  await page.getByLabel("文字对齐").selectOption("center");
  await expect.poll(async () => (await workspace()).objects[0].align).toBe("center");
  expect((await workspace()).objects[0]).toMatchObject({ fontSize: 20, bold: true });
  await page.getByRole("button", { name: "对象格式" }).click();
  await page.getByRole("button", { name: "添加形状" }).click();
  await page.getByRole("menuitem", { name: "矩形" }).click();
  await page.mouse.move(first.x + 50, first.y + 180);
  await page.mouse.down();
  await page.mouse.move(first.x + 180, first.y + 250, { steps: 8 });
  await page.mouse.up();
  await expect.poll(async () => (await workspace()).objects.length).toBe(2);
  expect((await workspace()).objects[1]).toMatchObject({ kind: "shape", shape: "rectangle", surface: { kind: "pdf", page: 1 } });
  const originalWidth = (await workspace()).objects[1].width;
  const resize = (await page.getByRole("button", { name: "调整对象大小" }).boundingBox())!;
  await page.mouse.move(resize.x + 5, resize.y + 5);
  await page.mouse.down();
  await page.mouse.move(resize.x + 35, resize.y + 25, { steps: 5 });
  await page.mouse.up();
  await expect.poll(async () => (await workspace()).objects[1].width).toBeGreaterThan(originalWidth);
  await page.getByRole("button", { name: "对象格式" }).click();
  await page.getByLabel("形状线宽").selectOption("4");
  await page.getByLabel("填充形状").check();
  await page.getByLabel("形状填充透明度").selectOption("0.3");
  await expect.poll(async () => (await workspace()).objects[1].fillOpacity).toBe(.3);
  expect((await workspace()).objects[1]).toMatchObject({ strokeWidth: 4, fill: "#345d84" });
  await page.getByLabel("形状填充透明度").press("Escape");
  await expect(page.getByRole("group", { name: "对象格式设置" })).toBeHidden();
  await expect(page.getByRole("button", { name: "指针（V）" })).toHaveAttribute("aria-pressed", "true");
  await page.getByRole("button", { name: "添加文本或卡片" }).click();
  await page.getByRole("menuitem", { name: "个人笔记卡片" }).click();
  await page.mouse.click(first.x + first.width + 100, first.y + 190);
  await expect.poll(async () => (await workspace()).cards.length).toBe(1);
  await page.getByRole("button", { name: "关系连线" }).click();
  await page.locator(`[data-object-id="${text.id}"]`).click();
  await page.locator(".workspace-card").first().click();
  await expect.poll(async () => (await workspace()).links.length).toBe(1);
  expect((await workspace()).links[0]).toMatchObject({ from: text.id });
  await page.getByRole("button", { name: "关联" }).click();
  const linkEditor = page.getByRole("toolbar", { name: "关系操作" });
  await linkEditor.getByLabel("关系名称").fill("概念对照");
  await linkEditor.getByLabel("关系方向").check();
  await linkEditor.getByLabel("关系名称").press("Tab");
  await expect.poll(async () => (await workspace()).links[0].label).toBe("概念对照");
  expect((await workspace()).links[0].directed).toBe(true);
  await page.getByRole("button", { name: "指针（V）" }).click();
  const before = (await workspace()).objects[0];
  const textBox = (await page.locator(`[data-object-id="${text.id}"]`).boundingBox())!;
  await page.mouse.move(textBox.x + 20, textBox.y + 15);
  await page.mouse.down();
  await page.mouse.move(textBox.x + 45, textBox.y + 35, { steps: 5 });
  await page.mouse.up();
  await expect.poll(async () => (await workspace()).objects[0].x).not.toBe(before.x);
  const groupBefore = await workspace();
  await page.locator(`[data-object-id="${text.id}"]`).click();
  await page.locator(".workspace-card").first().click({ modifiers: ["Shift"] });
  await expect(page.getByRole("toolbar", { name: "对象操作" })).toContainText("2 个对象");
  const cardHeader = (await page.locator(".workspace-card header").first().boundingBox())!;
  await page.mouse.move(cardHeader.x + 50, cardHeader.y + 12);
  await page.mouse.down();
  await page.mouse.move(cardHeader.x + 75, cardHeader.y + 27, { steps: 5 });
  await page.mouse.up();
  await expect.poll(async () => (await workspace()).cards[0].x).toBeGreaterThan(groupBefore.cards[0].x);
  const groupAfter = await workspace();
  expect(groupAfter.objects[0].x - groupBefore.objects[0].x)
    .toBeCloseTo(groupAfter.cards[0].x - groupBefore.cards[0].x, 1);
  await page.locator(".pdf-scroll").focus();
  await page.keyboard.press("l");
  await expect(page.getByRole("button", { name: "套索（L）" })).toHaveAttribute("aria-pressed", "true");
  const moved = (await page.locator(`[data-object-id="${text.id}"]`).boundingBox())!;
  await page.mouse.move(moved.x - 20, moved.y - 20);
  await page.mouse.down();
  for (const [x, y] of [[moved.x + moved.width + 20, moved.y - 20],
    [moved.x + moved.width + 20, moved.y + moved.height + 20],
    [moved.x - 20, moved.y + moved.height + 20], [moved.x - 20, moved.y - 20]])
    await page.mouse.move(x, y, { steps: 5 });
  await page.mouse.up();
  await expect(page.getByRole("toolbar", { name: "对象操作" })).toBeVisible();
  await page.screenshot({ path: ".local/screenshots/objects-lasso.png" });
  await page.evaluate(() => { document.documentElement.dataset.theme = "dark"; });
  await page.screenshot({ path: ".local/screenshots/objects-lasso-dark.png" });
  await page.evaluate(() => { document.documentElement.dataset.theme = "light"; });
  await page.keyboard.press("Escape");
  await expect(page.getByRole("button", { name: "指针（V）" })).toHaveAttribute("aria-pressed", "true");
  await page.reload();
  await page.getByRole("button", { name: /Object acceptance/ }).click();
  expect((await workspace()).objects).toHaveLength(2);
  expect((await workspace()).links).toHaveLength(1);
  await page.getByRole("button", { name: "旋转页面" }).click();
  const rotatedPage = (await page.locator("#page-1").boundingBox())!;
  const rotatedText = (await page.locator(`[data-object-id="${text.id}"]`).boundingBox())!;
  expect(rotatedText.x).toBeGreaterThanOrEqual(rotatedPage.x - 2);
  expect(rotatedText.y).toBeGreaterThanOrEqual(rotatedPage.y - 2);
  expect(rotatedText.x + rotatedText.width).toBeLessThanOrEqual(rotatedPage.x + rotatedPage.width + 2);
  expect(rotatedText.y + rotatedText.height).toBeLessThanOrEqual(rotatedPage.y + rotatedPage.height + 2);
  const source = await page.evaluate(async (id) => {
    const response = await fetch(`/api/books/${id}/annotations`, { method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ kind: "highlight", color: "yellow", quote: "原文来源",
        anchors: [{ page: 1, rects: [[20, 245, 85, 275]] }] }) });
    return { status: response.status, value: await response.json() };
  }, book.id);
  expect(source.status).toBe(201);
  const annotation = source.value;
  await page.reload();
  await page.getByRole("button", { name: /Object acceptance/ }).click();
  await expect(page.locator(".annotation-highlight")).toHaveCount(1);
  await page.getByRole("button", { name: "关系连线" }).click();
  await page.locator(".annotation-highlight").click();
  await page.locator(".workspace-card").first().click();
  await expect.poll(async () => (await workspace()).links.length).toBe(2);
  expect((await workspace()).links[1].from).toBe(annotation.id);
  await page.locator(".pdf-scroll").focus();
  await page.keyboard.press("l");
  const marker = (await page.locator(".annotation-highlight").boundingBox())!;
  await page.mouse.move(marker.x - 12, marker.y - 12);
  await page.mouse.down();
  for (const [x, y] of [[marker.x + marker.width + 12, marker.y - 12],
    [marker.x + marker.width + 12, marker.y + marker.height + 12],
    [marker.x - 12, marker.y + marker.height + 12], [marker.x - 12, marker.y - 12]])
    await page.mouse.move(x, y, { steps: 4 });
  await page.mouse.up();
  const selectedSource = page.getByRole("toolbar", { name: "对象操作" });
  await expect(selectedSource).toContainText("原文固定");
  await selectedSource.getByLabel("批注颜色").selectOption("blue");
  await expect.poll(async () => page.evaluate(async (id) =>
    (await (await fetch(`/api/books/${id}/annotations`)).json())[0].color, book.id))
    .toBe("blue");
  await page.locator(".pdf-scroll").focus();
  await page.keyboard.press("Control+z");
  await expect.poll(async () => page.evaluate(async (id) =>
    (await (await fetch(`/api/books/${id}/annotations`)).json())[0].color, book.id))
    .toBe("yellow");
  await page.keyboard.press("Control+y");
  await expect.poll(async () => page.evaluate(async (id) =>
    (await (await fetch(`/api/books/${id}/annotations`)).json())[0].color, book.id))
    .toBe("blue");
  await selectedSource.getByRole("button", { name: "删除选中对象" }).click();
  await expect.poll(async () => (await workspace()).links.length).toBe(1);
  await expect(selectedSource).toBeHidden();
  await page.locator(".pdf-scroll").focus();
  await page.keyboard.press("Control+z");
  await expect.poll(async () => (await workspace()).links.length).toBe(2);
  await page.keyboard.press("Control+y");
  await expect.poll(async () => (await workspace()).links.length).toBe(1);
  await page.keyboard.press("Control+z");
  await expect.poll(async () => (await workspace()).links.length).toBe(2);
  expect(errors).toEqual([]);
  console.log("Text, shape, card link, lasso, object move, and restart passed.");
} finally {
  await browser.close();
  await new Promise<void>((done) => core.server.close(() => done()));
  core.library.close();
}
