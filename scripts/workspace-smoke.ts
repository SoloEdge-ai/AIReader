import { chromium, expect } from "@playwright/test";
import { PDFDocument } from "pdf-lib";
import { mkdir, mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { createCore } from "../apps/core/src/server";
import type { BookWorkspace } from "../packages/protocol/src/workspace";

// CI-only UI regression: real renderer, PDF and HTTP. No production library/account.
const data = await mkdtemp(join(tmpdir(), "aireader-workspace-smoke-"));
await mkdir(".local/screenshots", { recursive: true });
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
  const palette = page.getByRole("toolbar", { name: "阅读工具盘" });
  await page.screenshot({ path: ".local/screenshots/tool-palette-default.png" });
  await expect(page.getByRole("button", { name: "指针（V）" })).toHaveAttribute("aria-pressed", "true");
  const pageBeforePointer = (await page.locator("#page-1").boundingBox())!;
  await page.mouse.move(pageBeforePointer.x + 120, pageBeforePointer.y + 130);
  await page.mouse.down();
  await page.mouse.move(pageBeforePointer.x + 70, pageBeforePointer.y + 130, { steps: 5 });
  await page.mouse.up();
  expect((await page.locator("#page-1").boundingBox())!.x).toBeLessThan(pageBeforePointer.x - 35);
  expect(await page.evaluate(() => getSelection()?.toString() ?? "")).toBe("");
  const grip = (await page.getByRole("button", { name: "拖动工具盘" }).boundingBox())!;
  const reading = (await page.locator(".reading").boundingBox())!;
  await page.mouse.move(grip.x + grip.width / 2, grip.y + grip.height / 2);
  await page.mouse.down();
  await page.mouse.move(reading.x + reading.width - 25, reading.y + reading.height / 2, { steps: 6 });
  await page.mouse.up();
  await expect(palette).toHaveAttribute("data-dock", "right");
  await page.screenshot({ path: ".local/screenshots/tool-palette-right.png" });
  await page.getByRole("button", { name: "收起工具盘" }).click();
  await page.reload();
  await page.getByRole("button", { name: /Workspace acceptance/ }).click();
  await expect(palette).toHaveAttribute("data-dock", "right");
  await page.getByRole("button", { name: /展开工具盘，当前指针/ }).click();
  await expect(page.getByRole("button", { name: "指针（V）" })).toHaveAttribute("aria-pressed", "true");
  await page.getByRole("button", { name: /工作区操作/ }).click();
  await page.getByRole("menuitem", { name: "＋ 笔记卡片" }).click();
  const card = page.locator(".workspace-card.note").first();
  await card.getByRole("textbox", { name: "笔记正文" }).fill("A durable personal interpretation.");
  await card.getByRole("textbox", { name: "笔记正文" }).press("Escape");
  await expect(page.getByRole("button", { name: "指针（V）" })).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByRole("button", { name: "工作区操作，已保存" })).toBeVisible();

  // Cards dock beside the document even when keyboard movement aims into its column.
  await card.locator("header").focus();
  for (let step = 0; step < 8; step++)
    await page.keyboard.press("Shift+ArrowLeft");
  const cardRect = (await card.boundingBox())!;
  const pdfRect = (await page.locator("#page-1").boundingBox())!;
  expect(
    cardRect.x >= pdfRect.x + pdfRect.width ||
      cardRect.x + cardRect.width <= pdfRect.x,
  ).toBe(true);
  await page.getByRole("button", { name: /工作区操作/ }).click();
  await page.getByRole("menuitem", { name: "定位正文", exact: true }).click();
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
  await page.getByRole("button", { name: "选择文字（T）" }).click();
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
  await page.screenshot({ path: ".local/screenshots/selection-toolbar.png" });
  await page.getByRole("button", { name: "标注方式" }).click();
  await expect(page.getByRole("dialog", { name: "标注方式" })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog", { name: "标注方式" })).toBeHidden();
  await expect(page.getByRole("button", { name: "指针（V）" })).toHaveAttribute("aria-pressed", "true");
  await page.getByRole("button", { name: "选择文字（T）" }).click();
  await expect(page.getByRole("button", { name: "选择文字（T）" })).toHaveAttribute("aria-pressed", "true");
  const beforeSpace = (await page.locator("#page-1").boundingBox())!;
  await page.keyboard.down("Space");
  await page.mouse.move(beforeSpace.x + 150, beforeSpace.y + 220);
  await page.mouse.down();
  await page.mouse.move(beforeSpace.x + 100, beforeSpace.y + 220, { steps: 5 });
  await page.mouse.up();
  await page.keyboard.up("Space");
  expect((await page.locator("#page-1").boundingBox())!.x).toBeLessThan(beforeSpace.x - 35);
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
  const positioned = await context.request.post(endpoint + "/commands", {
    headers: { Origin: origin },
    data: {
      bookId: book.id,
      commandId: "position-below-document",
      expectedVersion: saved.revision,
      changes: saved.cards.map((card) => ({ type: "upsert-card", card: { ...card, y: 1800 } })),
    },
  });
  expect(positioned.ok()).toBe(true);
  await page.reload();
  await page.getByRole("button", { name: /Workspace acceptance/ }).click();
  await card.locator("header").click();
  await card.getByRole("textbox", { name: "笔记正文" }).click();
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
  await expect(card.locator(".workspace-note-preview")).toHaveText("A durable personal interpretation.");
  await card.locator("header").scrollIntoViewIfNeeded();
  const geometry = (await (await context.request.get(endpoint)).json()).cards;
  const header = (await card.locator("header").boundingBox())!;
  await page.mouse.move(header.x + 30, header.y + 12);
  await page.mouse.down({ button: "right" });
  await page.mouse.move(header.x + 100, header.y + 12, { steps: 5 });
  await page.mouse.up({ button: "right" });
  await expect(page.getByRole("button", { name: "工作区操作，已保存" })).toBeVisible();
  expect((await (await context.request.get(endpoint)).json()).cards).toEqual(
    geometry,
  );
  // Clamping at the canvas origin must not prevent a changed zoom being persisted.
  await page.locator(".pdf-scroll").evaluate((el) => el.scrollTo(0, 0));
  await page.getByRole("button", { name: "缩小", exact: true }).click();
  const originZoom = (await measure()).scale;
  await page.getByRole("button", { name: "返回书库" }).click();
  await page.getByRole("button", { name: /Workspace acceptance/ }).click();
  await page.locator(".workspace-objects").waitFor({ state: "attached" });
  await expect.poll(async () => (await measure()).scale).toBe(originZoom);
  const downloadEvent = page.waitForEvent("download");
  await page.getByRole("button", { name: /工作区操作/ }).click();
  await page.getByRole("menuitem", { name: "打包工作区", exact: true }).click();
  const download = await downloadEvent;
  const archiveFile = await download.path();
  if (!archiveFile) throw new Error("Missing workspace download");
  await page.getByRole("button", { name: "返回书库" }).click();
  await page
    .getByLabel("选择工作区包", { exact: true })
    .setInputFiles(archiveFile);
  await expect(page.locator(".reader")).toBeVisible();
  await expect(card.locator(".workspace-note-preview")).toHaveText("A durable personal interpretation.");
  expect(
    await (await context.request.get(origin + "/api/books")).json(),
  ).toHaveLength(2);
  expect(errors).toEqual([]);
  console.log(
    "Workspace persistence, Ctrl-wheel cursor anchoring, ordinary scroll, beyond-document zoom and navigation guard passed.",
  );
} finally {
  await browser.close();
  core.close();
}
