import { _electron as electron, expect } from "@playwright/test";
import { PDFDocument, StandardFonts } from "pdf-lib";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

await mkdir(".local", { recursive: true });
const data = await mkdtemp(resolve(".local/selection-acceptance-"));
const pdf = await PDFDocument.create();
const font = await pdf.embedFont(StandardFonts.Helvetica);
pdf.addPage([500, 700]).drawText("A selected passage for reading actions.", {
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
  await page
    .locator('input[type=file][accept="application/pdf"]')
    .setInputFiles(fixture);
  const text = page.locator("#page-1 .textLayer span").first();
  await text.waitFor();
  await expect(page.locator("#page-1")).toHaveAttribute("data-render-ready", "true");
  await page.locator('[data-book-status="ready"]').waitFor();
  const toolbar = page.locator(".selection-bar");
  // Browsing is the default. Text selection must be an explicit tool choice.
  const browseBox = await text.boundingBox();
  await page.mouse.move(browseBox.x + 3, browseBox.y + browseBox.height / 2);
  await page.mouse.down();
  await page.mouse.move(browseBox.x + browseBox.width - 3, browseBox.y + browseBox.height / 2);
  await page.mouse.up();
  await expect(toolbar).toHaveCount(0);
  await page.getByRole("button", { name: "选择文字（T）" }).click();
  await expect(page.getByRole("button", { name: "选择文字（T）" })).toHaveAttribute("aria-pressed", "true");
  async function selectPassage(startFraction = 0) {
    await text.scrollIntoViewIfNeeded();
    // The Windows CI virtual display makes pointer text selection intermittent.
    // Exercise PDF.js's real text layer and the mouseup selection handler with
    // a deterministic DOM selection; the default pointer's drag is tested above.
    await text.evaluate((element, fraction) => {
      element.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, button: 0 }));
      const node = element.firstChild;
      if (!node || node.nodeType !== Node.TEXT_NODE) throw new Error("PDF text node missing");
      const range = document.createRange();
      range.setStart(node, Math.floor(node.textContent.length * fraction));
      range.setEnd(node, node.textContent.length);
      const selection = getSelection();
      selection.removeAllRanges();
      selection.addRange(range);
      element.dispatchEvent(new MouseEvent("mouseup", { bubbles: true, button: 0 }));
    }, startFraction);
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

  await page.getByRole("button", { name: "问答", exact: true }).first().click();
  await selectPassage();
  await expect(page.locator(".selection-candidate")).toContainText("尚未添加");
  await expect(page.locator(".question-attachment")).toHaveCount(0);
  await page.getByLabel("提问范围", { exact: true }).selectOption("selection");
  await page.getByLabel("问题", { exact: true }).fill("直接使用选中的原文");
  await expect(page.locator('option[value="selection"]')).toBeEnabled();
  await expect(page.locator(".question-attachment")).toContainText(
    "A selected passage",
  );
  await expect(toolbar).toHaveCount(0);
  // A new temporary selection must not silently replace the attached passage.
  await page.getByRole("button", { name: "重新选择引用", exact: true }).click();
  await selectPassage(0.5);
  await expect(page.locator(".question-attachment")).toContainText(
    "A selected passage",
  );
  await page.getByRole("button", { name: "替换引用", exact: true }).click();
  await page.getByLabel("问题", { exact: true }).fill("换一个选区继续提问");
  await expect(page.locator('option[value="selection"]')).toBeEnabled();
  await expect(page.locator(".question-attachment")).toContainText(
    "reading actions",
  );
  await expect(page.locator(".question-attachment")).not.toContainText(
    "A selected passage",
  );
  await page.getByRole("button", { name: "关闭问答浮窗" }).click();
  await page.getByRole("button", { name: "问答", exact: true }).first().click();
  await expect(page.locator(".question-attachment")).toContainText(
    "reading actions",
  );
  await expect(page.getByLabel("问题", { exact: true })).toHaveValue(
    "换一个选区继续提问",
  );
  await page.getByRole("button", { name: "移除引用", exact: true }).click();
  await expect(page.locator(".question-attachment")).toHaveCount(0);
  await expect(page.getByLabel("提问范围", { exact: true })).toHaveValue(
    "auto",
  );
  await expect(page.getByLabel("问题", { exact: true })).toHaveValue(
    "换一个选区继续提问",
  );
  await page.getByRole("button", { name: "关闭问答浮窗" }).click();

  await selectPassage();
  await toolbar.getByRole("button", { name: "AI 处理选区" }).click();
  await page.getByRole("button", { name: "解释", exact: true }).click();
  await expect(page.getByLabel("问题", { exact: true })).toHaveValue(
    "请解释选中的原文。",
  );
  await expect(page.locator('option[value="selection"]')).toBeEnabled();
  await page.getByLabel("问题", { exact: true }).fill("解释这一段");
  await expect(page.locator('option[value="selection"]')).toBeEnabled();
  await page.getByRole("button", { name: "关闭问答浮窗" }).click();

  await selectPassage();
  await toolbar.getByRole("button", { name: "标注颜色：黄色" }).click();
  await page.getByRole("button", { name: "绿色", exact: true }).click();
  await expect(toolbar.getByRole("button", { name: "标注颜色：绿色" })).toBeVisible();
  await expect(toolbar).toBeVisible();
  await toolbar.getByRole("button", { name: "标注方式" }).click();
  await page.getByRole("button", { name: "高亮", exact: true }).click();
  await expect(page.locator(".annotation-highlight")).toHaveCount(1);
  await expect(toolbar).toHaveCount(0);
  expect(errors).toEqual([]);
  console.log(
    "Selection dismissal, outside click, annotation color/actions and question handoff passed.",
  );
} finally {
  await app.close();
}
