import { expect, test } from "@playwright/test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { PDFDocument, StandardFonts } from "pdf-lib";
import { createCore } from "../apps/core/src/server";

let directory: string;
let core: ReturnType<typeof createCore>;

test.beforeAll(async () => {
  directory = await mkdtemp(join(tmpdir(), "aireader-workspace-menu-test-"));
  core = createCore(directory, resolve("dist/web"));
  const pdf = await PDFDocument.create();
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  pdf
    .addPage([500, 700])
    .drawText("Workspace menu fixture", { x: 50, y: 600, font, size: 20 });
  const book = await core.library.import(
    Buffer.from(await pdf.save()),
    "Workspace menu fixture.pdf",
  );
  await core.library.waitForBook(book.id);
  await new Promise<void>((resolveListen) =>
    core.server.listen(43120, "127.0.0.1", resolveListen),
  );
});

test.afterAll(async () => {
  core?.close();
  if (directory) await rm(directory, { recursive: true, force: true });
});

test("workspace actions live in the reader header, not over the PDF", async ({
  page,
}) => {
  await page.goto("http://127.0.0.1:5173/");
  await page.getByText("Workspace menu fixture", { exact: true }).click();
  await expect(page.locator(".pdf-page").first()).toBeVisible();
  const actions = page.getByRole("button", { name: /工作区操作/ });
  await expect(actions).toBeVisible();
  await expect(page.locator(".workspace-toolbar")).toHaveCount(0);
  await actions.click();
  await expect(page.getByRole("menu", { name: "工作区操作" })).toBeVisible();
  await page.screenshot({ path: "test-results/workspace-menu.png" });
  await expect(page.getByRole("menuitem", { name: "定位正文" })).toBeVisible();
  await expect(
    page.getByRole("menuitem", { name: "打包工作区" }),
  ).toBeVisible();
  await expect(
    page.getByRole("menuitem", { name: "＋ 笔记卡片" }),
  ).toBeFocused();
  await page.keyboard.press("ArrowDown");
  await expect(page.getByRole("menuitem", { name: "定位正文" })).toBeFocused();
  await page.setViewportSize({ width: 960, height: 720 });
  const menu = await page
    .getByRole("menu", { name: "工作区操作" })
    .boundingBox();
  expect(menu).not.toBeNull();
  expect(menu!.x + menu!.width).toBeLessThanOrEqual(960);
  await page.keyboard.press("Escape");
  await expect(page.getByRole("menu", { name: "工作区操作" })).toHaveCount(0);
  await expect(actions).toBeFocused();
});
