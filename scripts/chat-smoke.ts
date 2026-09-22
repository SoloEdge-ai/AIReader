import { chromium, expect } from "@playwright/test";
import { PDFDocument, StandardFonts } from "pdf-lib";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { createCore } from "../apps/core/src/server";

// The real renderer and Core; only the external Codex stdio process is substituted.
await mkdir(".local/screenshots", { recursive: true });
const data = await mkdtemp(resolve(".local/chat-acceptance-"));
const pdf = await PDFDocument.create();
const font = await pdf.embedFont(StandardFonts.Helvetica);
const pdfPage = pdf.addPage();
for (let line = 0; line < 40; line++)
  pdfPage.drawText(
    "Memory cache stores previous tokens and avoids repeated computation.",
    { font, size: 11, x: 35, y: 785 - line * 17 },
  );
const file = resolve(data, "fixture.pdf");
await writeFile(file, await pdf.save());
const core = createCore(data, resolve("dist/web"), {
  path: process.execPath,
  version: "fixture",
  args: [resolve("tests/fixtures/fake-codex.mjs")],
});
await new Promise<void>((resolve) =>
  core.server.listen(0, "127.0.0.1", resolve),
);
const address = core.server.address();
if (!address || typeof address === "string")
  throw new Error("Missing server address");
const base = `http://127.0.0.1:${address.port}`;
const browser = await chromium.launch({ channel: "msedge", headless: true });
try {
  const context = await browser.newContext({
    viewport: { width: 1440, height: 960 },
    permissions: ["clipboard-read", "clipboard-write"],
  });
  const page = await context.newPage();
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto(base);
  await page.locator("input[type=file]").setInputFiles(file);
  await page.locator('[data-book-status="ready"]').waitFor();
  await page.getByRole("button", { name: "问答", exact: true }).first().click();
  await expect(
    page.getByRole("button", { name: "模型与思考强度" }),
  ).toBeDisabled();
  await context.request.post(base + "/api/ai/connect", {
    headers: { Origin: base },
  });
  const picker = page.getByRole("button", { name: "模型与思考强度" });
  await expect(picker).toContainText("Fixture A", { timeout: 15000 });
  await picker.click();
  await page.getByRole("slider", { name: "思考强度" }).focus();
  await page.keyboard.press("ArrowLeft");
  await expect(picker).toContainText("中");
  await page.keyboard.press("Escape");
  await expect(picker).toBeFocused();
  const input = page.getByRole("textbox", { name: "问题", exact: true });
  await input.fill("中文输入中");
  await input.dispatchEvent("keydown", { key: "Enter", isComposing: true });
  await expect(page.locator(".turn")).toHaveCount(0);
  await input.press("Shift+Enter");
  await expect(input).toHaveValue("中文输入中\n");
  await page
    .locator("#page-1 .textLayer span")
    .first()
    .evaluate((element) => {
      const range = document.createRange();
      range.selectNodeContents(element);
      getSelection()!.removeAllRanges();
      getSelection()!.addRange(range);
      element.dispatchEvent(
        new MouseEvent("mouseup", {
          bubbles: true,
          clientX: 200,
          clientY: 200,
        }),
      );
    });
  await page
    .locator(".selection-bar")
    .getByRole("button", { name: "解释", exact: true })
    .click();
  await page
    .getByRole("textbox", { name: "问题", exact: true })
    .fill("Explain memory cache");
  await expect(page.locator(".selection-bar")).toHaveCount(0);
  const selectedQuestion = page.waitForRequest(
    (request) =>
      request.method() === "POST" &&
      /\/books\/[^/]+\/turns$/.test(new URL(request.url()).pathname),
  );
  await page.getByRole("button", { name: "发送问题", exact: true }).click();
  expect((await selectedQuestion).postDataJSON().reading).toMatchObject({
    scope: "selection",
    page: 1,
    selection:
      "Memory cache stores previous tokens and avoids repeated computation.",
  });
  await expect(page.locator(".turn .answer")).toContainText(
    "supported statement",
  );
  await expect(page.locator(".turn .answer")).toContainText("未验证引用");
  await expect(page.locator(".turn .citation")).toHaveCount(1);
  await page
    .getByRole("button", { name: "返回第 1 页原文", exact: true })
    .click();
  await page.getByText("回答详情", { exact: true }).click();
  await expect(page.locator(".answer-metadata")).toContainText(
    "fixture-a · 中",
  );
  await page.getByText("本轮上下文", { exact: true }).click();
  const positionAfterExpansion = await page
    .locator(".messages")
    .evaluate((node) => node.scrollTop);
  for (let poll = 0; poll < 2; poll++)
    await page.waitForResponse(
      (response) =>
        response.url().includes("/turns?session=") &&
        response.request().method() === "GET",
    );
  await page.evaluate(
    () =>
      new Promise((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(resolve)),
      ),
  );
  expect(
    await page.locator(".messages").evaluate((node) => node.scrollTop),
  ).toBe(positionAfterExpansion);
  await page.getByText("本轮上下文", { exact: true }).click();
  await page.getByRole("button", { name: "复制回答", exact: true }).click();
  await expect(
    page.getByRole("status").filter({ hasText: "已复制" }),
  ).toBeVisible();
  expect(await page.evaluate(() => navigator.clipboard.readText())).toContain(
    "〔第 1 页〕",
  );
  await page.getByRole("button", { name: "会话操作", exact: true }).click();
  await page.getByRole("button", { name: "重命名会话", exact: true }).click();
  await page
    .getByRole("textbox", { name: "会话名称", exact: true })
    .fill("缓存笔记");
  await page.getByRole("button", { name: "保存", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "历史会话", exact: true }),
  ).toContainText("缓存笔记");
  await page.getByRole("button", { name: "新建会话", exact: true }).click();
  await expect(page.locator(".turn")).toHaveCount(0);
  await page.getByRole("button", { name: "历史会话", exact: true }).click();
  await page.getByRole("button", { name: "缓存笔记", exact: true }).click();
  await expect(page.locator(".turn")).toHaveCount(1);
  await page
    .getByRole("textbox", { name: "问题", exact: true })
    .fill("WAIT memory");
  await page.getByRole("button", { name: "发送问题", exact: true }).click();
  await page.getByRole("button", { name: "停止回答", exact: true }).waitFor();
  await picker.click();
  await page.getByRole("radio", { name: "Fixture B", exact: true }).click();
  await expect(picker).toContainText("Fixture B");
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: "停止回答", exact: true }).click();
  await expect(page.getByText("已停止回答", { exact: true })).toBeVisible();
  const turns = page.locator(".turn");
  await turns.last().getByText("回答详情", { exact: true }).click();
  await expect(turns.last().locator(".answer-metadata")).toContainText(
    "fixture-a · 中",
  );
  await page.reload();
  await page.locator(".book-card").first().click();
  await page.locator(".textLayer span").first().waitFor();
  await expect(picker).toContainText("Fixture B");
  await expect(page.locator(".turn")).toHaveCount(2);
  await page.screenshot({
    path: ".local/screenshots/chat-integrated-light.png",
  });
  await page.evaluate(() => (document.documentElement.dataset.theme = "dark"));
  await picker.click();
  await page.screenshot({
    path: ".local/screenshots/chat-integrated-dark.png",
  });
  expect(errors).toEqual([]);
  console.log(
    "Chat HTTP/UI: signed-out, model paging/effort, validated citation, copy, rename/history, cancellation, frozen config and reload passed.",
  );
} finally {
  await browser.close();
  core.close();
}
