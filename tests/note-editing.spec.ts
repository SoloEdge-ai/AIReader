import { Preferences } from "../apps/core/src/preferences";
import { test, expect, type Page } from "@playwright/test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { PDFDocument } from "pdf-lib";
import { createCore } from "../apps/core/src/server";
import { Workspaces } from "../apps/core/src/workspace";
import type { ChatTurn } from "../packages/protocol/src/chat";
import type { Note } from "../packages/protocol/src/notes";

let core: ReturnType<typeof createCore>;
let directory: string;
let bookId: string;

async function closeFloatingChat(page: Page) {
  const toggle = page.getByRole("button", { name: "问答", exact: true }).first();
  const chat = page.getByLabel("AI 问答浮窗");
  await expect(toggle).toBeVisible();
  if ((await toggle.getAttribute("aria-pressed")) === "true") await toggle.click();
  else if (await chat.isVisible()) await chat.getByRole("button", { name: "关闭问答浮窗" }).click();
  await expect(chat).toBeHidden();
}

test.beforeAll(async () => {
  directory = await mkdtemp(join(tmpdir(), "aireader-note-session-"));
  core = createCore(directory, resolve("dist/web"));
  await new Promise<void>((done) => core.server.listen(43120, "127.0.0.1", done));
  const origin = "http://127.0.0.1:43120";
  const session = await fetch(origin + "/api/session", { method: "POST", headers: { Origin: origin } });
  const headers = { Origin: origin, Cookie: session.headers.get("set-cookie")!.split(";")[0] };
  const pdf = await PDFDocument.create(); pdf.addPage();
  const imported = await fetch(origin + "/api/books", { method: "POST", headers, body: Buffer.from(await pdf.save()) });
  bookId = (await imported.json()).id;
  await core.library.waitForBook(bookId);
  new Preferences(core.library).saveForBook(bookId, { deskLayout: "adjacent" });
  expect((await fetch(origin + `/api/books/${bookId}/notes`, { method: "POST", headers, body: "{}" })).status).toBe(201);
});
test.afterAll(async () => {
  core?.close();
  if (directory) await rm(directory, { recursive: true, force: true });
});

test("material navigation and chat remain visible beside the same PDF", async ({ page }) => {
  await page.goto("http://127.0.0.1:5173/");
  await page.locator(".book-card").first().click();
  await page.getByRole("button", { name: "笔记", exact: true }).first().click();
  await expect(page.locator(".navigation .notes-panel")).toBeVisible();
  const chatButton = page.getByRole("button", { name: "问答", exact: true }).first();
  if ((await chatButton.getAttribute("aria-pressed")) !== "true") await chatButton.click();
  await expect(page.locator(".navigation .notes-panel")).toBeVisible();
  await expect(page.locator(".floating-chat .chat")).toBeVisible();
  await expect(page.locator(".reading .pdf-page").first()).toBeVisible();
  await page.screenshot({ path: "test-results/materials-and-chat.png" });
  await page.evaluate(async (id) => {
    const url = `http://127.0.0.1:43120/api/books/${id}/preferences`;
    const previous = await (await fetch(url, { credentials: "include" })).json();
    await fetch(url, { method: "POST", credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...previous, navigation: false, panel: "notes" }) });
  }, bookId);
  await page.reload();
  await page.locator(".book-card").first().click();
  await expect(page.locator(".navigation .notes-panel")).toBeVisible();
  await expect(page.locator(".floating-chat .chat")).toBeVisible();
});

test("material navigation lists canvas cards and locates the selected placement", async ({ page }) => {
  await page.goto("http://127.0.0.1:5173/");
  await page.locator(".book-card").first().click();
  const notesButton = page.getByRole("button", { name: "笔记", exact: true }).first();
  if ((await notesButton.getAttribute("aria-pressed")) !== "true") await notesButton.click();
  await page.locator(".notes-list button").first().click();
  await page.getByRole("button", { name: "放到画布" }).click();
  await expect(page.locator(".workspace-card")).toHaveCount(1);
  const catalog = page.getByRole("region", { name: "本书材料" });
  await expect(catalog.getByRole("button", { name: /定位.*卡片/ })).toHaveCount(1);
  await catalog.getByRole("button", { name: /定位.*卡片/ }).click();
  await expect(page.locator(".workspace-card.selected")).toHaveCount(1);
  await page.route("**/api/books/*/question-materials", (route) => route.fulfill({ status: 503,
    json: { error: "暂时无法加入" } }));
  await catalog.getByRole("button", { name: /加入提问/ }).click();
  await expect(catalog.getByRole("alert")).toContainText("画布材料尚未准备好");
  await page.unroute("**/api/books/*/question-materials");
  await catalog.getByRole("button", { name: /加入提问/ }).click();
  await expect(page.locator(".floating-chat .question-material-list .question-material-item"))
    .toHaveCount(1);
  await page.reload();
  await page.locator(".book-card").first().click();
  await page.locator(".nav-tabs").getByRole("button", { name: "材料" }).click();
  await expect(page.getByRole("region", { name: "本书材料" })
    .getByRole("button", { name: /定位.*卡片/ })).toHaveCount(1);
});

test("narrow reader keeps materials and floating chat available together", async ({ page }) => {
  await page.setViewportSize({ width: 900, height: 720 });
  await page.goto("http://127.0.0.1:5173/");
  await page.locator(".book-card").first().click();
  const notesButton = page.getByRole("button", { name: "笔记", exact: true }).first();
  if ((await notesButton.getAttribute("aria-pressed")) !== "true") await notesButton.click();
  await expect(page.locator(".navigation .notes-panel")).toBeVisible();
  const chatButton = page.getByRole("button", { name: "问答", exact: true }).first();
  if ((await chatButton.getAttribute("aria-pressed")) !== "true") await chatButton.click();
  await expect(page.locator(".navigation .notes-panel")).toBeVisible();
  await expect(page.locator(".floating-chat .chat")).toBeVisible();
});

test("left navigation width is draggable and persists per book", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("http://127.0.0.1:5173/");
  await page.locator(".book-card").first().click();
  const notesButton = page.getByRole("button", { name: "笔记", exact: true }).first();
  if ((await notesButton.getAttribute("aria-pressed")) !== "true") await notesButton.click();
  const navigation = page.locator(".navigation");
  const before = (await navigation.boundingBox())!.width;
  const divider = await page.getByRole("separator", { name: "调整导航宽度" }).boundingBox();
  const x = divider!.x + divider!.width / 2, y = divider!.y + divider!.height / 2;
  const dx = before > 270 ? -48 : 48;
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x + dx, y, { steps: 5 });
  await page.mouse.up();
  await expect.poll(async () => (await navigation.boundingBox())!.width).toBeGreaterThan(219);
  const changed = (await navigation.boundingBox())!.width;
  expect(Math.abs(changed - before)).toBeGreaterThan(25);
  await page.reload();
  await page.locator(".book-card").first().click();
  await expect.poll(async () => (await page.locator(".navigation").boundingBox())!.width)
    .toBe(changed);
  const separator = page.getByRole("separator", { name: "调整导航宽度" });
  await separator.focus();
  await separator.press("Home");
  await expect.poll(async () => (await page.locator(".navigation").boundingBox())!.width).toBe(220);
  await separator.press("End");
  await expect.poll(async () => (await page.locator(".navigation").boundingBox())!.width).toBe(320);
});

test("leaving material navigation keeps an unsaved note draft visible", async ({ page }) => {
  await page.goto("http://127.0.0.1:5173/");
  await page.locator(".book-card").first().click();
  await closeFloatingChat(page);
  const notesButton = page.getByRole("button", { name: "笔记", exact: true }).first();
  if ((await notesButton.getAttribute("aria-pressed")) !== "true") await notesButton.click();
  await page.locator(".notes-list button").first().click();
  await page.getByRole("button", { name: "展开编辑笔记" }).click();
  const expanded = page.getByRole("dialog", { name: "展开笔记编辑" });
  await page.route("**/api/v2/books/*/commands", (route) => route.request().method() === "POST"
    ? route.fulfill({ status: 503, json: { error: "暂时无法保存" } }) : route.continue());
  await expanded.getByRole("textbox", { name: "笔记正文" }).fill("切换导航前必须保留");
  await page.locator(".nav-tabs").getByRole("button", { name: "目录", exact: true }).click();
  await expect(page.locator(".nav-tabs").getByRole("button", { name: "材料" })).toHaveClass(/chosen/);
  await expect(page.locator(".notes-panel").getByRole("textbox", { name: "笔记正文" })).toHaveCount(0);
  await expect(page.locator(".notes-panel")).toContainText("切换导航前必须保留");
  await page.unroute("**/api/v2/books/*/commands");
  await expanded.getByRole("button", { name: "重试保存", exact: true }).click();
  await expect(expanded.getByRole("status")).toHaveText("已保存");
  await page.getByLabel("笔记浮窗", { exact: true }).getByRole("button", { name: "关闭笔记浮窗" }).click();
  await page.locator(".nav-tabs").getByRole("button", { name: "目录", exact: true }).click();
  await expect(page.locator(".nav-tabs").getByRole("button", { name: "目录", exact: true })).toHaveClass(/chosen/);
});

test("chat receives book-scoped events, recovers a missed final event and stops polling completed turns", async ({ page }) => {
  let turnReads = 0;
  page.on("request", (request) => {
    if (request.method() === "GET" && /\/books\/[^/]+\/turns\?session=/.test(request.url())) turnReads++;
  });
  await page.goto("http://127.0.0.1:5173/");
  await page.locator(".book-card").first().click();
  const chatToggle = page.getByRole("button", { name: "问答", exact: true }).first();
  if ((await chatToggle.getAttribute("aria-pressed")) !== "true") await chatToggle.click();
  await expect(page.locator(".chat")).toBeVisible();
  const session = await page.evaluate(async (id) => {
    const response = await fetch(`http://127.0.0.1:43120/api/books/${id}/sessions`, { credentials: "include" });
    return (await response.json() as { id: string }[])[0].id;
  }, bookId);
  await expect.poll(() => turnReads).toBeGreaterThan(0);
  const turn = {
    id: "stream-test-turn",
    bookId,
    sessionId: session,
    question: "事件同步测试",
    answer: "回答第一段",
    reasoning: "公开过程摘要",
    status: "running",
    createdAt: new Date().toISOString(),
    citations: [],
    tools: [],
    context: { reading: { bookId, page: 1, scope: "auto", selection: "" },
      estimatedTokens: 0, budget: 12000, coverage: "", evidence: [], memory: "", recent: "", navigation: "" },
  } as ChatTurn;
  core.library.store.put("turn", turn.id, bookId, turn);
  core.library.emit({ type: "turn", bookId, taskId: turn.id, data: turn });
  await expect(page.locator(".turn").filter({ hasText: "事件同步测试" })).toContainText("回答第一段");
  const updated = { ...turn, answer: "回答第一段，继续由事件更新", status: "complete" as const };
  core.library.store.put("turn", turn.id, bookId, updated);
  core.library.emit({ type: "turn", bookId, taskId: turn.id, data: updated });
  await expect(page.locator(".turn").filter({ hasText: "事件同步测试" })).toContainText("继续由事件更新");
  await page.waitForTimeout(400);
  const readsAfterCompletion = turnReads;
  await page.waitForTimeout(2200);
  expect(turnReads).toBe(readsAfterCompletion);
  const lostFinal = { ...turn, id: "lost-final-event", question: "丢失终态测试", answer: "" };
  core.library.store.put("turn", lostFinal.id, bookId, lostFinal);
  core.library.emit({ type: "turn", bookId, taskId: lostFinal.id, data: lostFinal });
  await expect(page.locator(".turn").filter({ hasText: "丢失终态测试" }))
    .toContainText("正在等待模型回答");
  core.library.store.put("turn", lostFinal.id, bookId,
    { ...lostFinal, answer: "轮询补读成功", status: "complete" });
  await expect(page.locator(".turn").filter({ hasText: "丢失终态测试" }))
    .toContainText("轮询补读成功", { timeout: 7000 });
  await page.context().setOffline(true);
  await page.waitForTimeout(500);
  const missed = { ...updated, answer: "断线期间保存的最终答案" };
  core.library.store.put("turn", turn.id, bookId, missed);
  await page.context().setOffline(false);
  await expect(page.locator(".turn").filter({ hasText: "事件同步测试" }))
    .toContainText("断线期间保存的最终答案", { timeout: 12_000 });
  const closed = new Promise<void>((resolve) => core.server.once("close", resolve));
  core.close();
  await closed;
  core = createCore(directory, resolve("dist/web"));
  await new Promise<void>((done) => core.server.listen(43120, "127.0.0.1", done));
  const afterRestart = { ...missed, answer: "Core 重启后读回的答案" };
  core.library.store.put("turn", turn.id, bookId, afterRestart);
  await expect(page.locator(".turn").filter({ hasText: "事件同步测试" }))
    .toContainText("Core 重启后读回的答案", { timeout: 15_000 });
});

test("annotation comments are explicit and deleting either entity preserves the other", async ({ page }) => {
  await page.goto("http://127.0.0.1:5173/");
  await expect(page.locator(".book-card").first()).toBeVisible();
  const annotation = await page.evaluate(async (id) => {
    const response = await fetch(`http://127.0.0.1:43120/api/books/${id}/annotations`, { method: "POST", credentials: "include",
      headers: { "Content-Type": "application/json" }, body: JSON.stringify({ kind: "highlight",
        quote: "独立标注测试", anchors: [{ page: 1, rects: [[40, 50, 120, 70]] }] }) });
    return response.json();
  }, bookId);
  expect(annotation.noteId).toBeUndefined();
  await page.locator(".book-card").first().click();
  await closeFloatingChat(page);
  await page.getByLabel("笔记", { exact: true }).click();
  await page.locator(".notes-list button").filter({ hasText: "独立标注测试" }).click();
  await expect(page.getByRole("textbox", { name: "笔记正文" })).toHaveCount(0);
  const sourceNote = page.getByLabel("关联标记到笔记");
  const sourceNoteId = await sourceNote.locator("option").nth(1).getAttribute("value");
  expect(sourceNoteId).toBeTruthy();
  await sourceNote.selectOption(sourceNoteId!);
  await page.getByRole("button", { name: "关联到笔记" }).click();
  await expect.poll(async () => {
    const response = await page.request.get(`http://127.0.0.1:43120/api/books/${bookId}/notes`,
      { headers: { Origin: "http://127.0.0.1:43120" } });
    const notes = await response.json() as Note[];
    return notes.find((note) => note.id === sourceNoteId)?.sourceReferences
      .some((reference) => reference.kind === "annotation" && reference.targetId === annotation.id);
  }).toBe(true);
  await expect(page.locator(".workspace-source-focus")).toHaveCount(0);
  await page.getByRole("button", { name: "第 1 页原文 ↗" }).click();
  await expect(page.locator(".workspace-source-focus")).toHaveCount(1);
  await page.getByRole("button", { name: "写评论", exact: true }).click();
  const expanded = page.getByRole("dialog", { name: "展开笔记编辑" });
  await expanded.getByRole("textbox", { name: "笔记正文" }).fill("删除高亮也要保留的评论");
  await expect(expanded.getByRole("status")).toHaveText("已保存");
  let removed!: () => void, release!: () => void;
  const removedOnServer = new Promise<void>((resolve) => { removed = resolve; });
  const releaseResponse = new Promise<void>((resolve) => { release = resolve; });
  await page.route("**/api/books/*/annotations/*", async (route) => {
    if (route.request().method() !== "DELETE") return route.continue();
    const response = await route.fetch(); removed(); await releaseResponse;
    await route.fulfill({ response });
  });
  await page.route("**/api/v2/books/*/commands", (route) => route.request().method() === "POST"
    ? route.fulfill({ status: 503, json: { error: "保留并发草稿" } }) : route.continue());
  await page.getByRole("button", { name: "删除批注", exact: true }).click();
  await removedOnServer;
  await expanded.getByRole("textbox", { name: "笔记正文" }).fill("删除高亮也要保留的评论，并继续编辑");
  release();
  await expect(page.getByText("源标注已删除，以下保留原文位置与摘录。")).toBeVisible();
  await expect(expanded.getByRole("textbox", { name: "笔记正文" }))
    .toHaveText("删除高亮也要保留的评论，并继续编辑");
  await page.unroute("**/api/books/*/annotations/*");
  await expect(expanded.getByRole("status")).toContainText("保存失败");
  await page.unroute("**/api/v2/books/*/commands");
  await expanded.getByRole("button", { name: "重试保存", exact: true }).click();
  await expect(expanded.getByRole("status")).toHaveText("已保存");
  await page.screenshot({ path: "test-results/annotation-comment-source.png" });
  await page.getByLabel("笔记浮窗", { exact: true }).getByRole("button", { name: "关闭笔记浮窗" }).click();
  await page.getByRole("button", { name: "撤销批注操作" }).click();
  await page.getByRole("button", { name: "删除笔记", exact: true }).click();
  await expect(page.locator(".annotation-highlight")).toHaveCount(1);
  await page.locator(".notes-list button").filter({ hasText: "独立标注测试" }).click();
  await expect(page.getByRole("button", { name: "写评论", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "删除批注", exact: true }).click();
});

test("card and sidebar stay lightweight while the expanded editor owns the note", async ({ page }) => {
  const dialogs: string[] = [];
  page.on("dialog", async (dialog) => { dialogs.push(dialog.message()); await dialog.dismiss(); });
  await page.goto("http://127.0.0.1:5173/");
  await page.locator(".book-card").first().click();
  await closeFloatingChat(page);
  await expect(page.locator(".reader-body")).toBeVisible();
  if (!(await page.locator(".notes-panel").isVisible())) await page.getByLabel("笔记", { exact: true }).click();
  await page.locator(".notes-list button").first().click();
  await page.getByRole("button", { name: "放到画布", exact: true }).click();
  const card = page.locator(".workspace-card.note");
  const panel = page.locator(".notes-panel");
  await expect(card).toHaveCount(1);
  await expect(card.getByRole("textbox", { name: "笔记正文" })).toHaveCount(0);
  await expect(panel.getByRole("textbox", { name: "笔记正文" })).toHaveCount(0);
  await card.getByRole("button", { name: "展开卡片笔记" }).click();
  const expanded = page.getByRole("dialog", { name: "展开笔记编辑" });
  await expanded.getByLabel("笔记标题", { exact: true }).fill("唯一展开编辑器");
  await expanded.getByRole("textbox", { name: "笔记正文" }).fill("从展开层继续写作");
  await expect(card).toContainText("从展开层继续写作");
  await expect(panel).toContainText("从展开层继续写作");
  await expect(card).toContainText("唯一展开编辑器");
  await page.getByLabel("笔记浮窗", { exact: true }).getByRole("button", { name: "关闭笔记浮窗" }).click();
  await panel.getByRole("button", { name: "放到画布", exact: true }).click();
  await expect.poll(async () => ({ cards: await card.count(), dialogs })).toEqual({ cards: 1, dialogs: [] });
  await page.screenshot({ path: "test-results/shared-note-card.png" });
  await expect(panel).toContainText("从展开层继续写作");
  await card.getByRole("button", { name: "移出工作台，保留材料" }).click();
  await expect(card).toHaveCount(0);
  await expect(panel.getByRole("button", { name: "将唯一展开编辑器放回工作台" })).toBeVisible();
  await panel.getByRole("button", { name: "将唯一展开编辑器放回工作台" }).click();
  await expect(card).toHaveCount(1);
  await page.getByRole("button", { name: "返回书库" }).click();
  await expect(page.locator(".book-card").first()).toBeVisible();
});

test("replacing card text after a failed save never restores the previous draft", async ({ page }) => {
  await page.goto("http://127.0.0.1:5173/");
  await page.locator(".book-card").first().click();
  await closeFloatingChat(page);
  if (!(await page.locator(".notes-panel").isVisible()))
    await page.getByLabel("笔记", { exact: true }).click();
  const panel = page.locator(".notes-panel");
  await panel.getByRole("button", { name: "新建笔记", exact: true }).click();
  const expanded = page.getByRole("dialog", { name: "展开笔记编辑" });
  await expanded.getByLabel("笔记标题", { exact: true }).fill("卡片替换回归");
  const expandedEditor = expanded.getByRole("textbox", { name: "笔记正文" });
  await expandedEditor.fill("Initial saved content.");
  await expect(expanded.getByRole("status")).toHaveText("已保存");
  await page.route("**/api/v2/books/*/commands", (route) => route.request().method() === "POST"
    ? route.fulfill({ status: 503, json: { error: "Simulated save failure" } }) : route.continue());
  await expandedEditor.fill("Draft retained after failure.");
  await expect(expanded.getByRole("status")).toContainText("保存失败");
  await page.unroute("**/api/v2/books/*/commands");
  await expanded.getByRole("button", { name: "重试保存" }).click();
  await expect(expanded.getByRole("status")).toHaveText("已保存");
  await page.getByLabel("笔记浮窗", { exact: true }).getByRole("button", { name: "关闭笔记浮窗" }).click();
  await panel.getByRole("button", { name: "放到画布", exact: true }).click();
  const card = page.locator(".workspace-card.note").filter({ hasText: "卡片替换回归" });
  await expect(card).toHaveCount(1);
  await expect(card.getByRole("textbox", { name: "笔记正文" })).toHaveCount(0);
  await card.getByRole("button", { name: "展开卡片笔记" }).click();
  for (const replacement of ["The same note from its card.", "A second complete replacement."]) {
    await expandedEditor.fill(replacement);
    await expect(expandedEditor).toHaveText(replacement);
    await expect(card).toContainText(replacement);
    await expect(panel).toContainText(replacement);
    await expect(expanded.getByRole("status")).toHaveText("已保存");
  }
  const response = await page.request.get(`http://127.0.0.1:43120/api/books/${bookId}/notes`,
    { headers: { Origin: "http://127.0.0.1:43120" } });
  const saved = (await response.json() as { title: string; document: unknown }[])
    .find((note) => note.title === "卡片替换回归");
  expect(JSON.stringify(saved?.document)).toContain("A second complete replacement.");
  expect(JSON.stringify(saved?.document)).not.toContain("Draft retained after failure.");
  await panel.getByRole("button", { name: "删除笔记", exact: true }).click();
  await expect(card).toHaveCount(0);
});

test("excerpt keeps immutable source text beside its associated note", async ({ page }) => {
  const workspaces = new Workspaces(core.library);
  const snapshot = workspaces.get(bookId);
  const id = "ui-excerpt-comment";
  workspaces.save(bookId, { ...snapshot, cards: [...snapshot.cards, {
    id, kind: "excerpt", title: "原文卡片", text: "不可编辑的书中原文", comment: "",
    x: 80, y: 80, width: 320, height: 290,
    source: { fingerprint: core.library.book(bookId).fingerprint,
      anchors: [{ page: 1, rects: [[20, 30, 130, 60]] }] },
  }] });
  await page.goto("http://127.0.0.1:5173/");
  await page.locator(".book-card").first().click();
  await closeFloatingChat(page);
  const card = page.locator(`[data-card-id="${id}"]`);
  await card.scrollIntoViewIfNeeded();
  await expect(card).toContainText("不可编辑的书中原文");
  await expect(card).toContainText("尚无关联笔记");
  await card.click({ position: { x: 40, y: 36 } });
  await card.getByRole("button", { name: "写笔记" }).click();
  await expect(card).toContainText("不可编辑的书中原文");
  const expanded = page.getByRole("dialog", { name: "展开笔记编辑" });
  await expect(expanded.getByRole("textbox", { name: "笔记正文" })).toBeEmpty();
  await expanded.getByRole("textbox", { name: "笔记正文" }).fill("修改后的个人理解");
  await expect(expanded).toContainText("不可编辑的书中原文");
  await expect(card).toContainText("关联笔记 · 1");
  await expect(card).not.toContainText("修改后的个人理解");
  await page.getByLabel("笔记浮窗", { exact: true }).getByRole("button", { name: "关闭笔记浮窗" }).click();
  await expect(card).toContainText("不可编辑的书中原文");
  expect((await card.locator("blockquote").boundingBox())?.height).toBeGreaterThanOrEqual(24);
  await page.screenshot({ path: "test-results/excerpt-comment-note.png" });
  const panel = page.locator(".notes-panel");
  if (!(await panel.isVisible())) await page.getByLabel("笔记", { exact: true }).click();
  await panel.locator(".notes-list button").filter({ hasText: "原文卡片" }).last().click();
  await expect(panel).toContainText("不可编辑的书中原文");
  await expect(panel).toContainText("修改后的个人理解");
});

test("the tool handle drags across the real reader and keeps its dock on reopen", async ({ page }) => {
  await page.goto("http://127.0.0.1:5173/");
  await page.locator(".book-card").first().click();
  await expect(page.locator(".pdf-page").first()).toBeVisible();
  const reading = page.locator(".reading");
  const area = await reading.boundingBox();
  const grip = page.getByRole("button", { name: "拖动工具盘" });
  const box = await grip.boundingBox();
  expect(area).not.toBeNull();
  expect(box).not.toBeNull();
  await page.mouse.move(box!.x + box!.width / 2, box!.y + box!.height / 2);
  await page.mouse.down();
  await page.mouse.move(area!.x + 20, area!.y + area!.height / 2, { steps: 12 });
  await page.mouse.up();
  await expect(page.getByRole("toolbar", { name: "阅读工具盘" })).toHaveAttribute("data-dock", "left");
  await page.screenshot({ path: "test-results/palette-reader-left.png" });
  await page.getByRole("button", { name: "返回书库" }).click();
  await page.locator(".book-card").first().click();
  await expect(page.getByRole("toolbar", { name: "阅读工具盘" })).toHaveAttribute("data-dock", "left");
});

test("Escape closes brush settings before returning to the pointer", async ({ page }) => {
  await page.goto("http://127.0.0.1:5173/");
  await page.locator(".book-card").first().click();
  const pen = page.getByRole("button", { name: "画笔（P）" });
  await pen.click();
  await expect(pen).toHaveAttribute("aria-pressed", "true");
  await pen.click();
  const settings = page.getByRole("dialog", { name: "画笔设置" });
  await expect(settings).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(settings).toBeHidden();
  await expect(pen).toHaveAttribute("aria-pressed", "true");
  await page.keyboard.press("Escape");
  await expect(page.getByRole("button", { name: "指针（V）" })).toHaveAttribute("aria-pressed", "true");
});

test("two views edit one live note draft and reopening reads its saved content", async ({ page }) => {
  await page.goto(`http://127.0.0.1:5173/tests/note-editors.html?book=${bookId}`);
  const first = page.getByRole("region", { name: "列表编辑器" });
  const second = page.getByRole("region", { name: "展开编辑器" });
  await first.getByLabel("笔记标题", { exact: true }).fill("同一份笔记");
  await expect(second.getByLabel("笔记标题", { exact: true })).toHaveValue("同一份笔记");
  await first.getByRole("textbox", { name: "笔记正文" }).fill("从列表写入");
  await expect(second.getByRole("textbox", { name: "笔记正文" })).toHaveText("从列表写入");
  await second.getByRole("textbox", { name: "笔记正文" }).fill("从展开编辑器继续");
  await expect(first.getByRole("textbox", { name: "笔记正文" })).toHaveText("从展开编辑器继续");
  await expect(page.getByRole("status")).toHaveText("已保存");
  await page.reload();
  await expect(first.getByRole("textbox", { name: "笔记正文" })).toHaveText("从展开编辑器继续");
  await expect(second.getByLabel("笔记标题", { exact: true })).toHaveValue("同一份笔记");
});

test("a focused clean note editor accepts a genuinely newer server revision", async ({ page }) => {
  await page.goto(`http://127.0.0.1:5173/tests/note-editors.html?book=${bookId}`);
  const region = page.getByRole("region", { name: "列表编辑器" });
  const editor = region.getByRole("textbox", { name: "笔记正文" });
  await editor.focus();
  await expect.poll(() => editor.evaluate((element) => document.activeElement === element)).toBe(true);
  const id = await region.getAttribute("data-note-id");
  const url = `http://127.0.0.1:43120/api/books/${bookId}/notes`;
  const headers = { Origin: "http://127.0.0.1:43120" };
  const current = (await (await page.request.get(url, { headers })).json() as { id: string; revision: number; title: string }[])
    .find((note) => note.id === id)!;
  expect((await page.request.post(`${url}/${id}`, { headers, data: {
    revision: current.revision, title: current.title,
    document: { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "服务端的新版本" }] }] },
  } })).status()).toBe(200);
  await page.getByRole("button", { name: "刷新记录" }).evaluate((button: HTMLButtonElement) => button.click());
  await expect(editor).toHaveText("服务端的新版本");
  await expect.poll(() => editor.evaluate((element) => document.activeElement === element)).toBe(true);
});

test("expanded note stays editable beside chat and keeps the material draft synchronized", async ({ page }) => {
  const sourceNote = core.library.store.list<Note>("note", bookId).find((note) => !note.deletedAt)!;
  core.library.store.put("note", sourceNote.id, bookId, { ...sourceNote,
    sourceReferences: [...sourceNote.sourceReferences, {
      id: "ui-source-reference", kind: "annotation", targetId: "ui-source-annotation",
      title: "复杂度定义", text: "算法复杂度的原文定义",
      source: { fingerprint: core.library.book(bookId).fingerprint,
        anchors: [{ page: 1, rects: [[20, 30, 140, 62]] }] },
    }],
  });
  await page.goto("http://127.0.0.1:5173/");
  await page.locator(".book-card").first().click();
  await closeFloatingChat(page);
  await expect(page.locator(".reader-body")).toBeVisible();
  if (!(await page.locator(".notes-panel").isVisible())) await page.getByLabel("笔记", { exact: true }).click();
  await page.locator(`.notes-list [data-note-id="${sourceNote.id}"]`).click();
  await page.getByRole("button", { name: "展开编辑笔记" }).click();
  const expanded = page.getByRole("dialog", { name: "展开笔记编辑" });
  await expanded.getByRole("textbox", { name: "笔记正文" }).fill("展开与列表共用同一份草稿");
  await expect(page.locator(".notes-panel .tiptap")).toHaveCount(0);
  await expect(page.locator(".notes-panel")).toContainText("展开与列表共用同一份草稿");
  await expanded.locator(".expanded-note-sources > summary").click();
  await expanded.locator(".expanded-note-source").filter({ hasText: "算法复杂度的原文定义" })
    .getByRole("button", { name: "插入正文" }).click();
  const sourceReference = expanded.locator('[data-reference-id="ui-source-reference"]');
  await expect(sourceReference).toHaveCount(1);
  await sourceReference.click();
  await expect(page.locator(".workspace-source-focus")).toHaveCount(1);
  await expanded.getByTitle("链接", { exact: true }).click();
  await expanded.getByLabel("笔记链接地址").press("Escape");
  await expect(expanded.getByLabel("笔记链接地址")).toHaveCount(0);
  await expanded.getByTitle("行内公式", { exact: true }).click();
  await expanded.getByLabel("LaTeX 公式").fill("E=mc^2");
  await expanded.getByRole("button", { name: "应用公式" }).click();
  const inlineMath = expanded.locator('[data-type="inline-math"]');
  await expect(inlineMath).toHaveAttribute("data-latex", "E=mc^2");
  await expanded.getByTitle("插入表格", { exact: true }).click();
  await expect(expanded.locator(".tiptap table")).toHaveCount(1);
  const chatButton = page.getByRole("button", { name: "问答", exact: true }).first();
  if ((await chatButton.getAttribute("aria-pressed")) !== "true") await chatButton.click();
  await expect(page.locator(".navigation .notes-panel")).toBeVisible();
  await expect(page.locator(".floating-chat .chat")).toBeVisible();
  await expect(expanded).toBeVisible();
  await expanded.getByRole("textbox", { name: "笔记正文" }).fill("问答打开时仍可写笔记");
  await expect(expanded).toBeVisible();
  await page.screenshot({ path: "test-results/expanded-note-and-chat.png" });
  await closeFloatingChat(page);
  await page.getByLabel("笔记浮窗", { exact: true }).getByRole("button", { name: "关闭笔记浮窗" }).click();
  await expect(expanded).toHaveCount(0);
  await expect(page.locator(".notes-panel .tiptap")).toHaveCount(0);
  await expect(page.locator(".notes-panel")).toContainText("问答打开时仍可写笔记");
});

test("failed saves retain the shared draft and prevent closing the expanded editor", async ({ page }) => {
  await page.goto("http://127.0.0.1:5173/");
  await page.locator(".book-card").first().click();
  await closeFloatingChat(page);
  await expect(page.locator(".reader-body")).toBeVisible();
  if (!(await page.locator(".notes-panel").isVisible())) await page.getByLabel("笔记", { exact: true }).click();
  await page.locator(".notes-list button").first().click();
  await page.getByRole("button", { name: "展开编辑笔记" }).click();
  await page.route("**/api/v2/books/*/commands", (route) => route.request().method() === "POST"
    ? route.fulfill({ status: 503, json: { error: "暂时无法保存" } }) : route.continue());
  const expanded = page.getByRole("dialog", { name: "展开笔记编辑" });
  await expanded.getByRole("textbox", { name: "笔记正文" }).fill("失败后两处保留草稿");
  await page.getByLabel("笔记浮窗", { exact: true }).getByRole("button", { name: "关闭笔记浮窗" }).click();
  await expect(expanded.getByRole("status")).toContainText("保存失败");
  await expect(page.locator(".notes-panel .tiptap")).toHaveCount(0);
  await expect(page.locator(".notes-panel")).toContainText("失败后两处保留草稿");
  await page.unroute("**/api/v2/books/*/commands");
  await expanded.getByRole("button", { name: "重试保存" }).click();
  await expect(expanded.getByRole("status")).toHaveText("已保存");
  await expanded.getByRole("textbox", { name: "笔记正文" }).press("Escape");
  await expect(expanded).toHaveCount(0);
});

test("refreshing a dirty note cannot silently adopt a conflicting remote revision", async ({ page }) => {
  await page.goto(`http://127.0.0.1:5173/tests/note-editors.html?book=${bookId}`);
  const first = page.getByRole("region", { name: "列表编辑器" }).getByRole("textbox", { name: "笔记正文" });
  await expect(first).toBeVisible();
  await page.route("**/api/v2/books/*/commands", (route) => route.request().method() === "POST"
    ? route.fulfill({ status: 503, json: { error: "暂时无法保存" } }) : route.continue());
  await first.fill("保留的本地草稿");
  await expect(page.getByRole("status")).toContainText("保存失败");
  const origin = "http://127.0.0.1:43120";
  const headers = { Origin: origin };
  const url = `${origin}/api/books/${bookId}/notes`;
  const editingId = await page.getByRole("region", { name: "列表编辑器" }).getAttribute("data-note-id");
  const current = (await (await page.request.get(url, { headers })).json() as { id: string; revision: number }[])
    .find((note) => note.id === editingId)!;
  expect((await page.request.post(`${url}/${current.id}`, { headers, data: {
    revision: current.revision, title: "另一个编辑窗口",
    document: { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "远端的新内容" }] }] },
  } })).status()).toBe(200);
  const refreshed = page.waitForResponse((response) => response.url() === url && response.request().method() === "GET");
  await page.getByRole("button", { name: "刷新记录" }).click();
  await refreshed;
  await expect(first).toHaveText("保留的本地草稿");
  await page.unroute("**/api/v2/books/*/commands");
  await page.getByRole("button", { name: "重试保存" }).click();
  await expect(page.getByRole("status")).toContainText("保存失败");
  expect(JSON.stringify((await (await page.request.get(url, { headers })).json() as { id: string; document: unknown }[])
    .find((note) => note.id === editingId)!.document)).toContain("远端的新内容");
  await page.getByRole("button", { name: "用草稿覆盖最新版本" }).click();
  await expect(page.getByRole("status")).toHaveText("已保存");
  await page.reload();
  await expect(first).toHaveText("保留的本地草稿");
});

test("a lost response for an older edit never drops a newer draft", async ({ page }) => {
  await page.goto(`http://127.0.0.1:5173/tests/note-editors.html?book=${bookId}`);
  const first = page.getByRole("region", { name: "列表编辑器" }).getByRole("textbox", { name: "笔记正文" });
  const second = page.getByRole("region", { name: "展开编辑器" }).getByRole("textbox", { name: "笔记正文" });
  let release!: () => void;
  const releaseResponse = new Promise<void>((resolveResponse) => { release = resolveResponse; });
  let committed!: () => void;
  const committedRequest = new Promise<void>((resolveCommit) => { committed = resolveCommit; });
  let dropped = false;
  await page.route("**/api/v2/books/*/commands", async (route) => {
    if (route.request().method() !== "POST" || dropped) { await route.continue(); return; }
    dropped = true;
    await route.fetch(); committed();
    await releaseResponse;
    await route.abort("failed");
  });
  try {
    await first.fill("请求已经提交但响应尚未返回");
    await committedRequest;
    await second.fill("这是用户后来输入的内容");
    await expect(first).toHaveText("这是用户后来输入的内容");
    release();
    await expect(page.getByRole("status")).toHaveText("已保存");
    await page.reload();
    await expect(first).toHaveText("这是用户后来输入的内容");
  } finally { release(); }
});

test("a passive editor cannot undo another editor's synchronized content", async ({ page }) => {
  await page.goto(`http://127.0.0.1:5173/tests/note-editors.html?book=${bookId}`);
  const first = page.getByRole("region", { name: "列表编辑器" });
  const second = page.getByRole("region", { name: "展开编辑器" });
  await second.getByRole("textbox", { name: "笔记正文" }).fill("只在展开编辑器键入的内容");
  await expect(first.getByRole("textbox", { name: "笔记正文" })).toHaveText("只在展开编辑器键入的内容");
  await first.getByTitle("撤销编辑", { exact: true }).click();
  await expect(second.getByRole("textbox", { name: "笔记正文" })).toHaveText("只在展开编辑器键入的内容");
});

test("creating a note still refreshes the list when another note saves during the read", async ({ page }) => {
  await page.goto(`http://127.0.0.1:5173/tests/note-editors.html?book=${bookId}`);
  const first = page.getByRole("region", { name: "列表编辑器" }).getByRole("textbox", { name: "笔记正文" });
  await expect(first).toBeVisible();
  const count = Number(await page.getByLabel("笔记数量").textContent());
  let release!: () => void;
  const released = new Promise<void>((done) => { release = done; });
  let read!: () => void;
  const fetched = new Promise<void>((done) => { read = done; });
  let delayed = false;
  await page.route("**/api/books/*/notes", async (route) => {
    if (route.request().method() !== "GET" || delayed) { await route.continue(); return; }
    delayed = true;
    const response = await route.fetch(); read();
    await released; await route.fulfill({ response });
  });
  try {
    await page.getByRole("button", { name: "新建笔记", exact: true }).click();
    await fetched;
    const saved = page.waitForResponse((response) => /\/api\/v2\/books\/[^/]+\/commands$/.test(response.url()) &&
      response.request().method() === "POST");
    await first.fill("新建期间继续编辑原笔记");
    expect((await saved).status()).toBe(200);
    await expect(page.getByRole("status")).toHaveText("已保存");
    release();
    await expect(page.getByLabel("笔记数量")).toHaveText(String(count + 1));
  } finally { release(); }
});

test("workspace retry uses its original receipt and preserves newer drafts on remote conflict", async ({ page }) => {
  await page.goto(`http://127.0.0.1:5173/tests/workspace-edits.html?book=${bookId}`);
  const input = page.getByLabel("卡片正文");
  await expect(input).toBeVisible();
  let release!: () => void, committed!: () => void;
  const released = new Promise<void>((done) => { release = done; });
  const submitted = new Promise<void>((done) => { committed = done; });
  let dropped = false;
  await page.route("**/api/v2/books/*/workspace/commands", async (route) => {
    if (dropped) { await route.continue(); return; }
    dropped = true;
    const response = await route.fetch();
    expect(response.status()).toBe(200);
    committed(); await released; await route.abort("failed");
  });
  try {
    await input.fill("首个请求已提交");
    await submitted;
    const origin = "http://127.0.0.1:43120", headers = { Origin: origin };
    const url = `${origin}/api/books/${bookId}/workspace`;
    const saved = await (await page.request.get(url, { headers })).json();
    expect((await page.request.post(url + "/commands", { headers, data: {
      bookId, commandId: "remote-update", expectedVersion: saved.revision,
      changes: [{ type: "upsert-card", card: { ...saved.cards.find((card: { id: string }) => card.id === "draft-card"), text: "另一个窗口的新内容" } }],
    } })).status()).toBe(200);
    await input.fill("尚未保存的后来输入");
    release();
    await expect(page.getByRole("status")).toContainText("保存失败");
    await page.getByRole("button", { name: "重试保存" }).click();
    await expect(page.getByRole("alert")).toContainText("版本冲突");
    await expect(input).toHaveValue("尚未保存的后来输入");
    expect((await (await page.request.get(url, { headers })).json()).cards.find((card: { id: string }) => card.id === "draft-card").text).toBe("另一个窗口的新内容");
  } finally { release(); }
});

test("book editing session saves a Note before its placement without a mounted reader", async ({ page }) => {
  await page.goto(`http://127.0.0.1:5173/tests/workspace-edits.html?book=${bookId}`);
  await expect(page.getByLabel("卡片正文")).toBeVisible();
  await page.getByRole("button", { name: "保存未挂载画布的书籍草稿" }).click();
  await expect(page.getByLabel("书籍保存结果")).toHaveText("已保存笔记和位置");
  const origin = "http://127.0.0.1:43120", headers = { Origin: origin };
  const workspace = await (await page.request.get(`${origin}/api/books/${bookId}/workspace`, { headers })).json();
  const card = workspace.cards.find((item: { id: string }) => item.id === "book-session-card");
  expect(card?.noteId).toBeTruthy();
  const notes = await (await page.request.get(`${origin}/api/books/${bookId}/notes`, { headers })).json();
  expect(notes.find((note: { id: string }) => note.id === card.noteId)?.title).toBe("同一书籍的笔记");
});

test("workspace refresh cannot overwrite edits made while its response is pending", async ({ page }) => {
  await page.goto(`http://127.0.0.1:5173/tests/workspace-edits.html?book=${bookId}`);
  const input = page.getByLabel("卡片正文");
  await input.fill("刷新前的已保存内容");
  await expect(page.getByRole("status")).toHaveText("已保存");
  let release!: () => void, fetched!: () => void;
  const released = new Promise<void>((done) => { release = done; });
  const read = new Promise<void>((done) => { fetched = done; });
  await page.route("**/api/books/*/workspace", async (route) => {
    const response = await route.fetch(); fetched(); await released;
    await route.fulfill({ response });
  });
  try {
    await page.getByRole("button", { name: "刷新工作区" }).click();
    await read;
    await input.fill("刷新过程中继续写入的内容");
    release();
    await expect(page.getByRole("alert")).toContainText("刷新期间");
    await expect(input).toHaveValue("刷新过程中继续写入的内容");
  } finally { release(); }
});

test("an older mount load cannot overwrite a newer explicit workspace refresh", async ({ page }) => {
  let reads = 0;
  let firstFetched!: () => void, releaseFirst!: () => void, firstDelivered!: () => void;
  const fetched = new Promise<void>((done) => { firstFetched = done; });
  const released = new Promise<void>((done) => { releaseFirst = done; });
  const delivered = new Promise<void>((done) => { firstDelivered = done; });
  await page.route("**/api/books/*/workspace", async (route) => {
    const response = await route.fetch();
    const first = ++reads === 1;
    if (first) { firstFetched(); await released; }
    await route.fulfill({ response });
    if (first) firstDelivered();
  });
  try {
    await page.goto(`http://127.0.0.1:5173/tests/workspace-edits.html?book=${bookId}`);
    await fetched;
    const workspaces = new Workspaces(core.library);
    const before = workspaces.get(bookId);
    workspaces.save(bookId, { ...before, cards: [...before.cards.filter((card) => card.id !== "draft-card"),
      { id: "draft-card", kind: "note", title: "Refresh", text: "新快照保留",
        comment: "", x: 20, y: 40, width: 300, height: 240 }] });
    await page.getByRole("button", { name: "刷新工作区" }).click();
    await expect(page.getByLabel("卡片正文")).toHaveValue("新快照保留");
    releaseFirst();
    await delivered;
    await expect(page.getByLabel("卡片正文")).toHaveValue("新快照保留");
  } finally { releaseFirst(); }
});
