import { chromium, expect } from "@playwright/test";
import { PDFDocument } from "pdf-lib";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { createCore } from "../apps/core/src/server";
import type { BookWorkspace } from "../packages/protocol/src/workspace";

// CI-only UI regression: real renderer, PDF and HTTP. No production library/account.
const data = await mkdtemp(join(tmpdir(), "aireader-workspace-smoke-"));
const core = createCore(data, resolve("dist/web"));
const pdf = await PDFDocument.create();
pdf
  .addPage([400, 500])
  .drawText("An excerpt retains its source.", { x: 30, y: 420, size: 14 });
const book = await core.library.import(
  Buffer.from(await pdf.save()),
  "Workspace acceptance.pdf",
);
await core.library.waitForBook(book.id);
await new Promise<void>((done) => core.server.listen(0, "127.0.0.1", done));
const address = core.server.address();
if (!address || typeof address === "string") throw new Error("Missing port");
const origin = `http://127.0.0.1:${address.port}`;
const browser = await chromium.launch({ channel: "msedge", headless: true });
try {
  const context = await browser.newContext({
    viewport: { width: 1440, height: 960 },
  });
  const page = await context.newPage();
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto(origin);
  await page.getByRole("button", { name: /Workspace acceptance/ }).click();
  await expect(page.locator("#page-1")).toHaveAttribute(
    "data-render-ready",
    "true",
  );
  await page.getByRole("button", { name: "＋ 笔记卡片" }).click();
  await page
    .getByRole("textbox", { name: "个人笔记内容", exact: true })
    .fill("A durable personal interpretation.");
  await expect(
    page.getByRole("status", { name: "工作区保存状态" }),
  ).toContainText("已保存");

  // Cards dock beside the document even when keyboard movement aims into its column.
  const card = page.locator(".workspace-card").first();
  await card.locator("header").focus();
  for (let step = 0; step < 8; step++)
    await page.keyboard.press("Shift+ArrowLeft");
  const cardRect = (await card.boundingBox())!;
  const pdfRect = (await page.locator("#page-1").boundingBox())!;
  expect(
    cardRect.x >= pdfRect.x + pdfRect.width ||
      cardRect.x + cardRect.width <= pdfRect.x,
  ).toBe(true);
  await page.getByRole("button", { name: "定位正文", exact: true }).click();
  const centered = (await page.locator("#page-1").boundingBox())!;
  const view = (await page.locator(".pdf-scroll").boundingBox())!;
  const clientWidth = await page
    .locator(".pdf-scroll")
    .evaluate((el) => el.clientWidth);
  expect(
    Math.abs(centered.x + centered.width / 2 - view.x - clientWidth / 2),
  ).toBeLessThan(2);
  // Empty-canvas drag pans both the document and card by the same distance.
  const initialPdf = centered,
    initialCard = (await card.boundingBox())!;
  await page.mouse.move(view.x + 12, view.y + 200);
  await page.mouse.down();
  await page.mouse.move(view.x + 112, view.y + 240, { steps: 6 });
  await page.mouse.up();
  const pannedPdf = (await page.locator("#page-1").boundingBox())!;
  const pannedCard = (await card.boundingBox())!;
  expect(
    Math.abs(pannedCard.x - initialCard.x - (pannedPdf.x - initialPdf.x)),
  ).toBeLessThan(2);
  expect(pannedPdf.x - initialPdf.x).toBeGreaterThan(90);
  const text = page
    .locator("#page-1 .textLayer span")
    .filter({ hasText: "An excerpt" });
  const textBox = (await text.boundingBox())!;
  await page.mouse.move(textBox.x + 2, textBox.y + textBox.height / 2);
  await page.mouse.down();
  await page.mouse.move(
    textBox.x + textBox.width - 2,
    textBox.y + textBox.height / 2,
    { steps: 8 },
  );
  await page.mouse.up();
  expect(await page.evaluate(() => getSelection()?.toString())).toContain(
    "excerpt",
  );
  const pdfBeforeRightDrag = (await page.locator("#page-1").boundingBox())!;
  await page.mouse.move(textBox.x + 15, textBox.y + 200);
  await page.mouse.down({ button: "right" });
  await page.mouse.move(textBox.x + 95, textBox.y + 200, { steps: 6 });
  await page.mouse.up({ button: "right" });
  expect(
    (await page.locator("#page-1").boundingBox())!.x - pdfBeforeRightDrag.x,
  ).toBeGreaterThan(70);

  const measure = () =>
    page.locator(".pdf-scroll").evaluate((el) => ({
      left: el.scrollLeft,
      top: el.scrollTop,
      scale: Number(
        (
          el.querySelector(".workspace-objects") as HTMLElement
        ).style.transform.match(/scale\(([^)]+)\)/)![1],
      ),
    }));
  const box = (await page.locator(".pdf-scroll").boundingBox())!;
  const x = 300,
    y = 250;
  const before = await measure();
  await page.mouse.move(box.x + x, box.y + y);
  await page.keyboard.down("Control");
  await page.mouse.wheel(0, -100);
  await page.keyboard.up("Control");
  await expect
    .poll(async () => (await measure()).scale)
    .toBeGreaterThan(before.scale);
  const after = await measure();
  expect(
    Math.abs((after.left + x) / after.scale - (before.left + x) / before.scale),
  ).toBeLessThan(2);
  expect(
    Math.abs((after.top + y) / after.scale - (before.top + y) / before.scale),
  ).toBeLessThan(2);
  expect(await page.evaluate(() => window.visualViewport?.scale)).toBe(1);
  await page.mouse.wheel(0, 120);
  await expect
    .poll(async () => (await measure()).top)
    .toBeGreaterThan(after.top);
  expect((await measure()).scale).toBe(after.scale);

  // Set up a below-document card through the public API, then verify viewport behavior through UI.
  const endpoint = origin + `/api/books/${book.id}/workspace`;
  const saved: BookWorkspace = await (
    await context.request.get(endpoint)
  ).json();
  const positioned = await context.request.post(endpoint, {
    headers: { Origin: origin },
    data: {
      ...saved,
      cards: saved.cards.map((card) => ({ ...card, y: 1800 })),
    },
  });
  expect(positioned.ok()).toBe(true);
  await page.reload();
  await page.getByRole("button", { name: /Workspace acceptance/ }).click();
  await page
    .getByRole("textbox", { name: "个人笔记内容", exact: true })
    .click();
  const outside = await measure();
  expect(outside.top / outside.scale).toBeGreaterThan(500);
  await page.getByRole("button", { name: "放大", exact: true }).click();
  const enlarged = await measure();
  expect(
    Math.abs(
      (enlarged.top + 20) / enlarged.scale - (outside.top + 20) / outside.scale,
    ),
  ).toBeLessThan(2);

  // Hold a real progress response to exercise edits during departure; don't fake Core data.
  let release!: () => void;
  const held = new Promise<void>((done) => {
    release = done;
  });
  await page.route("**/api/books/*/progress", async (route) => {
    const response = await route.fetch();
    await held;
    await route.fulfill({ response });
  });
  await page.getByRole("button", { name: "返回书库" }).click();
  await expect(page.locator(".reader")).toHaveAttribute("inert", "");
  release();
  await expect(page.getByRole("heading", { name: "书库" })).toBeVisible();
  await page.unroute("**/api/books/*/progress");
  await page.getByRole("button", { name: /Workspace acceptance/ }).click();
  await expect(
    page.getByRole("textbox", { name: "个人笔记内容", exact: true }),
  ).toHaveValue("A durable personal interpretation.");
  expect(errors).toEqual([]);
  console.log(
    "Workspace persistence, Ctrl-wheel cursor anchoring, ordinary scroll, beyond-document zoom and navigation guard passed.",
  );
} finally {
  await browser.close();
  core.close();
}
