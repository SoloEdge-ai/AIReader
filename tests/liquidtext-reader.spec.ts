import { expect, test, type Page } from "@playwright/test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { PDFDocument, StandardFonts } from "pdf-lib";
import { createCore } from "../apps/core/src/server";
import { Workspaces } from "../apps/core/src/workspace";
import { Preferences } from "../apps/core/src/preferences";

const base = "http://127.0.0.1:5173/";
let directory: string;
let core: ReturnType<typeof createCore>;
let bookId: string;

async function openBook(page: Page) {
  await page.goto(base);
  await page.locator(".book-card").filter({ hasText: "LiquidText alignment fixture" }).click();
  await expect(page.getByRole("region", { name: "原文" })).toBeVisible();
  await expect(page.getByRole("region", { name: "工作台" })).toBeVisible();
  await expect(page.locator(".pdf-pane .pdf-page").first()).toBeVisible();
  const chat = page.getByLabel("AI 问答浮窗");
  if (await chat.isVisible()) await chat.getByRole("button", { name: "关闭问答浮窗" }).click();
}

async function selectFirstPdfLine(page: Page, pageNumber: number) {
  await page.evaluate((number) => {
    const span = window.document.querySelector<HTMLElement>(
      `.pdf-pane .pdf-page[data-page="${number}"] .textLayer span`,
    );
    if (!span?.firstChild) throw new Error("PDF text layer not ready");
    const range = window.document.createRange();
    range.selectNodeContents(span.firstChild);
    const selection = window.getSelection();
    selection?.removeAllRanges();
    selection?.addRange(range);
    const rect = range.getBoundingClientRect();
    span.dispatchEvent(new MouseEvent("mouseup", { bubbles: true, button: 0,
      clientX: rect.right, clientY: rect.bottom }));
  }, pageNumber);
  await expect(page.getByRole("toolbar", { name: "文字选区操作" })).toBeVisible();
}

test.beforeAll(async () => {
  directory = await mkdtemp(join(tmpdir(), "aireader-liquidtext-ui-"));
  core = createCore(directory, resolve("dist/web"));
  const pdf = await PDFDocument.create();
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  for (const [index, title] of [
    "Definition: a graph is a set of vertices and edges.",
    "Theorem: shortest paths obey optimal substructure.",
    "Diagram: a source, a branch, and two destinations.",
  ].entries()) {
    const page = pdf.addPage([500, 700]);
    page.drawText(title, { x: 64, y: 620, font, size: 16 });
    page.drawText(`Context paragraph on page ${index + 1}.`, {
      x: 64, y: 590, font, size: 12,
    });
  }
  const book = await core.library.import(
    Buffer.from(await pdf.save()), "LiquidText alignment fixture.pdf",
  );
  bookId = book.id;
  new Preferences(core.library).saveForBook(bookId, { deskLayout: "adjacent" });
  await core.library.waitForBook(bookId);
  const workspace = new Workspaces(core.library);
  const original = workspace.get(bookId);
  workspace.save(bookId, { ...original, cards: [
    { id: "excerpt-definition", kind: "excerpt", title: "定义", text: "A graph is a set of vertices and edges.",
      comment: "", x: 70, y: 70, width: 320, height: 240,
      source: { fingerprint: book.fingerprint, anchors: [{ page: 1, rects: [[64, 616, 460, 642]] }] } },
    { id: "excerpt-theorem", kind: "excerpt", title: "定理", text: "Shortest paths obey optimal substructure.",
      comment: "", x: 420, y: 70, width: 320, height: 240,
      source: { fingerprint: book.fingerprint, anchors: [{ page: 2, rects: [[64, 616, 460, 642]] }] } },
  ] });
  await new Promise<void>((done) => core.server.listen(43120, "127.0.0.1", done));
});

test.afterAll(async () => {
  core?.close();
  if (directory) await rm(directory, { recursive: true, force: true });
});

test("split panes keep independent zoom, width, reading position, and style", async ({ page }) => {
  await page.setViewportSize({ width: 1600, height: 900 });
  await openBook(page);
  const document = page.getByRole("region", { name: "原文" });
  const board = page.getByRole("region", { name: "工作台" });
  const pdfZoom = document.getByLabel("原文缩放");
  const boardZoom = board.getByLabel("工作台缩放");
  const initialPdfZoom = await pdfZoom.textContent();
  const initialBoardZoom = await boardZoom.textContent();
  await document.getByRole("button", { name: "放大原文" }).click();
  await expect(pdfZoom).not.toHaveText(initialPdfZoom!);
  await expect(boardZoom).toHaveText(initialBoardZoom!);
  await board.getByRole("button", { name: "缩小工作台" }).click();
  await expect(boardZoom).not.toHaveText(initialBoardZoom!);
  const zooms = [await pdfZoom.textContent(), await boardZoom.textContent()];

  const divider = page.getByRole("separator", { name: "调整原文与工作台宽度" });
  await divider.focus();
  await divider.press("End");
  await expect(divider).toHaveAttribute("aria-valuenow", "70");
  const more = board.getByRole("button", { name: "更多工作台操作" });
  await expect(more).toBeVisible();
  await more.click();
  await expect(board.getByRole("menuitem", { name: "适应全部内容" })).toBeVisible();
  await page.keyboard.press("Escape");
  const boardHeader = board.locator(".reader-pane-header");
  expect(await boardHeader.evaluate((header) =>
    [...header.querySelectorAll<HTMLElement>(".reader-pane-actions > button")]
      .filter((button) => getComputedStyle(button).display !== "none")
      .every((button) => button.getBoundingClientRect().right <= header.getBoundingClientRect().right + 1),
  )).toBe(true);
  await document.getByRole("button", { name: "最大化原文" }).click();
  await expect(board).toBeHidden();
  await document.getByRole("button", { name: "恢复双栏" }).click();
  await expect(board).toBeVisible();
  await expect(divider).toHaveAttribute("aria-valuenow", "70");

  const pageNumber = page.getByRole("textbox", { name: "页码" });
  await pageNumber.fill("2");
  await pageNumber.press("Enter");
  await expect(document.locator(".reader-pane-header small")).toContainText("第 2 页");
  await expect.poll(async () => {
    const response = await page.request.get(`http://127.0.0.1:43120/api/books/${bookId}/preferences`,
      { headers: { Origin: "http://127.0.0.1:43120" } });
    return (await response.json() as { pdfView?: { page: number } }).pdfView?.page;
  }).toBe(2);

  await page.getByRole("button", { name: "设置" }).click();
  const settings = page.getByRole("dialog", { name: "设置" });
  await settings.getByLabel("界面风格").selectOption("paper");
  await settings.getByLabel("主题", { exact: true }).selectOption("dark");
  await expect(page.locator("html")).toHaveAttribute("data-visual-style", "paper");
  await settings.getByRole("button", { name: "关闭设置" }).click();
  await page.screenshot({ path: "test-results/liquidtext-split-paper-dark.png" });
  await page.reload();
  await page.locator(".book-card").filter({ hasText: "LiquidText alignment fixture" }).click();
  await expect(document).toBeVisible();
  await expect(board).toBeVisible();
  await expect(pdfZoom).toHaveText(zooms[0]!);
  await expect(boardZoom).toHaveText(zooms[1]!);
  await expect(divider).toHaveAttribute("aria-valuenow", "70");
  await expect(document.locator(".reader-pane-header small")).toContainText("第 2 页");
  await expect(page.locator("html")).toHaveAttribute("data-visual-style", "paper");
});

test("cards compare, focus the original PDF, and organize into a group", async ({ page }) => {
  await page.setViewportSize({ width: 1600, height: 900 });
  await openBook(page);
  const board = page.getByRole("region", { name: "工作台" });
  const document = page.getByRole("region", { name: "原文" });
  const first = board.locator('[data-card-id="excerpt-definition"]');
  const second = board.locator('[data-card-id="excerpt-theorem"]');
  await expect(first).toBeVisible();
  await expect(second).toBeVisible();

  await first.getByRole("button", { name: /第 1 页/ }).click();
  const preview = board.getByLabel("摘录来源预览");
  await expect(preview).toContainText("A graph is a set of vertices and edges.");
  await expect(document.locator(".pdf-page").first()).toBeVisible();
  await preview.getByRole("button", { name: "聚焦原文" }).click();
  await expect(document.getByLabel("原文聚焦")).toBeVisible();
  await document.getByRole("button", { name: "返回阅读" }).click();
  await expect(document.locator(".pdf-page").first()).toBeVisible();

  await first.click();
  await second.click({ modifiers: ["Shift"] });
  await board.getByRole("button", { name: "更多工作台操作" }).click();
  await board.getByRole("menuitem", { name: "并排比较" }).click();
  await expect(board.getByLabel("并排比较")).toContainText("A graph is a set of vertices and edges.");
  await expect(board.getByLabel("并排比较")).toContainText("Shortest paths obey optimal substructure.");
  await board.getByRole("button", { name: "关闭比较并返回工作台" }).click();
  await expect(first).toBeVisible();
  await expect(second).toBeVisible();

  await board.getByRole("button", { name: "更多工作台操作" }).click();
  await board.getByRole("menuitem", { name: "将所选材料建为主题组" }).click();
  const group = board.locator(".workspace-group");
  await expect(group).toContainText("2 项");
  await group.getByRole("button", { name: "折叠主题组" }).click();
  await expect(group).toContainText("2 项");
  await expect(first).toBeHidden();
  await group.getByRole("button", { name: "展开主题组" }).click();
  await expect(first).toBeVisible();
  await page.screenshot({ path: "test-results/liquidtext-grouped-board.png" });
});

test("frozen PDF text drags to the board and narrow tabs retain both surfaces", async ({ page }) => {
  await page.setViewportSize({ width: 1600, height: 900 });
  await openBook(page);
  const document = page.getByRole("region", { name: "原文" });
  const board = page.getByRole("region", { name: "工作台" });
  await page.getByRole("textbox", { name: "页码" }).fill("3");
  await page.getByRole("textbox", { name: "页码" }).press("Enter");
  await expect(document.locator('.pdf-page[data-page="3"] .textLayer span').first()).toBeVisible();
  await page.getByRole("button", { name: "选择文字（T）" }).click();
  await selectFirstPdfLine(page, 3);
  const selectionBar = page.getByRole("toolbar", { name: "文字选区操作" });
  await expect(selectionBar).toContainText("摘录卡片");
  const countBefore = await board.locator(".workspace-card").count();
  await selectionBar.getByRole("button", { name: "拖动摘录到工作台" })
    .dragTo(board.locator(".board-normal-view"), { targetPosition: { x: 330, y: 520 } });
  await expect(board.locator(".workspace-card")).toHaveCount(countBefore + 1);
  await expect(board.locator(".workspace-card").last()).toContainText("Diagram: a source");
  await expect(document.locator(".pdf-page").first()).toBeVisible();

  await selectFirstPdfLine(page, 3);
  await selectionBar.getByRole("button", { name: "摘录卡片" }).click();
  await expect(board.locator(".workspace-card")).toHaveCount(countBefore + 1);

  await page.setViewportSize({ width: 760, height: 720 });
  const tabs = page.getByRole("tablist", { name: "阅读区域" });
  await expect(tabs).toBeVisible();
  await expect(tabs.getByRole("tab", { name: "工作台" })).toHaveAttribute("aria-selected", "true");
  await tabs.getByRole("tab", { name: "原文" }).click();
  await expect(document).toBeVisible();
  await expect(board).toBeHidden();
  await tabs.getByRole("tab", { name: "工作台" }).click();
  await expect(board).toBeVisible();
  await expect(board.locator(".workspace-card")).toHaveCount(countBefore + 1);
});

test("all four style and light combinations preserve the selected source card", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await openBook(page);
  const card = page.locator('[data-card-id="excerpt-definition"]');
  await card.click();
  await expect(card).toHaveClass(/selected/);
  for (const [style, theme, name] of [
    ["professional", "light", "professional-light"],
    ["professional", "dark", "professional-dark"],
    ["paper", "light", "paper-light"],
    ["paper", "dark", "paper-dark"],
  ] as const) {
    await page.getByRole("button", { name: "设置" }).click();
    const settings = page.getByRole("dialog", { name: "设置" });
    await settings.getByLabel("界面风格").selectOption(style);
    await settings.getByLabel("主题", { exact: true }).selectOption(theme);
    await settings.getByRole("button", { name: "关闭设置" }).click();
    await expect(page.locator("html")).toHaveAttribute("data-visual-style", style);
    await expect(page.locator("html")).toHaveAttribute("data-theme", theme);
    await expect(card).toHaveClass(/selected/);
    await expect(page.getByRole("region", { name: "原文" }).locator(".pdf-page").first()).toBeVisible();
    await page.screenshot({ path: `test-results/liquidtext-${name}.png` });
  }
});

test("a frozen AI material retains its snapshot when the source changes or leaves the board", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await openBook(page);
  const card = page.locator('[data-card-id="excerpt-definition"]');
  await card.click();
  await page.getByRole("button", { name: "将选中对象加入提问" }).click();
  const chat = page.getByLabel("AI 问答浮窗");
  const material = chat.locator(".question-material-item").first();
  await expect(material).toBeVisible();
  await material.getByText("查看将发送的内容").click();
  await expect(material).toContainText("A graph is a set of vertices and edges.");
  await card.getByRole("textbox", { name: "卡片标题" }).fill("修改后的定义");
  await expect(material.getByRole("status")).toContainText("原内容已更新");
  await expect(material).toContainText("A graph is a set of vertices and edges.");
  const document = page.getByRole("region", { name: "原文" });
  const frozenLine = page.locator('.connection-overlay-item[data-kind="ai-frozen"]');
  await expect(frozenLine).toHaveCount(1);
  await document.getByRole("button", { name: "最大化原文" }).click();
  await expect(frozenLine).toHaveCount(0);
  await page.getByRole("button", { name: "恢复原文与工作台双栏" }).click();
  await chat.getByRole("button", { name: "关闭问答浮窗" }).click();
  await page.getByRole("button", { name: "删除选中对象" }).click();
  await page.getByRole("button", { name: "问答", exact: true }).first().click();
  await expect(material.getByRole("status")).toContainText("原内容已更新");
  await expect.poll(async () => {
    const current = await page.request.get(`http://127.0.0.1:43120/api/books/${bookId}/workspace`);
    return (await current.json()).cards.find((entry: { id: string }) => entry.id === "excerpt-definition");
  }).toMatchObject({ placed: false, text: "A graph is a set of vertices and edges." });
  await expect(material).toContainText("A graph is a set of vertices and edges.");
  const notesButton = page.getByRole("button", { name: "笔记", exact: true }).first();
  if ((await notesButton.getAttribute("aria-pressed")) !== "true") await notesButton.click();
  await page.getByRole("region", { name: "本书材料" })
    .getByRole("button", { name: "将修改后的定义放回工作台" }).click();
  await expect(card).toBeVisible();
  await expect.poll(async () => {
    const current = await page.request.get(`http://127.0.0.1:43120/api/books/${bookId}/workspace`);
    return (await current.json()).cards.find((entry: { id: string }) => entry.id === "excerpt-definition")?.placed;
  }).toBe(true);
});

test("one atomic note placement links two excerpts and reopens with both sources", async ({ page }) => {
  const cleanWorkspace = new Workspaces(core.library);
  const prior = cleanWorkspace.get(bookId);
  cleanWorkspace.save(bookId, { ...prior, groups: [], camera: { x: 0, y: 0, zoom: 1 },
    cards: prior.cards.map((card, index) => ({ ...card, placed: true, x: 60 + index * 360, y: 80 })) });
  new Preferences(core.library).saveForBook(bookId, { deskLayout: "adjacent", splitRatio: .4 });
  await page.setViewportSize({ width: 1920, height: 1080 });
  await openBook(page);
  const board = page.getByRole("region", { name: "工作台" });
  await board.getByRole("button", { name: "新建笔记" }).click();
  const noteCard = board.locator(".workspace-card.note");
  await expect(noteCard).toHaveCount(1);
  const origin = "http://127.0.0.1:43120";
  const headers = { Origin: origin };
  const notesUrl = `${origin}/api/books/${bookId}/notes`;
  const workspaceUrl = `${origin}/api/books/${bookId}/workspace`;
  const notes = await (await page.request.get(notesUrl, { headers })).json() as
    { id: string; sourceReferences: { targetId: string }[] }[];
  const workspace = await (await page.request.get(workspaceUrl, { headers })).json() as
    { cards: { id: string; noteId?: string; x: number; y: number; width: number; height: number }[] };
  expect(notes).toHaveLength(1);
  expect(workspace.cards.filter((card) => card.noteId === notes[0].id)).toHaveLength(1);
  const placed = workspace.cards.find((card) => card.noteId === notes[0].id)!;
  for (const excerpt of workspace.cards.filter((card) => card.id.startsWith("excerpt-")))
    expect(placed.x >= excerpt.x + excerpt.width || excerpt.x >= placed.x + placed.width ||
      placed.y >= excerpt.y + excerpt.height || excerpt.y >= placed.y + placed.height).toBe(true);

  await page.getByLabel("笔记浮窗", { exact: true }).getByRole("button", { name: "关闭笔记浮窗" }).click();
  for (const id of ["excerpt-definition", "excerpt-theorem"]) {
    await board.locator(`[data-card-id="${id}"]`).click({ position: { x: 40, y: 35 } });
    await board.locator(`[data-card-id="${id}"]`)
      .getByRole("button", { name: "关联到所选笔记" }).click();
  }
  await expect.poll(async () => {
    const saved = await (await page.request.get(notesUrl, { headers })).json() as typeof notes;
    return saved[0]?.sourceReferences.map((source) => source.targetId).sort();
  }).toEqual(["excerpt-definition", "excerpt-theorem"]);
  await expect(page.getByText("刷新期间工作区已发生编辑", { exact: false })).toHaveCount(0);
  await noteCard.hover();
  await noteCard.getByRole("button", { name: "展开卡片笔记" }).click();
  const expanded = page.getByRole("dialog", { name: "展开笔记编辑" });
  await expect(expanded.locator(".expanded-note-sources summary"))
    .toContainText("来源 · 2 处");
  await expanded.getByLabel("笔记标题").fill("最短路径：定义、推导与边界");
  await expanded.getByRole("textbox", { name: "笔记正文" }).fill(
    "图由顶点集合和边集合构成。读这两处原文时，我先确认对象的定义，再追问最短路径算法依赖什么结构。\n\n" +
    "第一处摘录给出图的基本组成，第二处摘录指出最优子结构。把二者放在同一工作台里比较，可以明确算法的输入是什么、递推步骤为何成立。\n\n" +
    "自己的判断：如果边权允许负值，某些贪心步骤就不能直接沿用。实际证明需要写明边权前提，并区分最短路径的存在性与求解方法。",
  );
  await expanded.getByTitle("公式块", { exact: true }).click();
  await expanded.getByLabel("LaTeX 公式").fill(String.raw`d(s,v)=\min_{(u,v)\in E}\left(d(s,u)+w(u,v)\right)`);
  await expanded.getByRole("button", { name: "应用公式" }).click();
  await expect(expanded.locator('[data-type="block-math"]')).toHaveCount(1);
  await expanded.getByTitle("插入表格", { exact: true }).click();
  const table = expanded.locator(".tiptap table");
  await expect(table).toHaveCount(1);
  const cells = table.locator("th, td");
  for (const [index, value] of ["材料", "核心信息", "我的问题", "定义", "顶点与边", "对象边界", "定理", "最优子结构", "成立前提"].entries()) {
    await cells.nth(index).click();
    await page.keyboard.type(value);
  }
  await expanded.locator(".expanded-note-sources summary").click();
  await expect(expanded.locator(".expanded-note-source")).toHaveCount(2);
  await expect(expanded.getByRole("status")).toHaveText("已保存");
  await expect(page.getByText("刷新期间工作区已发生编辑", { exact: false })).toHaveCount(0);
  const contentWidth = await expanded.locator(".expanded-note-content")
    .evaluate((element) => element.getBoundingClientRect().width);
  expect(contentWidth).toBeGreaterThan(400);
  expect(contentWidth).toBeLessThanOrEqual(681);
  await expect(page.getByRole("region", { name: "原文" }).locator(".pdf-page").first())
    .toBeVisible();

  await page.getByLabel("笔记浮窗", { exact: true }).getByRole("button", { name: "关闭笔记浮窗" }).click();

  await page.reload();
  await page.locator(".book-card").filter({ hasText: "LiquidText alignment fixture" }).click();
  const reopenedBoard = page.getByRole("region", { name: "工作台" });
  const reopenedNoteCard = reopenedBoard.locator(".workspace-card.note");
  await expect(reopenedNoteCard).toHaveCount(1);
  await reopenedNoteCard.hover();
  await reopenedNoteCard.getByRole("button", { name: "展开卡片笔记" }).click();
  const reopened = page.getByRole("dialog", { name: "展开笔记编辑" });
  await expect(reopened.locator(".expanded-note-sources summary"))
    .toContainText("来源 · 2 处");
  await expect(reopened.getByRole("textbox", { name: "笔记正文" }))
    .toContainText("图由顶点集合和边集合构成");
  await expect(reopened.locator('[data-type="block-math"]')).toHaveCount(1);
  await expect(reopened.locator(".tiptap table")).toHaveCount(1);
  await reopened.locator(".expanded-note-sources summary").click();
  await expect(reopened.locator(".expanded-note-source")).toHaveCount(2);
  await expect(reopened.getByRole("status")).toHaveText("已保存");

  for (const [style, theme, name] of [
    ["professional", "light", "professional-light"],
    ["paper", "dark", "paper-dark"],
  ] as const) {
    await page.getByRole("button", { name: "设置" }).click();
    const settings = page.getByRole("dialog", { name: "设置" });
    await settings.getByLabel("界面风格").selectOption(style);
    await settings.getByLabel("主题", { exact: true }).selectOption(theme);
    await settings.getByRole("button", { name: "关闭设置" }).click();
    await expect(reopened).toBeVisible();
    await reopened.locator(".expanded-note-scroll").evaluate((element) => { element.scrollTop = 0; });
    await page.screenshot({ path: `test-results/liquidtext-expanded-${name}-top.png` });
    await reopened.locator(".expanded-note-scroll").evaluate((element) => { element.scrollTop = element.scrollHeight; });
    await expect(reopened.locator(".expanded-note-source")).toHaveCount(2);
    await expect(reopened.locator(".expanded-note-footer")).toBeVisible();
    const footerBottom = await reopened.locator(".expanded-note-footer")
      .evaluate((element) => element.getBoundingClientRect().bottom);
    const dialogBottom = await reopened.evaluate((element) => element.getBoundingClientRect().bottom);
    expect(Math.abs(footerBottom - dialogBottom)).toBeLessThan(2);
    await page.screenshot({ path: `test-results/liquidtext-expanded-${name}-sources.png` });
  }
});

test("Space activates a focused pane button instead of starting pan", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await openBook(page);
  const document = page.getByRole("region", { name: "原文" });
  const zoom = document.getByLabel("原文缩放");
  const initial = await zoom.textContent();
  await document.getByRole("button", { name: "放大原文" }).focus();
  await page.keyboard.press("Space");
  await expect(zoom).not.toHaveText(initial!);
});

test("a long PDF restores a saved page before reporting new reading progress", async ({ page }) => {
  test.setTimeout(120_000);
  const pdf = await PDFDocument.create();
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  for (let number = 1; number <= 320; number++) {
    const sheet = pdf.addPage([500, 700]);
    sheet.drawText(`Long book page ${number}`, { x: 64, y: 620, font, size: 14 });
  }
  const longBook = await core.library.import(Buffer.from(await pdf.save()), "Long reading position fixture.pdf");
  await core.library.waitForBook(longBook.id);
  const origin = "http://127.0.0.1:43120";
  const headers = { Origin: origin };
  const view = { page: 300, x: 0.5, y: 0 };
  new Preferences(core.library).saveForBook(longBook.id, { pdfView: view });

  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(base);
  await page.locator(".book-card").filter({ hasText: "Long reading position fixture" }).click();
  await expect(page.locator('.pdf-pane .pdf-page[data-page="300"]')).toBeInViewport({ timeout: 60_000 });
  await expect(page.getByRole("region", { name: "原文" }).locator(".reader-pane-header small"))
    .toContainText("第 300 页");
  const persisted = await (await page.request.get(`${origin}/api/books/${longBook.id}/preferences`, { headers }))
    .json() as { pdfView?: { page: number } };
  expect(persisted.pdfView?.page).toBe(300);
});

test("Delete only removes a selected card while the workbench has focus", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await openBook(page);
  const board = page.getByRole("region", { name: "工作台" });
  const document = page.getByRole("region", { name: "原文" });
  const card = board.locator('[data-card-id="excerpt-definition"]');
  await card.locator("blockquote").click();
  await expect(card).toHaveClass(/selected/);
  await document.getByRole("button", { name: "放大原文" }).focus();
  await page.keyboard.press("Delete");
  await expect(card).toBeVisible();

  await card.locator("blockquote").click();
  await page.keyboard.press("Delete");
  await expect(card).toHaveCount(0);
});


test("spatial desk moves PDF, freezes multiple cards individually, and keeps floating notes nonmodal", async ({ page }) => {
  await page.setViewportSize({ width: 1600, height: 1000 });
  await openBook(page);
  const layout = page.getByRole("button", { name: "切换桌面布局" });
  if ((await layout.textContent()) !== "并排") await layout.click();
  const cards = page.locator('.workspace-card.excerpt');
  const ids = await cards.evaluateAll((elements) => elements.slice(0, 2).map((el) => el.getAttribute('data-card-id')));
  expect(ids).toHaveLength(2);
  await page.getByRole('button', { name: '多选材料', exact: true }).click();
  for (const id of ids) await page.locator(`[data-card-id="${id}"] input[type="checkbox"]`).check();
  await page.getByRole('button', { name: '将所选材料加入问题', exact: true }).click();
  const chat = page.getByLabel('AI 问答浮窗', { exact: true });
  await expect(chat.locator('.question-material-item')).toHaveCount(2);
  await chat.getByRole('button', { name: '加入本轮问题', exact: true }).click();
  await expect(chat.locator('.question-material-item')).toHaveCount(2);
  await chat.getByRole('button', { name: '关闭问答浮窗' }).click();
  await layout.click();
  const pdf = page.locator('.pdf-pane');
  const before = await pdf.boundingBox();
  const header = pdf.locator('.reader-pane-header');
  const box = await header.boundingBox();
  await page.mouse.move(box!.x + 65, box!.y + 18); await page.mouse.down();
  await page.mouse.move(box!.x + 185, box!.y + 68, { steps: 12 }); await page.mouse.up();
  const after = await pdf.boundingBox();
  expect(after!.x - before!.x).toBeCloseTo(120, 0);
  expect(after!.y - before!.y).toBeCloseTo(50, 0);
  await page.getByRole('button', { name: '新建笔记', exact: true }).click();
  const note = page.getByLabel('笔记浮窗', { exact: true });
  await expect(note).toBeVisible();
  await note.getByLabel('笔记标题').fill('Floating desk note');
  const noteHeader = note.getByLabel('拖动移动笔记浮窗');
  const oldNote = await note.boundingBox();
  await noteHeader.focus(); await page.keyboard.press('ArrowLeft');
  expect((await note.boundingBox())!.x).toBeLessThan(oldNote!.x);
  await note.getByRole('button', { name: '关闭笔记浮窗' }).click();
  await expect(note).toHaveCount(0);
  await page.screenshot({ path: '.local/desk-production-spatial.png', fullPage: true });
  await page.reload(); await page.locator('.book-card').filter({ hasText: 'LiquidText alignment fixture' }).click();
  await expect(page.locator('.desk-spatial')).toHaveCount(1);
  await expect.poll(async () => (await page.locator('.pdf-pane').boundingBox())?.x).toBeCloseTo(after!.x, 0);
});


test("real PDF selection drags directly and contact grouping commits on release", async ({ page }) => {
  await page.setViewportSize({ width: 1800, height: 1000 });
  new Preferences(core.library).saveForBook(bookId, { deskLayout: "adjacent", splitRatio: .4 });
  const store = new Workspaces(core.library), prior = store.get(bookId);
  store.save(bookId, { ...prior, groups: [], camera: { x: 0, y: 0, zoom: 1 }, cards: prior.cards.map((card, index) =>
    ({ ...card, placed: true, x: 60 + index * 360, y: 80 })) });
  await openBook(page);
  await page.getByRole('button', { name: '选择文字（T）' }).click();
  await selectFirstPdfLine(page, 1);
  const selection = await page.evaluate(() => {
    const native = window.getSelection()!, rect = native.getRangeAt(0).getBoundingClientRect();
    return { text: native.toString(), x: rect.left + 12, y: rect.top + rect.height / 2 };
  });
  const board = await page.locator('.board-normal-view').boundingBox();
  const previousCount = await page.locator('.workspace-card').count();
  await page.mouse.move(selection.x, selection.y); await page.mouse.down();
  await page.mouse.move(board!.x + 160, board!.y + 580, { steps: 16 });
  await expect(page.locator('.desk-excerpt-drag')).toContainText(selection.text);
  await page.mouse.up();
  await expect(page.locator('.workspace-card')).toHaveCount(previousCount + 1);
  await expect(page.getByRole('toolbar', { name: '文字选区操作' })).toHaveCount(0);
  await expect.poll(() => store.get(bookId).cards.find((card) => card.text === selection.text)?.text).toBe(selection.text);
  await page.getByRole('button', { name: '指针（V）' }).click();
  const first = page.locator('[data-card-id="excerpt-definition"]');
  const second = page.locator('[data-card-id="excerpt-theorem"]');
  const a = await first.boundingBox(), b = await second.boundingBox();
  await page.mouse.move(b!.x + 80, b!.y + 12); await page.mouse.down();
  const dx = a!.x + a!.width + 5 - b!.x;
  await page.mouse.move(b!.x + 80 + dx, b!.y + 12, { steps: 8 });
  expect(store.get(bookId).groups).toEqual([]);
  await page.mouse.up();
  await expect.poll(() => store.get(bookId).groups[0]?.presentation).toBe('cluster');
  await expect(page.locator('.desk-paper-bridges path:not(.pending)')).toHaveCount(1);
  await page.screenshot({ path: '.local/desk-production-adjacent.png', fullPage: true });
});
