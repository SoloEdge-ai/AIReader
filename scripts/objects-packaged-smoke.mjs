import { _electron as electron, expect } from "@playwright/test";
import { PDFDocument } from "pdf-lib";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

await mkdir(".local", { recursive: true });
const pdf = await PDFDocument.create();
pdf.addPage([400, 320]).drawText("Object package page", { x: 30, y: 260 });
const fixture = resolve(".local/objects-packaged-fixture.pdf");
await writeFile(fixture, await pdf.save());
const app = await electron.launch({
  executablePath: resolve(process.argv[2] ?? "release/win-unpacked/AIReader.exe"),
  env: { ...process.env, ELECTRON_RUN_AS_NODE: undefined,
    AIREADER_DATA: resolve(`.local/objects-packaged-${Date.now()}`) },
});
try {
  const page = await app.firstWindow();
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.locator('input[type=file][accept="application/pdf"]').setInputFiles(fixture);
  await expect(page.locator("#page-1")).toHaveAttribute("data-render-ready", "true");
  await expect(page.locator(".pdf-scroll")).toHaveAttribute("data-workspace-ready", "true", { timeout: 15_000 });
  const first = await page.locator("#page-1").boundingBox();
  await page.getByRole("button", { name: "添加文本或卡片" }).click();
  await page.getByRole("menuitem", { name: "文本" }).click();
  await page.mouse.click(first.x + 100, first.y + 110);
  await page.getByLabel("编辑画布文本").fill("Packaged note");
  await page.getByLabel("编辑画布文本").press("Tab");
  const workspace = async () => page.evaluate(async () => {
    const books = await (await fetch("/api/books")).json();
    return (await fetch(`/api/books/${books[0].id}/workspace`)).json();
  });
  await expect.poll(async () => (await workspace()).objects.length).toBe(1);
  await page.getByRole("button", { name: "添加形状" }).click();
  await page.getByRole("menuitem", { name: "矩形" }).click();
  await page.mouse.move(first.x + 60, first.y + 180);
  await page.mouse.down();
  await page.mouse.move(first.x + 160, first.y + 230, { steps: 6 });
  await page.mouse.up();
  await expect.poll(async () => (await workspace()).objects.length).toBe(2);
  await page.getByRole("button", { name: "返回书库" }).click();
  await page.locator(".book-card").first().click();
  await expect(page.getByRole("button", { name: "指针（V）" }))
    .toHaveAttribute("aria-pressed", "true");
  expect((await workspace()).objects.map((object) => object.kind)).toEqual(["text", "shape"]);
  expect(errors).toEqual([]);
  console.log("Packaged text, shape, and restart acceptance passed.");
} finally {
  await app.close();
}
