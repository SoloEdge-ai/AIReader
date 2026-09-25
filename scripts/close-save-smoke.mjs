import { _electron as electron, expect } from "@playwright/test";
import { PDFDocument } from "pdf-lib";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join, resolve, sep } from "node:path";
import { once } from "node:events";

const tempRoot = resolve(tmpdir());
const directory = await mkdtemp(join(tempRoot, "aireader-close-save-"));
const env = { ...process.env, ELECTRON_RUN_AS_NODE: undefined,
  AIREADER_CI: "1", AIREADER_DATA: directory };
async function within(promise, milliseconds, message) {
  let timer;
  try {
    return await Promise.race([promise, new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error(message)), milliseconds);
    })]);
  } finally { clearTimeout(timer); }
}
let desktop;
let completed = false;
try {
  desktop = await electron.launch({ args: ["."], env });
  const page = await desktop.firstWindow();
  await page.getByRole("heading", { name: "书库", exact: true }).waitFor();
  const pdf = await PDFDocument.create();
  pdf.addPage().drawText("Close-save acceptance source", { x: 35, y: 700 });
  await page.locator('input[type=file][accept="application/pdf"]').setInputFiles({
    name: "Close-save acceptance.pdf", mimeType: "application/pdf", buffer: Buffer.from(await pdf.save()),
  });
  await page.locator('[data-book-status="ready"]').waitFor();
  await page.getByRole("button", { name: "笔记", exact: true }).first().click();
  await page.getByRole("button", { name: "新建笔记" }).click();
  await page.route("**/api/books/*/notes/*", (route) => route.request().method() === "POST"
    ? route.fulfill({ status: 503, json: { error: "Injected save failure" } }) : route.continue());
  await page.getByLabel("笔记标题", { exact: true }).fill("关闭前提交测试");
  await page.locator(".tiptap").fill("这份草稿必须在窗口关闭前写入本机数据库。");
  expect(await page.evaluate(() => typeof window.aiReaderFlushBeforeClose)).toBe("function");
  await desktop.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].close());
  await expect(page.getByText(/关闭前保存失败，窗口和草稿已保留/)).toBeVisible();
  expect(await page.evaluate(() => document.body.inert)).toBe(false);
  await expect(page.locator(".tiptap")).toContainText("这份草稿必须在窗口关闭前写入本机数据库。");
  await page.unroute("**/api/books/*/notes/*");
  const closed = desktop.waitForEvent("close", { timeout: 20000 });
  await desktop.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].close());
  await closed;
  desktop = await electron.launch({ args: ["."], env });
  const reopened = await desktop.firstWindow();
  await reopened.locator(".book-card").first().click();
  await reopened.getByRole("button", { name: "笔记", exact: true }).first().click();
  await reopened.getByRole("button", { name: /关闭前提交测试/ }).click();
  await expect(reopened.locator(".tiptap")).toContainText("这份草稿必须在窗口关闭前写入本机数据库。");
  completed = true;
  console.log("Desktop close waited for note draft and reopen retained it.");
} finally {
  if (desktop) {
    const process = desktop.process();
    if (!completed) {
      if (process?.exitCode === null) {
        const exited = once(process, "exit");
        await desktop.evaluate(({ BrowserWindow }) =>
          BrowserWindow.getAllWindows().forEach((window) => window.destroy()))
          .catch(() => process.kill());
        await within(exited, 10000, "Desktop did not exit after destroying its test window").catch(() => {});
        if (process.exitCode === null) process.kill();
      }
    } else await within(desktop.close(), 20000, "Desktop did not close within 20 seconds")
      .catch((error) => { process?.kill(); throw error; });
  }
  const target = resolve(directory);
  if (!target.startsWith(tempRoot + sep) || !basename(target).startsWith("aireader-close-save-"))
    throw new Error("Refusing to remove an unexpected temporary directory");
  await rm(target, { recursive: true, force: true, maxRetries: 20, retryDelay: 200 });
}
