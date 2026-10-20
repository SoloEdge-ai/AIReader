import { _electron as electron, expect } from "@playwright/test";
import { mkdtemp, mkdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { PDFDocument } from "pdf-lib";
import { Library } from "../apps/core/src/library";
import { Workspaces } from "../apps/core/src/workspace";
import { WorkspaceAssets } from "../apps/core/src/workspace-assets";
import { Notes } from "../apps/core/src/notes";
import { QuestionMaterials } from "../apps/core/src/question-materials";
import { Preferences } from "../apps/core/src/preferences";
import type { ChatTurn } from "../packages/protocol/src";
import type { BookWorkspace } from "../packages/protocol/src/workspace";

const executable = resolve(process.argv[2] ?? "release/win-unpacked/AIReader.exe");
const directory = await mkdtemp(join(tmpdir(), "aireader-inquiry-packaged-"));
const library = new Library(directory);
let desktop: Awaited<ReturnType<typeof electron.launch>> | undefined;
let libraryOpen = true;
try {
  const pdf = await PDFDocument.create();
  pdf.addPage([500, 700]).drawText("Selected original evidence for a packaged inquiry.", { x: 40, y: 620, size: 12 });
  const book = await library.import(Buffer.from(await pdf.save()), "Packaged canvas inquiry.pdf");
  await library.waitForBook(book.id);
  new Preferences(library).saveForBook(book.id, { deskLayout: "adjacent", splitRatio: .3 });
  const workspaces = new Workspaces(library);
  const workspace = workspaces.save(book.id, { ...workspaces.get(book.id), cards: [{ id: "source-card", kind: "excerpt",
    title: "原文依据", text: "Selected original evidence for a packaged inquiry.", comment: "",
    x: 30, y: 100, width: 250, height: 160, source: { fingerprint: book.fingerprint,
      anchors: [{ page: 1, rects: [[35, 610, 470, 640]] }] } }] });
  const sessionId = "packaged-session";
  library.chat.saveSession(book.id, { id: sessionId, title: "材料探究", updatedAt: new Date().toISOString() });
  const assets = new WorkspaceAssets(library, workspaces);
  const materials = new QuestionMaterials(library, workspaces, new Notes(library, assets), assets);
  const material = await materials.create(book.id, { bookId: book.id, sessionId, requestId: "packaged-freeze",
    workspaceRevision: workspace.revision, targets: [{ kind: "card", id: "source-card" }], previews: [] });
  const citation = material.sections[0].citation;
  if (!citation) throw new Error("Generated fixture text could not be verified");
  const turn: ChatTurn = { id: "packaged-turn", bookId: book.id, sessionId, question: "这段材料能说明什么？",
    answer: `这段材料提供了本轮分析的原文依据。[[${citation.passageId}]]`, status: "complete",
    createdAt: new Date().toISOString(), citations: [citation], tools: [], materialIds: [material.id],
    inquiry: { action: "explain", targetIds: ["source-card"], bounds: { x: 30, y: 100, width: 250, height: 160 } },
    context: { estimatedTokens: 400, budget: 12000, coverage: "仅所选材料", reading: { bookId: book.id,
      page: 1, scope: "materials", selection: "" }, memory: "", navigation: "", recent: "",
      materials: [material], evidence: [{ id: citation.passageId, bookId: book.id, page: 1,
        text: material.sections[0].text, anchor: citation }] } };
  library.chat.createTurn(turn, () => materials.commit(book.id, sessionId, [material.id], turn.id));
  library.close(); libraryOpen = false;
  const environment: Record<string, string> = {};
  for (const [key, value] of Object.entries(process.env))
    if (key !== "ELECTRON_RUN_AS_NODE" && value !== undefined) environment[key] = value;
  environment.AIREADER_CI = "1";
  environment.AIREADER_DATA = directory;
  const launch = async () => {
    desktop = await electron.launch({ executablePath: executable, args: [], env: environment });
    const page = await desktop.firstWindow();
    await page.setViewportSize({ width: 1600, height: 1000 });
    await page.locator(".book-card").filter({ hasText: "Packaged canvas inquiry" }).click();
    const chat = page.getByLabel("AI 问答浮窗");
    if (!(await chat.isVisible())) await page.getByRole("button", { name: "问答", exact: true }).click();
    return { page, chat };
  };
  let { page, chat } = await launch();
  await chat.getByRole("button", { name: "保存到此处" }).click();
  await expect(chat.getByRole("button", { name: "查看卡片" })).toBeVisible();
  const board = await page.evaluate(async (id): Promise<BookWorkspace> =>
    (await fetch(`/api/books/${id}/workspace`)).json(), book.id);
  const answer = board.cards.find((card) => card.kind === "note");
  if (!answer || answer.x <= 280) throw new Error("Packaged Core did not place the answer beside its source");
  await chat.getByRole("button", { name: "查看卡片" }).click();
  await chat.getByRole("button", { name: "关闭问答浮窗" }).click();
  await expect(page.locator(`[data-card-id="${answer.id}"]`).getByText("使用材料 · 1 项")).toBeVisible();
  await expect(page.locator('[data-kind="material-use"]')).toHaveCount(1);
  await mkdir(".local/screenshots", { recursive: true });
  await page.screenshot({ path: ".local/screenshots/canvas-inquiry-packaged.png" });
  await desktop!.close(); desktop = undefined;
  ({ page, chat } = await launch());
  await expect(chat.getByRole("button", { name: "查看卡片" })).toBeVisible();
  const reopened = await page.evaluate(async (id): Promise<BookWorkspace> =>
    (await fetch(`/api/books/${id}/workspace`)).json(), book.id);
  if (reopened.cards.filter((card) => card.noteId === answer.noteId).length !== 1)
    throw new Error("Packaged answer placement did not survive restart uniquely");
  await desktop!.close(); desktop = undefined;
  console.log("Packaged canvas inquiry: verified source, atomic save, material-use connection, close/reopen passed");
} finally {
  await desktop?.close();
  if (libraryOpen) library.close();
  await rm(directory, { recursive: true, force: true });
}
