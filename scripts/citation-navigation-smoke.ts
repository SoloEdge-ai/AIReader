import { chromium, expect, type Page } from "@playwright/test";
import { PDFDocument, PDFName, StandardFonts } from "pdf-lib";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { createCore } from "../apps/core/src/server";

// The fixture's physical PDF size is known independently of PDF.js. Observe only
// visible DOM geometry at the reader's documented top+20px / horizontal-center point.
async function readingPoint(
  page: Page,
  physicalPage: number,
  rotation: 0 | 90 = 0,
) {
  const viewport = await page.locator(".pdf-pane .pdf-scroll").evaluate((node) => {
    const rect = node.getBoundingClientRect();
    return { x: rect.left + node.clientWidth / 2, y: rect.top + 20 };
  });
  const sheet = (await page.locator(`.pdf-pane #page-${physicalPage}`).boundingBox())!;
  const x = (viewport.x - sheet.x) / sheet.width;
  const y = (viewport.y - sheet.y) / sheet.height;
  return rotation === 0 ? [x * 600, (1 - y) * 1200] : [y * 600, x * 1200];
}

async function settleGeometry(page: Page) {
  await page.evaluate(
    () =>
      new Promise<void>((done) => {
        requestAnimationFrame(() =>
          requestAnimationFrame(() => requestAnimationFrame(() => done())),
        );
      }),
  );
}

async function expectReadingPoint(
  page: Page,
  physicalPage: number,
  expected: number[],
  rotation: 0 | 90 = 0,
) {
  await expect(
    page.getByRole("textbox", { name: "页码", exact: true }),
  ).toHaveValue(String(physicalPage));
  await expect
    .poll(async () => {
      const actual = await readingPoint(page, physicalPage, rotation);
      return Math.max(
        ...actual.map((value, index) => Math.abs(value - expected[index])),
      );
    })
    .toBeLessThan(2);
}

async function followCitation(page: Page) {
  await page
    .getByRole("button", { name: "预览第 i 页原文", exact: true })
    .click();
  await page
    .getByRole("dialog", { name: "原文预览", exact: true })
    .getByRole("button", { name: "前往原文", exact: true })
    .click();
  await expect(
    page.getByRole("textbox", { name: "页码", exact: true }),
  ).toHaveValue("1");
}

// Only the external Codex stdio process is mocked. PDF, Core and UI are real.
await mkdir(".local/screenshots", { recursive: true });
const data = await mkdtemp(resolve(".local/citation-navigation-"));
const pdf = await PDFDocument.create();
const font = await pdf.embedFont(StandardFonts.Helvetica);
for (let number = 1; number <= 3; number++) {
  const pdfPage = pdf.addPage([600, 1200]);
  for (let line = 0; line < 45; line++)
    pdfPage.drawText(
      number === 1 && line === 0
        ? "Memory cache stores previous tokens and avoids repeated computation."
        : `Reading page ${number}, line ${line + 1}. A stable reference for navigation.`,
      { font, size: 11, x: 35, y: 1120 - line * 23 },
    );
}
pdf.catalog.set(
  PDFName.of("PageLabels"),
  pdf.context.obj({ Nums: [0, { S: PDFName.of("r") }] }),
);
const file = resolve(data, "citation-navigation.pdf");
await writeFile(file, await pdf.save());
const otherPdf = await PDFDocument.create();
otherPdf.addPage().drawText("This book must have its own reading history.");
const otherFile = resolve(data, "separate-navigation-book.pdf");
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
  });
  page = await context.newPage();
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto(base);
  await page
    .locator('input[type=file][accept="application/pdf"]')
    .setInputFiles(file);
  await page.locator('[data-book-status="ready"]').waitFor();
  await page.getByRole("button", { name: "问答", exact: true }).first().click();
  await context.request.post(base + "/api/ai/connect", {
    headers: { Origin: base },
  });
  await expect(
    page.getByRole("button", { name: "模型与思考强度" }),
  ).toContainText("Fixture A", { timeout: 15000 });
  await page
    .getByRole("textbox", { name: "问题", exact: true })
    .fill("Explain memory cache");
  await page.getByRole("button", { name: "发送问题", exact: true }).click();
  await expect(page.locator(".turn .answer")).toContainText(
    "supported statement",
  );
  const back = page.getByRole("button", { name: "返回阅读位置", exact: true });
  const pageInput = page.getByRole("textbox", { name: "页码", exact: true });
  const trigger = page.getByRole("button", { name: "预览第 i 页原文", exact: true });
  const preview = page.getByRole("dialog", { name: "原文预览", exact: true });
  await expect(back).toHaveCount(0);
  await pageInput.fill("2");
  await pageInput.press("Enter");
  await expect(pageInput).toHaveValue("2");
  await trigger.click();
  await expect(preview).toContainText(
    "Memory cache stores previous tokens and avoids repeated computation.",
  );
  await expect(preview).toContainText("物理页 1");
  await expect(pageInput).toHaveValue("2");
  // The current chat streams turn updates; a source preview stays open across them.
  await page.waitForTimeout(1200);
  await expect(preview).toBeVisible();
  await preview.getByRole("button", { name: "前往原文", exact: true }).click();
  await expect(pageInput).toHaveValue("1");
  await expect(back).toBeVisible();
  await back.click();
  await expect(pageInput).toHaveValue("2");
  await expect(back).toHaveCount(0);

  await followCitation(page);
  await pageInput.fill("3");
  await pageInput.press("Enter");
  await followCitation(page);
  await back.click();
  await expect(pageInput).toHaveValue("3");
  await back.click();
  await expect(pageInput).toHaveValue("2");
  await expect(back).toHaveCount(0);

  await page.locator(".pdf-pane .pdf-scroll").focus();
  const readerBox = (await page.locator(".pdf-pane .pdf-scroll").boundingBox())!;
  await page.mouse.move(readerBox.x + readerBox.width / 2, readerBox.y + 250);
  await page.mouse.wheel(0, 660);
  await settleGeometry(page);
  const readingBeforeJump = await readingPoint(page, 2);
  await followCitation(page);
  await back.click();
  await expectReadingPoint(page, 2, readingBeforeJump);

  await pageInput.fill("3");
  await pageInput.press("Enter");
  await settleGeometry(page);
  const readingBeforeZoom = await readingPoint(page, 3);
  await followCitation(page);
  await page.getByRole("button", { name: "放大原文", exact: true }).click();
  await back.click();
  await expectReadingPoint(page, 3, readingBeforeZoom);

  await trigger.focus();
  await trigger.press("Enter");
  await expect(preview).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(preview).not.toBeVisible();
  await expect(trigger).toBeFocused();
  await trigger.click();
  await preview.getByRole("button", { name: "关闭原文预览", exact: true }).click();
  await expect(trigger).toBeFocused();
  await trigger.click();
  await pageInput.click();
  await expect(preview).not.toBeVisible();
  await expect(pageInput).toBeFocused();

  await page.setViewportSize({ width: 860, height: 760 });
  await trigger.click();
  await expect(preview.getByRole("button", { name: "前往原文", exact: true }))
    .toBeInViewport();
  await page.screenshot({ path: ".local/screenshots/citation-preview-narrow.png" });
  await page.keyboard.press("Escape");

  await page.getByRole("button", { name: "返回书库", exact: true }).click();
  await expect(page.locator(".library")).toBeVisible();
  await page.locator('input[type=file][accept="application/pdf"]').setInputFiles(otherFile);
  await page.locator('[data-book-status="ready"]').waitFor();
  await expect(back).toHaveCount(0);
  await page.getByRole("button", { name: "返回书库", exact: true }).click();
  await page.locator(".book-card").filter({ hasText: "citation-navigation" }).click();
  await expect(back).toHaveCount(0);  expect(errors).toEqual([]);
  console.log(
    "Citation navigation: frozen preview, focus, precise return, zoom, narrow layout and book isolation passed.",
  );
} catch (error) {
  await page
    ?.screenshot({ path: ".local/screenshots/citation-navigation-failure.png" })
    .catch(() => {});
  throw error;
} finally {
  await browser.close();
  core.close();
}
