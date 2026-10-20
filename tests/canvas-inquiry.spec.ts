import { test, expect } from "@playwright/test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { PDFDocument } from "pdf-lib";
import { createCore } from "../apps/core/src/server";
import { Workspaces } from "../apps/core/src/workspace";
import { Preferences } from "../apps/core/src/preferences";

let directory: string, bookId: string;
let core: ReturnType<typeof createCore>;
test.beforeAll(async () => {
  directory = await mkdtemp(join(tmpdir(), "aireader-inquiry-ui-"));
  core = createCore(directory, resolve("dist/web"), { path: process.execPath, version: "fixture",
    args: [resolve("tests/fixtures/fake-codex.mjs")] });
  const pdf = await PDFDocument.create();
  for (const sentence of ["Ideal conditions improve throughput.", "Resource limits reduce throughput."]) {
    pdf.addPage([500, 700]).drawText(sentence, { x: 40, y: 620, size: 12 });
  }
  const book = await core.library.import(Buffer.from(await pdf.save()), "Canvas inquiry fixture.pdf");
  bookId = book.id;
  await core.library.waitForBook(bookId);
  new Preferences(core.library).saveForBook(bookId, { deskLayout: "adjacent", splitRatio: .3 });
  const workspaces = new Workspaces(core.library);
  workspaces.save(bookId, { ...workspaces.get(bookId), cards: [
    { id: "first", kind: "excerpt", title: "理想条件", text: "Ideal conditions improve throughput.", comment: "",
      x: 30, y: 100, width: 250, height: 160,
      source: { fingerprint: book.fingerprint, anchors: [{ page: 1, rects: [[35, 610, 450, 640]] }] } },
    { id: "second", kind: "excerpt", title: "受限条件", text: "Resource limits reduce throughput.", comment: "",
      x: 310, y: 100, width: 250, height: 160,
      source: { fingerprint: book.fingerprint, anchors: [{ page: 2, rects: [[35, 610, 450, 640]] }] } },
  ] });
  await new Promise<void>((done) => core.server.listen(43120, "127.0.0.1", done));
  const origin = "http://127.0.0.1:43120";
  const cookie = (await fetch(origin + "/api/session", { method: "POST", headers: { Origin: origin } }))
    .headers.get("set-cookie")!.split(";")[0];
  const connected = await fetch(origin + "/api/ai/connect", { method: "POST", headers: { Origin: origin, Cookie: cookie } });
  expect(connected.ok).toBe(true);
  const model = await fetch(origin + "/api/ai/selection", { method: "POST", headers: { Origin: origin, Cookie: cookie },
    body: JSON.stringify({ model: "fixture-a", effort: "medium" }) });
  expect(model.ok).toBe(true);
});
test.afterAll(async () => {
  await core?.shutdown();
  if (directory) await rm(directory, { recursive: true, force: true });
});

test("compare selected materials, keep a draft, save next to evidence and reopen", async ({ page }) => {
  await page.setViewportSize({ width: 1600, height: 1000 });
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("http://127.0.0.1:5173/");
  await page.locator(".book-card").filter({ hasText: "Canvas inquiry fixture" }).click();
  const chat = page.getByLabel("AI 问答浮窗");
  if (!(await chat.isVisible())) await page.getByRole("button", { name: "问答", exact: true }).click();
  await expect(chat.getByRole("textbox", { name: "问题", exact: true })).toBeEnabled();
  await chat.getByRole("textbox", { name: "问题", exact: true }).fill("保留我的问题");
  await chat.getByRole("button", { name: "关闭问答浮窗" }).click();
  const first = page.locator('[data-card-id="first"]'), second = page.locator('[data-card-id="second"]');
  await first.click(); await second.click({ modifiers: ["Shift"] });
  await page.getByRole("button", { name: "问 AI", exact: true }).click();
  await page.getByRole("button", { name: "比较观点与条件" }).click();
  await expect(chat).toBeVisible();
  await expect(chat.getByRole("textbox", { name: "问题", exact: true })).toHaveValue("保留我的问题");
  await expect(chat.getByRole("button", { name: "发送问题" })).toBeDisabled();
  await chat.getByRole("button", { name: "追加此问题" }).click();
  await expect(chat.getByRole("textbox", { name: "问题", exact: true })).toHaveValue(/保留我的问题[\s\S]*观点是否一致/);
  await chat.getByRole("button", { name: "加入本轮问题" }).click();
  await expect(chat.getByText("本轮材料 · 2 项", { exact: true })).toBeVisible();
  await expect(chat.getByRole("button", { name: "发送问题" })).toBeEnabled();
  await expect(chat.locator(".composer-scope-trigger")).toContainText("仅所选材料");
  await chat.getByRole("button", { name: "发送问题" }).click();
  await expect(chat.getByRole("button", { name: "保存到此处" })).toBeEnabled();
  await chat.getByRole("button", { name: "保存到此处" }).click();
  await expect(chat.getByRole("button", { name: "查看卡片" })).toBeVisible();
  expect(core.library.store.list("note", bookId)).toHaveLength(1);
  const board = new Workspaces(core.library).get(bookId);
  const answer = board.cards.find((card) => card.kind === "note")!;
  expect(answer.x).toBeGreaterThan(560);
  await page.screenshot({ path: "test-results/canvas-inquiry-saved.png" });
  await chat.getByRole("button", { name: "查看卡片" }).click();
  await chat.getByRole("button", { name: "关闭问答浮窗" }).click();
  const resultCard = page.locator(`[data-card-id="${answer.id}"]`);
  await expect(resultCard.getByText("使用材料 · 2 项")).toBeVisible();
  await expect(page.locator('[data-kind="material-use"]')).toHaveCount(2);
  await page.reload();
  await page.locator(".book-card").filter({ hasText: "Canvas inquiry fixture" }).click();
  await expect(page.locator(`[data-card-id="${answer.id}"]`)).toBeVisible();
  await page.setViewportSize({ width: 760, height: 760 });
  await page.getByRole("tab", { name: "工作台", exact: true }).click();
  await expect(page.getByRole("region", { name: "工作台", exact: true })).toBeVisible();
  expect(errors).toEqual([]);
});
