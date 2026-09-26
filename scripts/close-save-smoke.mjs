import { _electron as electron, expect } from "@playwright/test";
import { PDFDocument } from "pdf-lib";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join, resolve, sep } from "node:path";
import { once } from "node:events";
import { DatabaseSync } from "node:sqlite";

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
let blocker;
let completed = false;
try {
  desktop = await electron.launch({ args: ["."], env });
  const page = await desktop.firstWindow();
  await desktop.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setContentSize(1080, 760));
  await page.getByRole("heading", { name: "书库", exact: true }).waitFor();
  const pdf = await PDFDocument.create();
  pdf.addPage().drawText("Close-save acceptance source", { x: 35, y: 700 });
  await page.locator('input[type=file][accept="application/pdf"]').setInputFiles({
    name: "Close-save acceptance.pdf", mimeType: "application/pdf", buffer: Buffer.from(await pdf.save()),
  });
  await page.locator('[data-book-status="ready"]').waitFor();
  await page.getByRole("button", { name: "笔记", exact: true }).first().click();
  await page.locator(".notes-panel").getByRole("button", { name: "新建笔记", exact: true }).click();
  const bookId = await page.evaluate(async () => (await (await fetch("/api/books")).json())[0].id);
  const conflict = await page.evaluate(async (id) => {
    const notes = await (await fetch(`/api/books/${id}/notes`)).json();
    const note = notes[0];
    const response = await fetch(`/api/books/${id}/notes/${note.id}`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ revision: note.revision, title: "另一编辑端的版本", document: note.document }),
    });
    return response.status;
  }, bookId);
  expect(conflict).toBe(200);
  await page.getByLabel("笔记标题", { exact: true }).fill("关闭前提交测试");
  await page.locator(".tiptap").fill("这份草稿必须在窗口关闭前写入本机数据库。");
  expect(await page.evaluate(() => typeof window.aiReaderFlushBeforeClose)).toBe("function");
  await desktop.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].close());
  await expect(page.getByText(/关闭前保存失败，窗口和草稿已保留/)).toBeVisible();
  expect(await page.evaluate(() => document.body.inert)).toBe(false);
  await expect(page.locator(".tiptap")).toContainText("这份草稿必须在窗口关闭前写入本机数据库。");
  await page.getByRole("button", { name: "用此草稿覆盖最新版本" }).click();
  await expect.poll(async () => page.evaluate(async (id) =>
    (await (await fetch(`/api/books/${id}/notes`)).json())[0].title, bookId))
    .toBe("关闭前提交测试");
  await expect(page.locator(".notes-panel footer [role=status]")).toHaveText("已保存");
  const closed = desktop.waitForEvent("close", { timeout: 20000 });
  await desktop.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].close());
  try { await closed; }
  catch (error) {
    console.error("Close retry diagnostics:", await page.evaluate(() => ({
      inert: document.body.inert,
      alerts: [...document.querySelectorAll('[role="alert"]')].map((item) => item.textContent),
      noteStatus: [...document.querySelectorAll(".save-status")].map((item) => item.textContent),
      body: document.body.innerText.slice(-600),
    })).catch((cause) => String(cause)));
    throw error;
  }
  desktop = await electron.launch({ args: ["."], env });
  const reopened = await desktop.firstWindow();
  await desktop.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setContentSize(1080, 760));
  await reopened.locator(".book-card").first().click();
  await reopened.getByRole("button", { name: "笔记", exact: true }).first().click();
  await reopened.getByRole("button", { name: /关闭前提交测试/ }).click();
  await expect(reopened.locator(".tiptap")).toContainText("这份草稿必须在窗口关闭前写入本机数据库。");
  await expect(reopened.locator("#page-1")).toHaveAttribute("data-render-ready", "true");
  await expect(reopened.locator(".pdf-scroll")).toHaveAttribute("data-workspace-ready", "true", { timeout: 15_000 });
  await reopened.locator("#page-1").evaluate((page) => page.scrollIntoView({ block: "start", inline: "center" }));
  const firstPage = (await reopened.locator("#page-1").boundingBox());
  expect(firstPage).toBeTruthy();
  await reopened.getByRole("button", { name: "添加形状" }).click();
  await reopened.getByRole("menuitem", { name: "矩形" }).click();
  await expect(reopened.getByRole("button", { name: "添加形状" })).toHaveAttribute("aria-pressed", "true");
  expect(await reopened.evaluate(({ x, y }) => Boolean(document.elementFromPoint(x, y)?.closest("#page-1")),
    { x: firstPage.x + 80, y: firstPage.y + 180 })).toBe(true);
  blocker = new DatabaseSync(join(directory, "library.sqlite"));
  blocker.exec("BEGIN IMMEDIATE");
  await reopened.mouse.move(firstPage.x + 80, firstPage.y + 180);
  await reopened.mouse.down();
  await reopened.mouse.move(firstPage.x + 190, firstPage.y + 250, { steps: 5 });
  await reopened.mouse.up();
  await expect(reopened.locator('[data-object-id]')).toHaveCount(1);
  await desktop.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].close());
  await expect(reopened.getByText(/关闭前保存失败，窗口和草稿已保留/)).toBeVisible({ timeout: 12000 });
  expect(await reopened.evaluate(() => document.body.inert)).toBe(false);
  expect((await (await reopened.request.get(`http://127.0.0.1:${new URL(reopened.url()).port}/api/books/${bookId}/workspace`)).json()).objects).toHaveLength(0);
  blocker.exec("ROLLBACK");
  blocker.close();
  blocker = undefined;
  await desktop.evaluate(({ BrowserWindow }) => {
    const window = BrowserWindow.getAllWindows()[0];
    window.setContentSize(1080, 640);
    window.webContents.setZoomFactor(2);
  });
  expect(await reopened.evaluate(() => {
    const feedback = document.querySelector(".workspace-feedback");
    if (!feedback) return false;
    const style = getComputedStyle(feedback);
    return style.overflowY === "auto" && feedback.getBoundingClientRect().bottom <=
      document.querySelector(".reading").getBoundingClientRect().bottom;
  })).toBe(true);
  expect(await reopened.evaluate(() => {
    const feedback = document.querySelector(".workspace-feedback");
    const filler = document.createElement("div");
    filler.style.height = "600px";
    feedback.append(filler);
    const overflowed = feedback.scrollHeight > feedback.clientHeight;
    feedback.scrollTop = feedback.scrollHeight;
    const scrolled = feedback.scrollTop > 0;
    filler.remove();
    feedback.scrollTop = 0;
    return overflowed && scrolled;
  })).toBe(true);
  const retry = reopened.getByRole("button", { name: "重试保存" }).last();
  await retry.scrollIntoViewIfNeeded();
  expect(await retry.evaluate((button) => {
    const rect = button.getBoundingClientRect();
    return document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2)?.closest("button") === button;
  })).toBe(true);
  await retry.click();
  await expect.poll(async () => reopened.evaluate(async (id) =>
    (await (await fetch(`/api/books/${id}/workspace`)).json()).objects.length, bookId)).toBe(1);
  await desktop.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].webContents.setZoomFactor(1));
  const workspaceClosed = desktop.waitForEvent("close", { timeout: 20000 });
  await desktop.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].close());
  await workspaceClosed;
  desktop = await electron.launch({ args: ["."], env });
  const finalWindow = await desktop.firstWindow();
  await finalWindow.locator(".book-card").first().click();
  await expect(finalWindow.locator('[data-object-id]')).toHaveCount(1);
  completed = true;
  console.log("Desktop close retained note and workspace drafts through real Core conflicts, retries, and reopen.");
} finally {
  if (blocker) { blocker.exec("ROLLBACK"); blocker.close(); }
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
