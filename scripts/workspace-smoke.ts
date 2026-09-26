import { chromium, expect } from "@playwright/test";
import { PDFDocument } from "pdf-lib";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { createCore } from "../apps/core/src/server";

// Real renderer, PDF, Core HTTP and SQLite with an isolated generated book.
const data = await mkdtemp(join(tmpdir(), "aireader-workspace-smoke-"));
const core = createCore(data, resolve("dist/web"));
const pdf = await PDFDocument.create();
for (let page = 0; page < 4; page++)
  pdf.addPage([400, 500]).drawText(`Workspace acceptance page ${page + 1}`, { x: 30, y: 420 });
const book = await core.library.import(Buffer.from(await pdf.save()), "Workspace acceptance.pdf");
await core.library.waitForBook(book.id);
await new Promise<void>((done) => core.server.listen(0, "127.0.0.1", done));
const address = core.server.address();
if (!address || typeof address === "string") throw new Error("Missing Core port");
const origin = `http://127.0.0.1:${address.port}`;
const browser = await chromium.launch({ channel: "msedge", headless: true });
try {
  const context = await browser.newContext({ viewport: { width: 1440, height: 960 } });
  const page = await context.newPage();
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto(origin);
  await page.locator(".book-card").first().click();
  const document = page.getByRole("region", { name: "原文" });
  // This regression exercises independent surfaces; spatial layout has its own reader acceptance.
  const deskLayoutButton = page.getByRole("button", { name: "切换桌面布局" });
  if ((await deskLayoutButton.textContent()) === "空间") await deskLayoutButton.click();
  const board = page.getByRole("region", { name: "工作台" });
  await expect(document.locator("#page-1")).toHaveAttribute("data-render-ready", "true");
  await expect(board.locator(".pdf-scroll")).toHaveAttribute("data-workspace-ready", "true");

  const pdfZoom = document.getByLabel("原文缩放");
  const boardZoom = board.getByLabel("工作台缩放");
  const numeric = async (output: typeof pdfZoom) => Number((await output.textContent())!.replace("%", ""));
  const initialPdf = await numeric(pdfZoom), initialBoard = await numeric(boardZoom);
  const wheelZoom = async (selector: string) => {
    const rect = (await page.locator(selector).boundingBox())!;
    await page.mouse.move(rect.x + rect.width / 2, rect.y + rect.height / 2);
    await page.keyboard.down("Control");
    await page.mouse.wheel(0, -160);
    await page.keyboard.up("Control");
  };
  await wheelZoom(".pdf-pane .pdf-scroll");
  await expect.poll(() => numeric(pdfZoom)).toBeGreaterThan(initialPdf);
  expect(await numeric(boardZoom)).toBe(initialBoard);
  const afterPdf = await numeric(pdfZoom);
  await wheelZoom(".board-pane .pdf-scroll");
  await expect.poll(() => numeric(boardZoom)).toBeGreaterThan(initialBoard);
  expect(await numeric(pdfZoom)).toBe(afterPdf);

  await board.getByRole("button", { name: "新建笔记" }).click();
  const card = board.locator(".workspace-card.note");
  await expect(card).toHaveCount(1);
  const editor = page.getByRole("dialog", { name: "展开笔记编辑" });
  await editor.getByLabel("笔记标题", { exact: true }).fill("Workspace interpretation");
  await editor.getByRole("textbox", { name: "笔记正文" }).fill("A durable personal interpretation.");
  await expect(editor.getByRole("status")).toHaveText("已保存");
  await page.getByRole("button", { name: "关闭笔记浮窗" }).click();
  await expect(card).toContainText("A durable personal interpretation.");
  const workspaceUrl = `${origin}/api/books/${book.id}/workspace`;
  await expect.poll(async () => (await (await context.request.get(workspaceUrl)).json()).cards.length).toBe(1);

  await page.getByRole("button", { name: "返回书库" }).click();
  await page.locator(".book-card").first().click();
  await expect(board.locator(".workspace-card.note")).toContainText("A durable personal interpretation.");
  expect(await numeric(boardZoom)).toBeGreaterThan(initialBoard);
  expect(await numeric(pdfZoom)).toBe(afterPdf);
  expect(errors).toEqual([]);
  console.log("Independent PDF/board Ctrl-wheel zoom, atomic note placement, save and reopen passed.");
} finally {
  await browser.close();
  core.close();
}
