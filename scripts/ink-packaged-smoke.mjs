import { _electron as electron, expect } from "@playwright/test";
import { PDFDocument } from "pdf-lib";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

await mkdir(".local", { recursive: true });
const pdf = await PDFDocument.create();
pdf.addPage([400, 300]).drawText("Ink package first page", { x: 30, y: 240 });
pdf.addPage([400, 300]).drawText("Ink package second page", { x: 30, y: 240 });
const fixture = resolve(".local/ink-packaged-fixture.pdf");
await writeFile(fixture, await pdf.save());
const app = await electron.launch({
  executablePath: resolve(process.argv[2] ?? "release/win-unpacked/AIReader.exe"),
  env: { ...process.env, ELECTRON_RUN_AS_NODE: undefined,
    AIREADER_DATA: resolve(`.local/ink-packaged-${Date.now()}`) },
});
try {
  const page = await app.firstWindow();
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.locator('input[type=file][accept="application/pdf"]').setInputFiles(fixture);
  await page.locator("#page-2").waitFor();
  await expect(page.locator("#page-2")).toHaveAttribute("data-render-ready", "true");
  const first = await page.locator("#page-1").boundingBox();
  const second = await page.locator("#page-2").boundingBox();
  await page.getByRole("button", { name: "画笔（P）" }).click();
  await page.mouse.move(first.x + 100, first.y + first.height - 60);
  await page.mouse.down();
  await page.mouse.move(second.x + 100, second.y + 60, { steps: 24 });
  await page.mouse.up();
  const workspace = async () => page.evaluate(async () => {
    const books = await (await fetch("/api/books")).json();
    return (await fetch(`/api/books/${books[0].id}/workspace`)).json();
  });
  await expect.poll(async () => (await workspace()).objects.length).toBe(1);
  expect((await workspace()).objects[0].segments.map((segment) =>
    segment.surface.kind === "pdf" ? segment.surface.page : "board"))
    .toEqual([1, "board", 2]);
  await page.getByRole("button", { name: "返回书库" }).click();
  await page.locator(".book-card").first().click();
  await expect(page.getByRole("button", { name: "指针（V）" }))
    .toHaveAttribute("aria-pressed", "true");
  expect((await workspace()).objects).toHaveLength(1);
  expect(errors).toEqual([]);
  console.log("Packaged cross-page ink and restart acceptance passed.");
} finally {
  await app.close();
}
