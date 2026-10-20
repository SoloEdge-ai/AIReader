import { test, expect } from "@playwright/test";
import { createHash, randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { PDFDocument } from "pdf-lib";
import { createCore } from "../apps/core/src/server";
import { Preferences } from "../apps/core/src/preferences";
import { bookCommandPayload, type BookChange, type BookCommandReceipt } from "../packages/protocol/src/book-commands";
import type { Book, ChatTurn, Note, QuestionMaterialSnapshot } from "../packages/protocol/src";
import type { BookWorkspace } from "../packages/protocol/src/workspace";

let directory: string, core: ReturnType<typeof createCore>, cookie: string;
let book: Book, other: Book, question: Note, otherQuestion: Note, personal: Note, conclusion: Note;
const origin = "http://127.0.0.1:43120";
async function request<T>(path: string, body?: unknown): Promise<T> {
  const response = await fetch(`${origin}/api/${path}`, { method: body === undefined ? "GET" : "POST",
    headers: { Origin: origin, Cookie: cookie }, body: body === undefined ? undefined : JSON.stringify(body) });
  expect(response.ok, await response.clone().text()).toBe(true); return response.json();
}
async function execute(bookId: string, changes: BookChange[]) {
  const payload = { bookId, expectedContentVersion: (await request<BookWorkspace>(`books/${bookId}/workspace`)).revision, changes };
  return request<BookCommandReceipt>(`v2/books/${bookId}/commands`, { ...payload, commandId: randomUUID(),
    payloadHash: createHash("sha256").update(bookCommandPayload(payload)).digest("hex") });
}
const richDocument = (text: string) => ({ type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text }] }] });
const placement = (id: string) => ({ id, x: 30, y: 120, width: 340, height: 240 });
test.beforeAll(async () => {
  directory = await mkdtemp(join(tmpdir(), "aireader-review-ui-"));
  core = createCore(directory, resolve("dist/web"), { path: process.execPath, version: "fixture", args: [resolve("tests/fixtures/fake-codex.mjs")] });
  const pdf = await PDFDocument.create(); pdf.addPage([500, 700]).drawText("Review source evidence.", { x: 40, y: 620 });
  book = await core.library.import(Buffer.from(await pdf.save()), "Review materials fixture.pdf");
  await core.library.waitForBook(book.id);
  pdf.addPage([500, 700]).drawText("Another book has different evidence.");
  other = await core.library.import(Buffer.from(await pdf.save()), "Other research fixture.pdf");
  await core.library.waitForBook(other.id);
  for (const item of [book, other]) new Preferences(core.library).saveForBook(item.id, { deskLayout: "adjacent", splitRatio: .3 });
  await new Promise<void>((done) => core.server.listen(43120, "127.0.0.1", done));
  cookie = (await fetch(origin + "/api/session", { method: "POST", headers: { Origin: origin } })).headers.get("set-cookie")!.split(";")[0];
  await request("ai/connect", {}); await request("ai/selection", { model: "fixture-a", effort: "medium" });
  question = (await execute(book.id, [{ type: "create-question", title: "材料是否仍支持结论？", placement: placement("q") }])).noteChanges[0].after;
  personal = (await execute(book.id, [{ type: "create-note", title: "个人依据", document: richDocument("INITIAL_PERSONAL"),
    placement: { ...placement("personal"), x: 400 } }])).noteChanges[0].after;
  const excerpt = (id: string, x: number) => ({ id, kind: "excerpt" as const, title: id, text: "Review source evidence.", comment: "",
    x, y: 450, width: 260, height: 160, source: { fingerprint: book.fingerprint, anchors: [{ page: 1, rects: [[35, 610, 450, 640] as [number, number, number, number]] }] } });
  await execute(book.id, [{ type: "workspace", changes: ["original", "missing", "added"].map((id, i) => ({ type: "upsert-card" as const, card: excerpt(id, 30 + 290 * i) })) }]);
  const material = await request<QuestionMaterialSnapshot>(`books/${book.id}/question-materials`, { bookId: book.id, sessionId: question.question!.sessionId,
    requestId: "ui-baseline", workspaceRevision: (await request<BookWorkspace>(`books/${book.id}/workspace`)).revision,
    targets: [{ kind: "card", id: "personal", revision: personal.revision }, { kind: "card", id: "original" }, { kind: "card", id: "missing" }], previews: [] });
  const turn = await request<ChatTurn>(`books/${book.id}/turns`, { question: "NOTES_NO_SOURCE", questionId: question.id,
    sessionId: question.question!.sessionId, reading: { bookId: book.id, page: 1, scope: "materials" }, materialIds: [material.id], model: "fixture-a", effort: "medium" });
  await expect.poll(() => core.library.chat.turn(book.id, turn.id)?.status).toBe("complete");
  const saved = await execute(book.id, [{ type: "save-answer", turnId: turn.id, questionId: question.id, placement: { ...placement("conclusion"), x: 720 } }]);
  question = saved.noteChanges.find((item) => item.after.id === question.id)!.after;
  conclusion = saved.noteChanges.find((item) => item.after.origin)!.after;
  question = (await execute(book.id, [{ type: "update-question", noteId: question.id, expectedRevision: question.revision, status: "concluded", currentConclusionId: conclusion.id }])).noteChanges[0].after;
  personal = (await execute(book.id, [{ type: "update-note", noteId: personal.id, expectedRevision: personal.revision, title: personal.title,
    document: richDocument("LATEST_PERSONAL") }, { type: "workspace", changes: [{ type: "delete-card", id: "missing" }] }])).noteChanges.find((item) => item.after.id === personal.id)!.after;
  otherQuestion = (await execute(other.id, [{ type: "create-question", title: "另一书的独立问题", placement: placement("other-q") }])).noteChanges[0].after;
  const otherBoard = await request<BookWorkspace>(`books/${other.id}/workspace`);
  await execute(other.id, [{ type: "workspace", changes: [{ type: "upsert-card", card: { ...otherBoard.cards[0], placed: false } }] }]);
});
test.afterAll(async () => { await core?.shutdown(); if (directory) await rm(directory, { recursive: true, force: true }); });

test("review exact frozen versions, preserve a draft, then send only after confirmation", async ({ page }) => {
  await page.setViewportSize({ width: 1600, height: 1000 });
  const errors: string[] = []; page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("http://127.0.0.1:5173/");
  await page.locator(".book-card").filter({ hasText: "Review materials fixture" }).click();
  const chat = page.getByLabel("AI 问答浮窗");
  if (await chat.isVisible()) await chat.getByRole("button", { name: "关闭问答浮窗" }).click();
  await page.getByRole("button", { name: "问题导航", exact: true }).click();
  let navigator = page.getByLabel("全局问题导航", { exact: true });
  await navigator.getByLabel("筛选问题状态").selectOption("all");
  await navigator.locator(`[data-question-id="${question.id}"]`).getByRole("button", { name: "继续探究", exact: true }).click();
  await expect(chat.getByLabel("当前探究问题", { exact: true })).toHaveValue(question.id);
  await chat.getByRole("textbox", { name: "问题", exact: true }).fill("CHECK_MATERIAL 保留我刚写的续问");
  await chat.getByRole("button", { name: "关闭问答浮窗" }).click();
  await page.locator('[data-card-id="added"]').click();
  await page.getByRole("button", { name: "问题导航", exact: true }).click();
  navigator = page.getByLabel("全局问题导航", { exact: true });
  await navigator.locator(`[data-question-id="${question.id}"]`).getByRole("button", { name: "检查材料更新", exact: true }).click();
  const review = page.getByLabel("材料更新差异清单", { exact: true });
  await expect(review).toBeVisible();
  await review.getByRole("button", { name: "纳入当前画布选择 · 1", exact: true }).click();
  await review.getByRole("button", { name: /^冻结最新材料并生成差异/ }).click();
  await expect(review.locator('[data-material-status="updated"]')).toHaveCount(1);
  await expect(review.locator('[data-material-status="unchanged"]')).toHaveCount(1);
  await expect(review.locator('[data-material-status="missing"]')).toHaveCount(1);
  await expect(review.locator('[data-material-status="added"]')).toHaveCount(1);
  await review.locator('[data-material-status="updated"] summary').click();
  await expect(review.getByText("INITIAL_PERSONAL", { exact: true })).toBeVisible();
  await expect(review.getByText("LATEST_PERSONAL", { exact: true })).toBeVisible();
  await page.screenshot({ path: "test-results/material-review-light.png" });
  personal = (await execute(book.id, [{ type: "update-note", noteId: personal.id, expectedRevision: personal.revision,
    title: personal.title, document: richDocument("CHANGED_AFTER_REVIEW") }])).noteChanges[0].after;
  await review.getByRole("button", { name: "替换为这批最新材料", exact: true }).click();
  await expect(review).toBeHidden();
  await expect(chat.getByRole("textbox", { name: "问题", exact: true })).toHaveValue("CHECK_MATERIAL 保留我刚写的续问");
  await expect(chat.getByText("本轮材料 · 3 项", { exact: true })).toBeVisible();
  await expect(chat.locator(".turn")).toHaveCount(1);
  await chat.getByRole("button", { name: "发送问题" }).click();
  await expect(chat.locator(".turn")).toHaveCount(2);
  await expect.poll(() => core.library.chat.turns(book.id).filter((turn) => turn.questionId === question.id && turn.status === "complete").length).toBe(2);
  const latest = core.library.chat.turns(book.id).at(-1)!;
  const prompt = Buffer.from(JSON.parse(latest.answer.split("Materials received: ")[1]).promptBase64, "base64").toString();
  expect(prompt).toContain("LATEST_PERSONAL"); expect(prompt).not.toContain("CHANGED_AFTER_REVIEW"); expect(prompt).not.toContain("INITIAL_PERSONAL");
  expect(core.library.store.get<Note>("note", conclusion.id)).toEqual(conclusion);
  expect(core.library.store.get<Note>("note", question.id)).toEqual(question);
  expect(errors).toEqual([]);
});

test("global navigation restores book/question/draft and saves an unplaced summary on switching books", async ({ page }) => {
  await page.setViewportSize({ width: 1600, height: 1000 });
  await page.goto("http://127.0.0.1:5173/");
  await page.getByRole("button", { name: "问题导航", exact: true }).click();
  let navigator = page.getByLabel("全局问题导航", { exact: true });
  await navigator.getByLabel("筛选问题状态").selectOption("all");
  await navigator.getByLabel("搜索问题").fill("材料是否");
  await expect(navigator.locator(".question-directory article")).toHaveCount(1);
  await navigator.getByRole("button", { name: "继续探究", exact: true }).click();
  const chat = page.getByLabel("AI 问答浮窗");
  await expect(chat.getByLabel("当前探究问题", { exact: true })).toHaveValue(question.id);
  await chat.getByRole("textbox", { name: "问题", exact: true }).fill("第一本书的未发送问题");
  await chat.getByRole("button", { name: "关闭问答浮窗" }).click();
  await page.getByRole("button", { name: "问题导航", exact: true }).click();
  navigator = page.getByLabel("全局问题导航", { exact: true });
  await navigator.getByLabel("问题所属书籍").selectOption("");
  await navigator.getByLabel("搜索问题").fill("");
  await expect(navigator.locator(`[data-question-id="${otherQuestion.id}"]`)).toContainText("未放置在画布");
  await navigator.locator(`[data-question-id="${otherQuestion.id}"]`).getByRole("button", { name: "查看问题", exact: true }).click();
  await expect(page.getByRole("textbox", { name: "笔记标题", exact: true })).toHaveValue(otherQuestion.title);
  await page.getByRole("textbox", { name: "笔记正文", exact: true }).fill("跨书跳转前必须保存我的总结。");
  await page.getByRole("button", { name: "问题导航", exact: true }).click();
  navigator = page.getByLabel("全局问题导航", { exact: true });
  await navigator.getByLabel("问题所属书籍").selectOption("");
  await navigator.getByLabel("筛选问题状态").selectOption("all");
  await navigator.locator(`[data-question-id="${question.id}"]`).getByRole("button", { name: "继续探究", exact: true }).click();
  await expect(chat.getByLabel("当前探究问题", { exact: true })).toHaveValue(question.id);
  await expect(chat.getByRole("textbox", { name: "问题", exact: true })).toHaveValue("第一本书的未发送问题");
  expect(JSON.stringify(core.library.store.get<Note>("note", otherQuestion.id)?.document)).toContain("跨书跳转前必须保存");
  expect((await request<BookWorkspace>(`books/${other.id}/workspace`)).cards[0].placed).toBe(false);
  await chat.getByRole("button", { name: "关闭问答浮窗" }).click();
  await page.reload();
  await page.getByRole("button", { name: "问题导航", exact: true }).click();
  navigator = page.getByLabel("全局问题导航", { exact: true });
  await expect(navigator.getByText(`上次探究 · ${question.title}`, { exact: true })).toBeVisible();
  await page.setViewportSize({ width: 760, height: 760 });
  await page.evaluate(() => { document.documentElement.dataset.theme = "dark"; });
  const header = navigator.getByLabel("拖动移动全局问题导航浮窗", { exact: true });
  await header.focus(); await page.keyboard.press("ArrowLeft");
  const bounds = await navigator.boundingBox(); expect(bounds!.x).toBeGreaterThanOrEqual(0); expect(bounds!.width).toBeLessThanOrEqual(760);
  await page.screenshot({ path: "test-results/question-navigation-dark-narrow.png" });
  await navigator.getByRole("button", { name: "继续上次问题", exact: true }).click();
  await expect(chat.getByLabel("当前探究问题", { exact: true })).toHaveValue(question.id);
});

test("global question navigation retains a dirty summary when Core cannot be reached", async ({ page }) => {
  await page.setViewportSize({ width: 1600, height: 1000 });
  await page.goto("http://127.0.0.1:5173/");
  await page.getByRole("button", { name: "问题导航", exact: true }).click();
  let navigator = page.getByLabel("全局问题导航", { exact: true });
  await navigator.locator(`[data-question-id="${otherQuestion.id}"]`).getByRole("button", { name: "查看问题", exact: true }).click();
  const editor = page.getByRole("textbox", { name: "笔记正文", exact: true });
  await expect(editor).toBeVisible();
  await page.getByRole("button", { name: "问题导航", exact: true }).click();
  navigator = page.getByLabel("全局问题导航", { exact: true });
  await navigator.getByLabel("问题所属书籍").selectOption("");
  await navigator.getByLabel("筛选问题状态").selectOption("all");
  const target = navigator.locator(`[data-question-id="${question.id}"]`).getByRole("button", { name: "继续探究", exact: true });
  await expect(target).toBeVisible();
  await page.context().setOffline(true);
  try {
    await editor.fill("断线时也必须保留的个人总结");
    await target.click();
    await expect(navigator.getByRole("alert")).toContainText("尚未保存");
    await expect(editor).toHaveText("断线时也必须保留的个人总结");
    await expect(page.locator(".toolbar strong")).toContainText(other.title);
  } finally { await page.context().setOffline(false); }
  await target.click();
  await expect(page.getByLabel("AI 问答浮窗").getByLabel("当前探究问题", { exact: true })).toHaveValue(question.id);
  expect(JSON.stringify(core.library.store.get<Note>("note", otherQuestion.id)?.document)).toContain("断线时也必须保留的个人总结");
});
