import { _electron as electron, expect } from "@playwright/test";
import { PDFDocument, StandardFonts } from "pdf-lib";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

await mkdir(".local", { recursive: true });
const data = await mkdtemp(resolve(".local/selection-acceptance-"));
const pdf = await PDFDocument.create();
const font = await pdf.embedFont(StandardFonts.Helvetica);
pdf
  .addPage([500, 700])
  .drawText("A selected passage for reading actions.", {
    font,
    x: 40,
    y: 600,
    size: 16,
  });
const fixture = resolve(data, "selection.pdf");
await writeFile(fixture, await pdf.save());
const app = await electron.launch({
  executablePath: process.argv[2] ? resolve(process.argv[2]) : undefined,
  args: process.argv[2] ? [] : ["."],
  env: { ...process.env, ELECTRON_RUN_AS_NODE: undefined, AIREADER_DATA: data },
});
try {
  const page = await app.firstWindow();
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.locator("input[type=file]").setInputFiles(fixture);
  const text = page.locator("#page-1 .textLayer span").first();
  await text.waitFor();
  const toolbar = page.locator(".selection-bar");
  async function selectPassage() {
    const box = await text.boundingBox();
    await page.mouse.move(box.x + 2, box.y + box.height / 2);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width - 2, box.y + box.height / 2, {
      steps: 12,
    });
    await page.mouse.up();
    await expect(toolbar).toBeVisible();
  }
  await selectPassage();
  await page.locator("#page-1").click({ position: { x: 30, y: 300 } });
  await expect
    .poll(() => page.evaluate(() => getSelection().toString()))
    .toBe("");
  await expect(toolbar).toHaveCount(0);

  await selectPassage();
  await page.locator(".toolbar strong").click();
  await expect(toolbar).toHaveCount(0);

  await selectPassage();
  await toolbar.getByRole("button", { name: "解释", exact: true }).click();
  await expect(page.getByLabel("问题", { exact: true })).toHaveValue(
    "请解释选中的原文。",
  );
  await expect(page.locator('option[value="selection"]')).toBeEnabled();
  await page.getByLabel("问题", { exact: true }).fill("解释这一段");
  await expect(page.locator('option[value="selection"]')).toBeEnabled();
  await page.getByRole("button", { name: "收起侧栏" }).click();

  await selectPassage();
  const color = page.getByLabel("选区批注颜色", { exact: true });
  await color.click();
  await color.press("Home");
  await color.press("ArrowDown");
  await color.press("Enter");
  await expect(color).toHaveValue("green");
  await expect(toolbar).toBeVisible();
  await toolbar.getByRole("button", { name: "高亮", exact: true }).click();
  await expect(page.locator(".annotation-highlight")).toHaveCount(1);
  await expect(toolbar).toHaveCount(0);
  expect(errors).toEqual([]);
  console.log(
    "Selection dismissal, outside click, annotation color/actions and question handoff passed.",
  );
} finally {
  await app.close();
}
