import { chromium, expect } from "@playwright/test";
import { PDFDocument } from "pdf-lib";
import { mkdtemp, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { createCore } from "../apps/core/src/server";

const data = await mkdtemp(join(tmpdir(), "aireader-materials-smoke-"));
await mkdir(".local/screenshots", { recursive: true });
const core = createCore(data, resolve("dist/web"));
const pdf = await PDFDocument.create();
pdf.addPage([400, 320]).drawText("Material acceptance source", { x: 30, y: 260 });
const book = await core.library.import(Buffer.from(await pdf.save()), "Material acceptance.pdf");
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
  await page.getByRole("button", { name: /Material acceptance/ }).click();
  await expect(page.locator("#page-1")).toHaveAttribute("data-render-ready", "true");
  const source = (await page.locator("#page-1").boundingBox())!;
  await page.getByRole("button", { name: "添加形状" }).click();
  await page.getByRole("menuitem", { name: "矩形" }).click();
  await page.mouse.move(source.x + 60, source.y + 100);
  await page.mouse.down();
  await page.mouse.move(source.x + 200, source.y + 190, { steps: 8 });
  await page.mouse.up();
  await expect(page.getByRole("button", { name: "将选中对象加入提问" })).toBeVisible();
  await page.getByRole("button", { name: "将选中对象加入提问" }).click();
  await expect(page.locator(".question-material-item")).toHaveCount(1);
  await page.locator(".question-material-item summary").click();
  await expect.poll(() => page.locator(".question-material-item img").evaluate((image: HTMLImageElement) =>
    image.naturalWidth)).toBeGreaterThan(0);
  await expect(page.locator(".question-material-item")).toContainText("个人形状");
  await page.screenshot({ path: ".local/screenshots/question-materials.png" });
  await page.setViewportSize({ width: 1280, height: 720 });
  await page.evaluate(() => { document.documentElement.dataset.theme = "dark"; });
  await expect(page.locator(".question-material-item")).toBeVisible();
  await page.screenshot({ path: ".local/screenshots/question-materials-dark-narrow.png" });
  const sessions = await page.evaluate(async (id) => {
    const sessions = await (await fetch(`/api/books/${id}/sessions`)).json();
    return sessions.length;
  }, book.id);
  expect(sessions).toBeGreaterThan(0);
  expect(errors).toEqual([]);
  console.log("Canvas shape preview frozen into the chat composer without login.");
} finally {
  await browser.close();
  await new Promise<void>((done) => core.server.close(() => done()));
  core.library.close();
}
