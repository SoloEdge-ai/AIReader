import { _electron as electron, chromium, expect } from "@playwright/test";
import { spawn } from "node:child_process";
import { resolve } from "node:path";
import { mkdir, writeFile } from "node:fs/promises";
import { PDFDocument, StandardFonts } from "pdf-lib";
await mkdir(".local/screenshots", { recursive: true });
const fixture = resolve(".local/desktop-fixture.pdf");
const pdf = await PDFDocument.create();
const font = await pdf.embedFont(StandardFonts.Helvetica);
pdf
  .addPage()
  .drawText("AIReader portable startup and source indexing fixture.", {
    font,
    x: 30,
    y: 700,
  });
await writeFile(fixture, await pdf.save());
const env = {
  ...process.env,
  ELECTRON_RUN_AS_NODE: undefined,
  AIREADER_DATA:
    process.env.AIREADER_SMOKE_USE_DEFAULT === "1"
      ? undefined
      : resolve(process.env.AIREADER_SMOKE_DATA ?? ".local/desktop-library"),
};
const portable = process.argv[2]?.includes("Portable-");
let app;
let browser;
let portableProcess;
if (portable) {
  // NSIS forwards command-line flags but not the inspector pipe Electron.launch expects.
  portableProcess = spawn(
    resolve(process.argv[2]),
    ["--remote-debugging-port=9337"],
    {
      env,
      windowsHide: true,
      stdio: "ignore",
    },
  );
  let connected = false;
  for (let attempt = 0; attempt < 90; attempt++) {
    if (portableProcess.exitCode !== null)
      throw new Error(`Portable exited: ${portableProcess.exitCode}`);
    try {
      const response = await fetch("http://127.0.0.1:9337/json/version");
      if (response.ok) {
        connected = true;
        break;
      }
    } catch {}
    await new Promise((done) => setTimeout(done, 1000));
  }
  if (!connected) {
    portableProcess.kill();
    throw new Error("Portable did not expose its test endpoint");
  }
  browser = await chromium.connectOverCDP("http://127.0.0.1:9337");
} else {
  app = await electron.launch({
    args: process.argv[2]?.endsWith(".exe") ? [] : [process.argv[2] ?? "."],
    executablePath: process.argv[2]?.endsWith(".exe")
      ? resolve(process.argv[2])
      : undefined,
    env,
  });
}
try {
  const page = app
    ? await app.firstWindow()
    : (browser.contexts()[0].pages()[0] ??
      (await browser.contexts()[0].waitForEvent("page")));
  await page
    .getByRole("heading", { name: "书库", exact: true })
    .waitFor({ timeout: 15000 });
  if (process.env.AIREADER_EXPECT_EXISTING === "1") {
    await expect(page.locator(".book-card")).toHaveCount(1);
    await page.locator(".book-card").click();
    if (!(await page.locator(".notes-panel").isVisible()))
      await page.getByLabel("笔记", { exact: true }).click();
    await page.getByRole("button", { name: /Installer continuity note/ }).click();
    await expect(page.locator(".tiptap")).toContainText(
      "Note retained through installer update.",
    );
    await page.getByRole("button", { name: "返回书库" }).click();
  }
  await page
    .locator("input[type=file]")
    .setInputFiles(process.argv[3] ?? fixture);
  await page.locator(".textLayer span").first().waitFor({ timeout: 20000 });
  await page.locator('[data-book-status="ready"]').waitFor({ timeout: 30000 });
  if (process.env.AIREADER_CREATE_NOTE === "1") {
    await page.getByLabel("笔记", { exact: true }).click();
    await page.getByRole("button", { name: "新建笔记" }).click();
    await page
      .getByLabel("笔记标题", { exact: true })
      .fill("Installer continuity note");
    await page.locator(".tiptap").fill("Note retained through installer update.");
    await expect(page.getByText("已保存", { exact: true })).toBeVisible();
  }
  await page.screenshot({ path: ".local/screenshots/desktop.png" });
  if (!(await page.locator(".side-panel").isVisible()))
    await page.getByRole("button", { name: "问答", exact: true }).click();
  await page.locator(".side-panel").waitFor();
  await page.getByRole("button", { name: "收起侧栏" }).click();
  await page.getByRole("button", { name: "设置", exact: true }).click();
  await page.getByLabel("主题", { exact: true }).selectOption("dark");
  await page.getByRole("button", { name: "关闭设置" }).click();
  await page.screenshot({ path: ".local/screenshots/desktop-dark.png" });
  await page.getByRole("button", { name: "设置", exact: true }).click();
  await page.getByLabel("主题", { exact: true }).selectOption("light");
  await page.getByRole("button", { name: "关闭设置" }).click();
  console.log(
    JSON.stringify({
      title: await page.title(),
      pages: await page.locator(".pdf-page").count(),
    }),
  );
} finally {
  if (app) await app.close();
  if (browser) {
    const session = await browser.newBrowserCDPSession();
    await session.send("Browser.close").catch(() => {});
    await browser.close();
  }
}
