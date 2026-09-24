import { test, expect } from "@playwright/test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { PDFDocument } from "pdf-lib";
import { createCore } from "../apps/core/src/server";

let core: ReturnType<typeof createCore>;
let directory: string;
let bookId: string;
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
  expect((await fetch(origin + `/api/books/${bookId}/notes`, { method: "POST", headers, body: "{}" })).status).toBe(201);
});
test.afterAll(async () => {
  core?.close();
  if (directory) await rm(directory, { recursive: true, force: true });
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

test("expanded note stays editable beside chat and keeps the sidebar draft synchronized", async ({ page }) => {
  await page.goto("http://127.0.0.1:5173/");
  await page.locator(".book-card").first().click();
  await page.getByLabel("笔记", { exact: true }).click();
  await page.locator(".notes-list button").first().click();
  await page.getByRole("button", { name: "展开编辑笔记" }).click();
  const expanded = page.getByRole("dialog", { name: "展开笔记编辑" });
  await expanded.getByRole("textbox", { name: "笔记正文" }).fill("展开与列表共用同一份草稿");
  await expect(page.locator(".notes-panel .tiptap")).toHaveText("展开与列表共用同一份草稿");
  await page.locator(".panel-tabs").getByRole("button", { name: "问答", exact: true }).click();
  await expect(expanded).toBeVisible();
  await expanded.getByRole("textbox", { name: "笔记正文" }).fill("问答打开时仍可写笔记");
  await expanded.getByTitle("链接", { exact: true }).click();
  await expanded.getByLabel("笔记链接地址").press("Escape");
  await expect(expanded.getByLabel("笔记链接地址")).toHaveCount(0);
  await expect(expanded).toBeVisible();
  await page.screenshot({ path: "test-results/expanded-note-and-chat.png" });
  await expanded.getByRole("button", { name: "收起笔记编辑" }).click();
  await expect(expanded).toHaveCount(0);
  await page.locator(".panel-tabs").getByRole("button", { name: "笔记", exact: true }).click();
  await expect(page.locator(".notes-panel .tiptap")).toHaveText("问答打开时仍可写笔记");
});

test("failed saves retain the shared draft and prevent closing the expanded editor", async ({ page }) => {
  await page.goto("http://127.0.0.1:5173/");
  await page.locator(".book-card").first().click();
  await expect(page.locator(".reader-body")).toBeVisible();
  if (!(await page.locator(".notes-panel").isVisible())) await page.getByLabel("笔记", { exact: true }).click();
  await page.locator(".notes-list button").first().click();
  await page.getByRole("button", { name: "展开编辑笔记" }).click();
  await page.route("**/api/books/*/notes/*", (route) => route.request().method() === "POST"
    ? route.fulfill({ status: 503, json: { error: "暂时无法保存" } }) : route.continue());
  const expanded = page.getByRole("dialog", { name: "展开笔记编辑" });
  await expanded.getByRole("textbox", { name: "笔记正文" }).fill("失败后两处保留草稿");
  await expanded.getByRole("button", { name: "收起笔记编辑" }).click();
  await expect(expanded.getByRole("status")).toContainText("保存失败");
  await expect(page.locator(".notes-panel .tiptap")).toHaveText("失败后两处保留草稿");
  await page.unroute("**/api/books/*/notes/*");
  await expanded.getByRole("button", { name: "重试保存" }).click();
  await expect(expanded.getByRole("status")).toHaveText("已保存");
  await expanded.getByRole("textbox", { name: "笔记正文" }).press("Escape");
  await expect(expanded).toHaveCount(0);
});

test("refreshing a dirty note cannot silently adopt a conflicting remote revision", async ({ page }) => {
  await page.goto(`http://127.0.0.1:5173/tests/note-editors.html?book=${bookId}`);
  const first = page.getByRole("region", { name: "列表编辑器" }).getByRole("textbox", { name: "笔记正文" });
  await expect(first).toBeVisible();
  await page.route("**/api/books/*/notes/*", (route) => route.request().method() === "POST"
    ? route.fulfill({ status: 503, json: { error: "暂时无法保存" } }) : route.continue());
  await first.fill("保留的本地草稿");
  await expect(page.getByRole("status")).toContainText("保存失败");
  const origin = "http://127.0.0.1:43120";
  const headers = { Origin: origin };
  const url = `${origin}/api/books/${bookId}/notes`;
  const current = (await (await page.request.get(url, { headers })).json())[0];
  expect((await page.request.post(`${url}/${current.id}`, { headers, data: {
    revision: current.revision, title: "另一个编辑窗口",
    document: { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "远端的新内容" }] }] },
  } })).status()).toBe(200);
  const refreshed = page.waitForResponse((response) => response.url() === url && response.request().method() === "GET");
  await page.getByRole("button", { name: "刷新记录" }).click();
  await refreshed;
  await expect(first).toHaveText("保留的本地草稿");
  await page.unroute("**/api/books/*/notes/*");
  await page.getByRole("button", { name: "重试保存" }).click();
  await expect(page.getByRole("status")).toContainText("保存失败");
  expect(JSON.stringify((await (await page.request.get(url, { headers })).json())[0].document)).toContain("远端的新内容");
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
  await page.route("**/api/books/*/notes/*", async (route) => {
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
    const saved = page.waitForResponse((response) => /\/notes\/[^/]+$/.test(response.url()) && response.request().method() === "POST");
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
      changes: [{ type: "upsert-card", card: { ...saved.cards[0], text: "另一个窗口的新内容" } }],
    } })).status()).toBe(200);
    await input.fill("尚未保存的后来输入");
    release();
    await expect(page.getByRole("status")).toContainText("保存失败");
    await page.getByRole("button", { name: "重试保存" }).click();
    await expect(page.getByRole("alert")).toContainText("版本冲突");
    await expect(input).toHaveValue("尚未保存的后来输入");
    expect((await (await page.request.get(url, { headers })).json()).cards[0].text).toBe("另一个窗口的新内容");
  } finally { release(); }
});
