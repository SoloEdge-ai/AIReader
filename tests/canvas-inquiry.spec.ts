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
  await page.setViewportSize({ width: 1600, height: 1000 });
  await page.getByRole("button", { name: "问答", exact: true }).click();
  await chat.getByLabel("回答详情", { exact: true }).click();
  await chat.getByRole("button", { name: "保存为问题", exact: true }).click();
  await expect(chat.getByRole("button", { name: "问题已保存", exact: true })).toBeVisible();
  await expect(chat.getByLabel("当前探究问题", { exact: true })).toBeVisible();
  await chat.getByRole("button", { name: "收为结论版本", exact: true }).click();
  await expect(chat.getByRole("button", { name: "已收为结论", exact: true })).toBeVisible();
  await chat.getByRole("button", { name: "关闭问答浮窗" }).click();
  const question = core.library.store.list<import("../packages/protocol/src").Note>("note", bookId).find((note) => note.question)!;
  const questionCard = new Workspaces(core.library).get(bookId).cards.find((card) => card.noteId === question.id)!;
  const questionView = page.locator(`[data-card-id="${questionCard.id}"]`);
  await questionView.getByRole("button", { name: "问题状态与结论", exact: true }).click();
  const settings = page.getByRole("dialog", { name: "问题状态与结论", exact: true });
  await settings.getByLabel("当前结论", { exact: true }).selectOption(question.question!.conclusionNoteIds[0]);
  await expect.poll(() => core.library.store.get<import("../packages/protocol/src").Note>("note", question.id)?.question?.currentConclusionId)
    .toBe(question.question!.conclusionNoteIds[0]);
  await settings.getByLabel("问题状态", { exact: true }).selectOption("concluded");
  await expect(questionView.getByText("问题 · 已有结论", { exact: true })).toBeVisible();
  await page.keyboard.press("Escape");
  await questionView.getByRole("button", { name: "继续探究", exact: true }).click();
  await expect(chat).toBeVisible();
  await expect(chat.locator(".turn")).toHaveCount(1);
  await chat.getByLabel("回答详情", { exact: true }).click();
  await chat.getByRole("button", { name: "沿用本轮冻结材料", exact: true }).click();
  await expect(chat.getByText("本轮材料 · 2 项", { exact: true })).toBeVisible();
  await expect(chat.locator(".composer-scope-trigger")).toContainText("仅所选材料");
  await chat.getByRole("textbox", { name: "问题", exact: true }).fill("进一步比较这些材料");
  await chat.getByRole("button", { name: "发送问题" }).click();
  await expect(chat.locator(".turn")).toHaveCount(2);
  await expect(chat.getByRole("button", { name: "保存到此处", exact: true })).toBeEnabled();
  await chat.locator(".turn").last().getByLabel("回答详情", { exact: true }).click();
  await chat.locator(".turn").last().getByRole("button", { name: "保存为问题", exact: true }).click();
  const anotherQuestion = core.library.store.list<import("../packages/protocol/src").Note>("note", bookId)
    .find((note) => note.question && note.id !== question.id)!;
  const anotherCard = new Workspaces(core.library).get(bookId).cards.find((card) => card.noteId === anotherQuestion.id)!;
  await chat.getByRole("button", { name: "关闭问答浮窗" }).click();
  await page.locator(`[data-card-id="${anotherCard.id}"]`).getByRole("button", { name: "继续探究", exact: true }).click();
  await expect(chat.getByLabel("当前探究问题", { exact: true })).toHaveValue(anotherQuestion.id);
  await expect(chat.locator(".turn")).toHaveCount(2);
  await chat.getByRole("button", { name: "关闭问答浮窗", exact: true }).click();
  await page.getByRole("button", { name: "问答", exact: true }).click();
  await expect(chat.getByLabel("当前探究问题", { exact: true })).toHaveValue(anotherQuestion.id);
  await page.reload();
  await page.locator(".book-card").filter({ hasText: "Canvas inquiry fixture" }).click();
  await expect(page.locator(`[data-card-id="${questionCard.id}"]`).getByText("问题 · 已有结论", { exact: true })).toBeVisible();
  expect(errors).toEqual([]);
});

test("create a blank question with a personal summary and continue without sending", async ({ page }) => {
  await page.setViewportSize({ width: 1600, height: 1000 });
  await page.goto("http://127.0.0.1:5173/");
  await page.locator(".book-card").filter({ hasText: "Canvas inquiry fixture" }).click();
  await page.getByRole("button", { name: /^工作区操作/ }).click();
  await page.getByRole("menuitem", { name: "新建问题", exact: true }).click();
  await page.getByRole("textbox", { name: "笔记标题", exact: true }).fill("独立的新问题");
  await page.getByRole("textbox", { name: "笔记正文", exact: true }).fill("我的个人总结保持独立。");
  await expect(page.locator(".expanded-note-footer [role=status]")).toHaveText("已保存");
  await page.getByRole("button", { name: "关闭笔记浮窗", exact: true }).click();
  const question = core.library.store.list<import("../packages/protocol/src").Note>("note", bookId)
    .find((note) => note.title === "独立的新问题")!;
  const card = new Workspaces(core.library).get(bookId).cards.find((card) => card.noteId === question.id)!;
  await page.locator(`[data-card-id="${card.id}"]`).getByRole("button", { name: "继续探究", exact: true }).click();
  const chat = page.getByLabel("AI 问答浮窗");
  await expect(chat.getByLabel("当前探究问题", { exact: true })).toHaveValue(question.id);
  await expect(chat.getByRole("textbox", { name: "问题", exact: true })).toHaveValue("独立的新问题");
  await expect(chat.locator(".turn")).toHaveCount(0);
  await expect(chat.getByLabel("待加入材料", { exact: true })).toHaveCount(0);
  await page.screenshot({ path: "test-results/question-card-continuation.png" });
  await chat.getByRole("button", { name: "会话操作", exact: true }).click();
  await page.getByRole("button", { name: "新建会话", exact: true }).click();
  await expect(chat.getByLabel("当前探究问题", { exact: true })).toHaveCount(0);
  const manualSession = await page.evaluate((id) => localStorage.getItem(`session-${id}`), bookId);
  expect(manualSession).not.toBe(question.question!.sessionId);
  await chat.getByRole("button", { name: "关闭问答浮窗", exact: true }).click();
  await page.getByRole("button", { name: "问答", exact: true }).click();
  await expect(chat.getByLabel("当前探究问题", { exact: true })).toHaveCount(0);
  await expect.poll(() => page.evaluate((id) => localStorage.getItem(`session-${id}`), bookId)).toBe(manualSession);
});
