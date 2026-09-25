import { chromium, expect } from "@playwright/test";
import { PDFDocument } from "pdf-lib";
import { mkdtemp, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { createCore } from "../apps/core/src/server";

const data = await mkdtemp(join(tmpdir(), "aireader-ink-smoke-"));
await mkdir(".local/screenshots", { recursive: true });
const core = createCore(data, resolve("dist/web"));
const pdf = await PDFDocument.create();
pdf.addPage([400, 300]).drawText("First page", { x: 30, y: 240 });
pdf.addPage([400, 300]).drawText("Second page", { x: 30, y: 240 });
const book = await core.library.import(Buffer.from(await pdf.save()), "Ink acceptance.pdf");
await core.library.waitForBook(book.id);
await new Promise<void>((done) => core.server.listen(0, "127.0.0.1", done));
const address = core.server.address();
if (!address || typeof address === "string") throw new Error("Missing port");
const origin = `http://127.0.0.1:${address.port}`;
const browser = await chromium.launch({ channel: "msedge", headless: true });
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  const errors: string[] = [];
  const commandResponses: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("response", (response) => {
    if (response.url().includes("/workspace/commands"))
      commandResponses.push(`${response.status()} ${response.request().method()}`);
  });
  await page.goto(origin);
  await page.getByRole("button", { name: /Ink acceptance/ }).click();
  await expect(page.locator("#page-2")).toHaveAttribute("data-render-ready", "true");
  await expect(page.locator(".pdf-scroll")).toHaveAttribute("data-workspace-ready", "true", { timeout: 15_000 });
  const first = (await page.locator("#page-1").boundingBox())!;
  const second = (await page.locator("#page-2").boundingBox())!;
  await page.getByRole("button", { name: "画笔（P）" }).click();
  await expect(page.getByRole("button", { name: "画笔（P）" })).toHaveAttribute("aria-pressed", "true");
  await page.mouse.move(first.x + 100, first.y + first.height - 70);
  await page.mouse.down();
  await page.mouse.move(second.x + 100, second.y + 70, { steps: 30 });
  await page.mouse.up();
  const endpoint = `${origin}/api/books/${book.id}/workspace`;
  try {
    await expect.poll(async () => (await (await page.request.get(endpoint)).json()).objects.length,
      { timeout: 10_000 }).toBe(1);
  } catch (cause) {
    const snapshot = await (await page.request.get(endpoint)).json();
    throw new Error(`First ink stroke was not saved: ${JSON.stringify({
      revision: snapshot.revision, objects: snapshot.objects.length,
      workspaceReady: await page.locator(".pdf-scroll").getAttribute("data-workspace-ready"),
      feedback: await page.locator(".workspace-feedback").allTextContents(),
      commandResponses, pageErrors: errors,
    })}`, { cause });
  }
  const stored = await (await page.request.get(endpoint)).json();
  expect(stored.objects[0].segments.map((segment: { surface: { kind: string; page?: number } }) =>
    segment.surface.kind === "pdf" ? segment.surface.page : "board")).toEqual([1, "board", 2]);
  await page.screenshot({ path: ".local/screenshots/ink-cross-page.png" });
  await page.getByRole("button", { name: "画笔（P）" }).click();
  const settings = page.getByRole("dialog", { name: "画笔设置" });
  await expect(settings).toBeVisible();
  await settings.getByRole("button", { name: "粗细 8" }).click();
  await settings.getByRole("button", { name: "颜色 #d35e45" }).click();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("button", { name: "画笔（P）" })).toHaveAttribute("aria-pressed", "true");
  await page.keyboard.press("Escape");
  await expect(page.getByRole("button", { name: "指针（V）" })).toHaveAttribute("aria-pressed", "true");
  await page.getByRole("button", { name: "画笔（P）" }).click();
  await expect(page.getByRole("button", { name: "画笔（P）" })).toHaveAttribute("aria-pressed", "true");
  const reading = (await page.locator(".reading").boundingBox())!;
  await page.mouse.move(reading.x + 160, reading.y + 250);
  await page.mouse.down();
  await page.mouse.move(reading.x + 220, reading.y + 270, { steps: 8 });
  await page.mouse.up();
  await expect.poll(async () => (await (await page.request.get(endpoint)).json()).objects.length).toBe(2);
  const two = await (await page.request.get(endpoint)).json();
  expect(two.objects[1]).toMatchObject({ brush: "pen", width: 8, color: "#d35e45" });
  expect(two.objects[1].segments[0].surface.kind).toBe("board");
  await page.getByRole("button", { name: "整笔橡皮（E）" }).click();
  await page.mouse.click(second.x + 100, second.y + 70);
  await expect.poll(async () => (await (await page.request.get(endpoint)).json()).objects.length).toBe(1);
  await page.getByRole("button", { name: /工作区操作/ }).click();
  await page.getByRole("menuitem", { name: "撤销工作区修改" }).click();
  await expect.poll(async () => (await (await page.request.get(endpoint)).json()).objects.length).toBe(2);
  await page.reload();
  await page.getByRole("button", { name: /Ink acceptance/ }).click();
  await expect(page.locator(".pdf-scroll")).toHaveAttribute("data-workspace-ready", "true", { timeout: 15_000 });
  await expect(page.getByRole("button", { name: "指针（V）" })).toHaveAttribute("aria-pressed", "true");
  expect((await (await page.request.get(endpoint)).json()).objects).toHaveLength(2);
  await page.getByRole("button", { name: "画笔（P）" }).click();
  await page.getByRole("button", { name: "画笔（P）" }).click();
  await expect(page.getByRole("dialog", { name: "画笔设置" }).getByRole("button", { name: "粗细 8" })).toHaveAttribute("aria-pressed", "true");
  await page.keyboard.press("Escape");
  await expect(page.getByRole("button", { name: "画笔（P）" })).toHaveAttribute("aria-pressed", "true");
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: "画笔（P）" }).click();
  await expect(page.getByRole("button", { name: "画笔（P）" })).toHaveAttribute("aria-pressed", "true");
  const afterRestart = (await page.locator("#page-1").boundingBox())!;
  await page.mouse.move(afterRestart.x + 70, afterRestart.y + 160);
  await page.mouse.down();
  await page.mouse.move(afterRestart.x + 100, afterRestart.y + 180, { steps: 5 });
  await page.keyboard.press("Escape");
  await page.mouse.up();
  expect((await (await page.request.get(endpoint)).json()).objects).toHaveLength(2);
  await page.getByRole("button", { name: "画笔（P）" }).click();
  const beforePan = (await page.locator("#page-1").boundingBox())!;
  await page.mouse.move(beforePan.x + 90, beforePan.y + 170);
  await page.mouse.down({ button: "left" });
  await page.mouse.move(beforePan.x + 110, beforePan.y + 175, { steps: 4 });
  await page.mouse.down({ button: "right" });
  await page.mouse.move(beforePan.x + 145, beforePan.y + 175, { steps: 3 });
  await page.mouse.move(beforePan.x + 210, beforePan.y + 175, { steps: 5 });
  await page.mouse.up({ button: "right" });
  await page.mouse.up({ button: "left" });
  await expect.poll(async () => (await (await page.request.get(endpoint)).json()).objects.length).toBe(3);
  expect((await page.locator("#page-1").boundingBox())!.x - beforePan.x).toBeGreaterThan(45);
  await expect(page.getByRole("button", { name: "画笔（P）" })).toHaveAttribute("aria-pressed", "true");
  const beforeSpace = (await page.locator("#page-1").boundingBox())!;
  await page.mouse.move(beforeSpace.x + 70, beforeSpace.y + 150);
  await page.mouse.down();
  await page.mouse.move(beforeSpace.x + 85, beforeSpace.y + 153, { steps: 3 });
  await page.keyboard.down("Space");
  await page.mouse.move(beforeSpace.x + 160, beforeSpace.y + 153, { steps: 5 });
  await page.keyboard.up("Space");
  await page.mouse.up();
  await expect.poll(async () => (await (await page.request.get(endpoint)).json()).objects.length).toBe(4);
  expect((await page.locator("#page-1").boundingBox())!.x - beforeSpace.x).toBeGreaterThan(55);
  async function excerpt(includeInk: boolean) {
    const before = await page.locator(".workspace-card.region").count();
    await page.getByRole("button", { name: "区域摘录（R）" }).click();
    const box = (await page.locator("#page-1").boundingBox())!;
    await page.mouse.move(box.x + 70, box.y + box.height - 100);
    await page.mouse.down();
    await page.mouse.move(box.x + 140, box.y + box.height - 25, { steps: 5 });
    await page.mouse.up();
    const actions = page.getByRole("toolbar", { name: "区域摘录操作" });
    if (includeInk) await actions.getByLabel("包含个人标注").check();
    await actions.getByRole("button", { name: "创建图片卡片" }).click();
    await expect(page.locator(".workspace-card.region")).toHaveCount(before + 1);
    const workspace = await (await page.request.get(endpoint)).json();
    return Buffer.from(await (await page.request.get(`${origin}/api/books/${book.id}/workspace-assets/${workspace.cards.at(-1).region.assetId}`)).body());
  }
  const plain = await excerpt(false);
  const marked = await excerpt(true);
  expect(marked.equals(plain)).toBe(false);
  expect(errors).toEqual([]);
  console.log("Cross-page ink, board ink, brush settings, whole-stroke eraser, undo and restart passed.");
} finally {
  await browser.close();
  core.close();
}
