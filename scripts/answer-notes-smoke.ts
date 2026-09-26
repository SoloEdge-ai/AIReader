import { chromium, expect, type Page } from "@playwright/test";
import { PDFDocument, StandardFonts } from "pdf-lib";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { createCore } from "../apps/core/src/server";
import type { Note } from "../packages/protocol/src";

// Real Core HTTP and renderer UI; only the external Codex process is substituted.
await mkdir(".local/screenshots", { recursive: true });
const data = await mkdtemp(resolve(".local/answer-notes-acceptance-"));
const pdf = await PDFDocument.create();
const font = await pdf.embedFont(StandardFonts.Helvetica);
for (let number = 1; number <= 2; number++) {
  const pdfPage = pdf.addPage();
  pdfPage.drawText(
    number === 1
      ? "Memory cache stores previous tokens and avoids repeated computation."
      : "The second page demonstrates returning to the cited first page.",
    { font, size: 11, x: 35, y: 785 },
  );
}
const file = resolve(data, "answer-notes-fixture.pdf");
await writeFile(file, await pdf.save());
const otherPdf = await PDFDocument.create();
otherPdf
  .addPage()
  .drawText("A separate book must not contain another book's notes.");
const otherFile = resolve(data, "separate-book.pdf");
await writeFile(otherFile, await otherPdf.save());
const core = createCore(data, resolve("dist/web"), {
  path: process.execPath,
  version: "fixture",
  args: [resolve("tests/fixtures/fake-codex.mjs")],
});
await new Promise<void>((done) => core.server.listen(0, "127.0.0.1", done));
const address = core.server.address();
if (!address || typeof address === "string")
  throw new Error("Missing server address");
const base = `http://127.0.0.1:${address.port}`;
const browser = await chromium.launch({ channel: "msedge", headless: true });
let page: Page | undefined;
try {
  const context = await browser.newContext({
    viewport: { width: 1440, height: 960 },
    acceptDownloads: true,
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
  const firstSave = page.waitForResponse(
    (response) =>
      response.request().method() === "POST" &&
      /\/turns\/[^/]+\/note$/.test(new URL(response.url()).pathname),
  );
  await page.getByRole("button", { name: "存为笔记", exact: true }).click();
  const saved: { note: Note; created: boolean } = await (
    await firstSave
  ).json();
  expect(saved.created).toBe(true);
  await expect(page.locator(".note-detail-preview")).toContainText(
    "supported statement",
  );
  await page.getByRole("button", { name: "展开编辑笔记" }).click();
  await expect(
    page.getByText("AI 生成 · 可编辑的回答笔记", { exact: true }),
  ).toBeVisible();
  await page
    .getByRole("textbox", { name: "笔记标题", exact: true })
    .fill("缓存机制阅读笔记");
  await page
    .getByRole("textbox", { name: "笔记正文", exact: true })
    .fill("我的理解：缓存复用已有计算结果。");
  // The footer can be below the scrolled note editor on a busy Windows runner;
  // assert the actual save state, not whether its accessible node is in view.
  try {
    await expect(page.locator(".expanded-note-footer [role=status]"))
      .toHaveText("已保存", { timeout: 20000 });
  } catch (error) {
    const statuses = await page.locator(".expanded-note [role=status]").allTextContents();
    throw new Error(`Note save did not settle: ${JSON.stringify(statuses)}`, { cause: error });
  }
  await expect(page.locator(".navigation .notes-panel")).toBeVisible();
  await expect(page.locator(".floating-chat .chat")).toBeVisible();
  await page.getByRole("button", { name: "收起笔记编辑" }).click();
  const [reopen] = await Promise.all([
    page.waitForResponse(
      (response) =>
        response.request().method() === "POST" &&
        /\/turns\/[^/]+\/note$/.test(new URL(response.url()).pathname),
    ),
    page.getByRole("button", { name: "打开笔记", exact: true }).click(),
  ]);
  const opened: { note: Note; created: boolean } = await reopen.json();
  expect(opened.created).toBe(false);
  expect(opened.note.id).toBe(saved.note.id);
  await page.getByRole("button", { name: "展开编辑笔记" }).click();
  await expect(
    page.getByRole("textbox", { name: "笔记标题", exact: true }),
  ).toHaveValue("缓存机制阅读笔记");
  await expect(
    page.getByRole("textbox", { name: "笔记正文", exact: true }),
  ).toHaveText("我的理解：缓存复用已有计算结果。");
  const noteList: Note[] = await (
    await context.request.get(`${base}/api/books/${saved.note.bookId}/notes`)
  ).json();
  expect(noteList).toHaveLength(1);
  expect(noteList[0].id).toBe(saved.note.id);
  await page.reload();
  await page
    .locator(".book-card")
    .filter({ hasText: "answer-notes-fixture" })
    .click();
  await page.locator(".nav-tabs").getByRole("button", { name: "材料" }).click();
  await page
    .locator(".notes-list")
    .getByRole("button", {
      name: /缓存机制阅读笔记/,
    })
    .click();
  await page.getByRole("button", { name: "展开编辑笔记" }).click();
  await expect(
    page.getByRole("textbox", { name: "笔记正文", exact: true }),
  ).toHaveText("我的理解：缓存复用已有计算结果。");
  await page.getByRole("button", { name: "收起笔记编辑" }).click();
  await page.getByRole("textbox", { name: "页码", exact: true }).fill("2");
  await page.getByRole("textbox", { name: "页码", exact: true }).press("Enter");
  await expect(
    page.getByRole("textbox", { name: "页码", exact: true }),
  ).toHaveValue("2");
  await page.getByText("原问题与出处 · 1 处原文", { exact: true }).click();
  await expect(page.locator(".note-origin-source")).toContainText(
    "Memory cache stores previous tokens and avoids repeated computation.",
  );
  await page.getByRole("button", { name: "第 1 页原文", exact: true }).click();
  await expect(
    page.getByRole("textbox", { name: "页码", exact: true }),
  ).toHaveValue("1");
  await page.screenshot({ path: ".local/screenshots/answer-notes-light.png" });
  const [download] = await Promise.all([
    page.waitForEvent("download"),
    page.getByRole("button", { name: "导出笔记", exact: true }).click(),
  ]);
  expect(download.suggestedFilename()).toBe(
    `AIReader-Note-${saved.note.id}.zip`,
  );
  const archive = resolve(data, download.suggestedFilename());
  await download.saveAs(archive);
  const archiveBytes = await readFile(archive);
  expect(archiveBytes.subarray(0, 4).toString("hex")).toBe("504b0304");
  await page.evaluate(() => {
    document.documentElement.dataset.theme = "dark";
  });
  await page.screenshot({ path: ".local/screenshots/answer-notes-dark.png" });
  await page.evaluate(() => {
    document.documentElement.dataset.theme = "light";
  });
  await page.getByRole("button", { name: "展开编辑笔记" }).click();
  await page.setViewportSize({ width: 860, height: 760 });
  const boardTab = page.getByRole("tab", { name: "工作台" });
  if (await boardTab.count()) await boardTab.click();
  await expect(
    page.getByRole("textbox", { name: "笔记正文", exact: true }),
  ).toBeInViewport();
  await page
    .getByRole("button", { name: "导出笔记", exact: true })
    .scrollIntoViewIfNeeded();
  await expect(
    page.getByRole("button", { name: "导出笔记", exact: true }),
  ).toBeInViewport();
  await page.screenshot({ path: ".local/screenshots/answer-notes-narrow.png" });
  await page.setViewportSize({ width: 1440, height: 960 });
  await page.getByRole("button", { name: "返回书库", exact: true }).click();
  await page
    .locator('input[type=file][accept="application/pdf"]')
    .setInputFiles(otherFile);
  await page.locator('[data-book-status="ready"]').waitFor();
  await page.getByRole("button", { name: "笔记", exact: true }).first().click();
  await expect(page.locator(".notes-panel")).toContainText(
    "选择一条批注，或新建笔记",
  );
  await expect(page.locator(".notes-list").getByRole("button")).toHaveCount(0);
  await page.getByRole("button", { name: "返回书库", exact: true }).click();
  await page
    .locator(".book-card")
    .filter({ hasText: "answer-notes-fixture" })
    .click();
  await page
    .locator(".notes-list")
    .getByRole("button", { name: /缓存机制阅读笔记/ })
    .click();
  await page.getByRole("button", { name: "展开编辑笔记" }).click();
  await expect(
    page.getByRole("textbox", { name: "笔记正文", exact: true }),
  ).toHaveText("我的理解：缓存复用已有计算结果。");
  expect(errors).toEqual([]);
  console.log(
    "Answer note HTTP/UI: save, edit, idempotent reopen, reload, source navigation, ZIP download and book isolation passed.",
  );
} catch (error) {
  await page
    ?.screenshot({ path: ".local/screenshots/answer-notes-failure.png" })
    .catch(() => {});
  throw error;
} finally {
  await browser.close();
  core.close();
}
