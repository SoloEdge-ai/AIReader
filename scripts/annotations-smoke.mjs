import { _electron as electron, expect } from "@playwright/test";
import { PDFDocument, StandardFonts, degrees } from "pdf-lib";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
await mkdir(".local/screenshots", { recursive: true });
const pdf = await PDFDocument.create(),
  font = await pdf.embedFont(StandardFonts.Helvetica);
for (let i = 0; i < 8; i++) {
  const p = pdf.addPage([500, 700]);
  if (i !== 2)
    p.drawText(`Page ${i + 1}: Reading annotations and notes.`, {
      font,
      x: 40,
      y: 600,
      size: 16,
    });
  if (i === 3) p.setRotation(degrees(90));
  if (i === 1) p.drawText("Second column.", { font, x: 310, y: 560, size: 12 });
}
const fixture = resolve(".local/annotations-fixture.pdf");
await writeFile(fixture, await pdf.save());
const app = await electron.launch({
  executablePath: process.argv[3] ? resolve(process.argv[3]) : undefined,
  args: [
    ...(process.argv[3] ? [] : ["."]),
    `--force-device-scale-factor=${process.argv[2] ?? 1}`,
  ],
  env: {
    ...process.env,
    ELECTRON_RUN_AS_NODE: undefined,
    AIREADER_DATA: resolve(".local/annotations-" + Date.now()),
  },
});
try {
  const page = await app.firstWindow();
  // Missed startup events must not leave a fully parsed document stuck in "parsing".
  await page.routeWebSocket("**/events", (socket) => socket.close());
  await page.reload();
  // Electron handles this with its native close confirmation, not a Chromium dialog.
  page.on("dialog", () => {});
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page
    .locator('input[type=file][accept="application/pdf"]')
    .setInputFiles(fixture);
  await page.locator(".textLayer span").first().waitFor();
  await page.locator('[data-book-status="ready"]').waitFor();
  await page.getByRole("button", { name: "选择文字（T）" }).click();
  await page
    .locator("#page-1 .textLayer span")
    .first()
    .evaluate((el) => {
      const r = document.createRange();
      r.selectNodeContents(el);
      getSelection().removeAllRanges();
      getSelection().addRange(r);
      el.dispatchEvent(
        new MouseEvent("mouseup", {
          bubbles: true,
          clientX: 200,
          clientY: 200,
        }),
      );
    });
  await page.getByRole("button", { name: "标注方式" }).click();
  await page.getByRole("button", { name: "高亮", exact: true }).click();
  await expect(page.locator(".annotation-highlight")).toHaveCount(1);
  await expect(page.getByLabel("笔记标题", { exact: true })).toHaveCount(0);
  await page.getByRole("button", { name: "写评论", exact: true }).click();
  await page.getByLabel("笔记标题", { exact: true }).fill("Reading experiment");
  await page.locator(".tiptap").fill("A saved observation.");
  await expect(
    page.locator(".notes-panel").getByText("已保存", { exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "返回书库" }).click();
  await page.locator(".book-card").first().click();
  await expect(page.locator(".annotation-highlight")).toHaveCount(1);
  if (!(await page.locator(".notes-panel").isVisible()))
    await page.getByLabel("笔记", { exact: true }).click();
  await page.getByRole("button", { name: /Reading experiment/ }).click();
  await expect(page.locator(".tiptap")).toContainText("A saved observation.");
  await page.route("**/api/books/*/notes/*", (route) =>
    route.request().method() === "POST"
      ? route.fulfill({
          status: 500,
          contentType: "application/json",
          body: JSON.stringify({ error: "Simulated save failure" }),
        })
      : route.continue(),
  );
  await page.locator(".tiptap").fill("Draft retained after failure.");
  await expect(page.getByText(/保存失败，草稿仍保留/)).toBeVisible();
  await app.evaluate(({ app, dialog }) => {
    dialog.showMessageBoxSync = () => 0;
    app.quit();
  });
  await expect(page.locator(".tiptap")).toContainText(
    "Draft retained after failure.",
  );
  await page.getByRole("button", { name: "返回书库" }).click();
  await expect(page.locator(".tiptap")).toContainText(
    "Draft retained after failure.",
  );
  await page.unroute("**/api/books/*/notes/*");
  await page.getByRole("button", { name: "重试保存" }).click();
  await expect(
    page.locator(".notes-panel").getByText("已保存", { exact: true }),
  ).toBeVisible();
  let dropped = false;
  await page.route("**/api/books/*/notes/*", async (route) => {
    if (route.request().method() === "POST" && !dropped) {
      dropped = true;
      await route.fetch();
      await route.abort("failed");
    } else await route.continue();
  });
  await page.locator(".tiptap").fill("Committed despite a lost response.");
  await expect(
    page.locator(".notes-panel").getByText("已保存", { exact: true }),
  ).toBeVisible();
  await page.unroute("**/api/books/*/notes/*");
  await page.getByLabel("批注颜色", { exact: true }).selectOption("green");
  await page.getByRole("button", { name: "删除批注", exact: true }).click();
  await expect(page.locator(".annotation-highlight")).toHaveCount(0);
  await expect(page.locator(".tiptap")).toContainText("Committed despite a lost response.");
  await expect(page.getByText("源标注已删除，以下保留原文位置与摘录。")).toBeVisible();
  await page.getByRole("button", { name: "撤销批注操作" }).click();
  await expect(page.locator(".annotation-highlight")).toHaveCount(1);
  await page.screenshot({ path: ".local/screenshots/notes.png" });
  await page.getByRole("button", { name: "收起侧栏" }).click();
  await page.getByLabel("页码", { exact: true }).fill("6");
  await page.getByLabel("页码", { exact: true }).press("Enter");
  await expect(page.getByLabel("页码", { exact: true })).toHaveValue("6");
  await page.getByRole("button", { name: "放大", exact: true }).click();
  await expect(page.getByLabel("页码", { exact: true })).toHaveValue("6");
  await page.screenshot({ path: ".local/screenshots/annotations.png" });
  await page.getByLabel("页码", { exact: true }).fill("3");
  await page.getByLabel("页码", { exact: true }).press("Enter");
  await expect(page.getByLabel("页码", { exact: true })).toHaveValue("3");
  await page.getByRole("button", { name: "区域摘录（R）" }).click();
  await expect(page.locator("#page-3")).toHaveAttribute(
    "data-render-ready",
    "true",
  );
  const box = await page.locator("#page-3").boundingBox();
  await page.mouse.move(box.x + 80, box.y + 80);
  await page.mouse.down();
  await page.mouse.move(box.x + 200, box.y + 180);
  await page.mouse.up();
  await page.getByRole("toolbar", { name: "区域摘录操作" }).getByRole("button", { name: "批注" }).click();
  await expect(page.locator(".annotation-region")).toHaveCount(1);
  await expect(page.getByAltText("区域摘录")).toBeVisible();
  await page.getByRole("button", { name: "收起侧栏" }).click();
  await page.getByRole("button", { name: "区域摘录（R）" }).click();
  const excerptBox = await page.locator("#page-3").boundingBox();
  await page.mouse.move(excerptBox.x + 85, excerptBox.y + 85);
  await page.mouse.down();
  await page.mouse.move(excerptBox.x + 195, excerptBox.y + 175);
  await page.mouse.up();
  await page.getByRole("toolbar", { name: "区域摘录操作" }).getByRole("button", { name: "创建图片卡片" }).click();
  await expect(page.locator(".workspace-card.region")).toHaveCount(1);
  await expect.poll(() => page.locator(".workspace-card.region img").evaluate((image) => image.naturalWidth)).toBeGreaterThan(0);
  await page.getByRole("button", { name: "旋转页面" }).click();
  await expect(page.locator(".annotation-region")).toHaveCount(1);
  await page.getByRole("button", { name: "添加文本或卡片" }).click();
  await page.getByRole("menuitem", { name: "页内便签" }).click();
  const rotated = await page.locator("#page-3").boundingBox();
  await page.mouse.click(rotated.x + 200, Math.max(80, rotated.y + 150));
  await expect(page.locator(".annotation-sticky")).toHaveCount(1);
  await page.getByRole("button", { name: "收起侧栏" }).click();
  await page.getByRole("button", { name: "设置", exact: true }).click();
  await page.getByLabel("主题", { exact: true }).selectOption("dark");
  await page.getByRole("button", { name: "关闭设置" }).click();
  await page.screenshot({ path: ".local/screenshots/annotations-dark.png" });
  await app.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows()[0].setSize(960, 720),
  );
  await page.getByLabel("笔记", { exact: true }).click();
  await expect(page.locator(".side-panel")).toBeVisible();
  await page.screenshot({ path: ".local/screenshots/notes-narrow.png" });
  await page.getByRole("button", { name: "收起侧栏" }).click();
  for (let i = 0; i < 3; i++)
    await page.getByRole("button", { name: "旋转页面" }).click();
  for (let i = 0; i < 8; i++)
    await page.getByRole("button", { name: "缩小", exact: true }).click();
  await page.getByLabel("页码", { exact: true }).fill("1");
  await page.getByLabel("页码", { exact: true }).press("Enter");
  await page.getByRole("button", { name: "选择文字（T）" }).click();
  await page.locator("#page-2 .textLayer span").first().waitFor();
  await page.waitForTimeout(300);
  await page
    .locator("#page-1 .textLayer span")
    .first()
    .evaluate((el) => {
      const end = document.querySelector(
        "#page-2 .textLayer span:last-of-type",
      );
      const r = document.createRange();
      r.setStart(el.firstChild, 0);
      r.setEnd(end.firstChild, end.textContent.length);
      getSelection().removeAllRanges();
      getSelection().addRange(r);
      el.dispatchEvent(
        new MouseEvent("mouseup", {
          bubbles: true,
          clientX: 300,
          clientY: 350,
        }),
      );
    });
  await page.getByRole("button", { name: "标注方式" }).click();
  await page.getByRole("button", { name: "下划线", exact: true }).click();
  await expect(page.locator("#page-1 .annotation-underline")).toHaveCount(1);
  await expect(page.locator("#page-2 .annotation-underline")).toHaveCount(2);
  const sizes = await page
    .locator(".annotation-underline")
    .evaluateAll((elements) =>
      elements.map((e) => e.getBoundingClientRect().height),
    );
  expect(sizes.every((h) => h < 20)).toBeTruthy();
  await page.getByRole("button", { name: "收起侧栏" }).click();
  await page.getByLabel("页码", { exact: true }).fill("4");
  await page.getByLabel("页码", { exact: true }).press("Enter");
  await page.locator("#page-4 .textLayer span").first().waitFor();
  await page
    .locator("#page-4 .textLayer span")
    .first()
    .evaluate((el) => {
      const r = document.createRange();
      r.selectNodeContents(el);
      getSelection().removeAllRanges();
      getSelection().addRange(r);
      el.dispatchEvent(
        new MouseEvent("mouseup", {
          bubbles: true,
          clientX: 300,
          clientY: 350,
        }),
      );
    });
  await page.getByRole("button", { name: "标注方式" }).click();
  await page.getByRole("button", { name: "删除线", exact: true }).click();
  await expect(page.locator("#page-4 .annotation-strike")).toHaveCount(1);
  for (let angle = 0; angle < 4; angle++) {
    const line = await page
      .locator("#page-4 .annotation-strike line")
      .evaluate((e) => ({
        x1: Number(e.getAttribute("x1")),
        x2: Number(e.getAttribute("x2")),
        y1: Number(e.getAttribute("y1")),
        y2: Number(e.getAttribute("y2")),
      }));
    expect(
      angle % 2 === 0
        ? Math.abs(line.x1 - line.x2) < 0.1
        : Math.abs(line.y1 - line.y2) < 0.1,
    ).toBeTruthy();
    await page.getByRole("button", { name: "旋转页面" }).click();
  }
  expect(errors).toEqual([]);
  console.log(
    `Annotations, autosave/recovery, vetoed quit, reopen, cross-page, rotation and zoom anchor passed at ${process.argv[2] ?? 1}x DPI`,
  );
} catch (error) {
  console.error(error);
  const window = await app.firstWindow();
  console.error(
    "Reader failure state",
    await window
      .evaluate(async () => ({
        visible: document.body.innerText,
        books: await fetch("/api/books").then((r) => r.json()),
      }))
      .catch(() => "Window unavailable"),
  );
  throw error;
} finally {
  await app
    .evaluate(({ BrowserWindow }) => {
      for (const window of BrowserWindow.getAllWindows()) window.destroy();
    })
    .catch(() => {});
  await app.close();
}
