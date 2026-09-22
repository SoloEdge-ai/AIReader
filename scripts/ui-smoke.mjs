import { chromium } from "@playwright/test";
import { spawn } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import { PDFDocument, StandardFonts } from "pdf-lib";
import { resolve } from "node:path";
await mkdir(".local/screenshots", { recursive: true });
const fixture = resolve(".local/ui-fixture.pdf");
if (!process.argv[2]) {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  doc.addPage().drawText("Inference memory isolation", { font });
  await writeFile(fixture, await doc.save());
}
const core = spawn(process.execPath, ["dist/core/main.cjs"], {
  env: {
    ...process.env,
    AIREADER_PORT: "43129",
    AIREADER_DATA: resolve(".local/ui-library"),
    AIREADER_WEB: resolve("dist/web"),
  },
  stdio: ["ignore", "pipe", "pipe"],
  windowsHide: true,
});
let browser;
try {
  await new Promise((resolve, reject) => {
    core.stdout.on("data", (chunk) => {
      if (String(chunk).includes("http://")) resolve();
    });
    core.on("exit", (code) => reject(new Error("Core exit " + code)));
    core.stderr.on("data", (chunk) => console.log(String(chunk)));
    setTimeout(() => reject(new Error("Core timeout")), 10000).unref();
  });
  browser = await chromium.launch({ channel: "msedge", headless: true });
  const page = await browser.newPage({
    viewport: { width: 1440, height: 1000 },
  });
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("http://127.0.0.1:43129");
  await page.getByRole("heading", { name: "书库", exact: true }).waitFor();
  await page.screenshot({ path: ".local/screenshots/library.png" });
  await page
    .locator("input[type=file]")
    .setInputFiles(process.argv[2] ?? fixture);
  await page.locator(".pdf-page canvas").first().waitFor();
  await page.waitForFunction(
    () => document.querySelector(".textLayer span")?.textContent,
    { timeout: 20000 },
  );
  await page.screenshot({ path: ".local/screenshots/reader.png" });
  await page.locator('[data-book-status="ready"]').waitFor({ timeout: 60000 });
  await page
    .getByRole("button", { name: "书内搜索", exact: true })
    .first()
    .click();
  await page
    .getByLabel("书内搜索文字")
    .fill(process.argv[2] ? "推理" : "memory");
  await page
    .locator("form")
    .getByRole("button", { name: "查找", exact: true })
    .click();
  await page.locator(".search-hit").first().waitFor();
  await page.locator(".search-hit").first().click();
  await page.waitForTimeout(500);
  await page.screenshot({ path: ".local/screenshots/search.png" });
  console.log(
    JSON.stringify({
      pageErrors: errors,
      pages: await page.locator(".pdf-page").count(),
      searchResults: await page.locator(".search-hit").count(),
    }),
  );
  if (errors.length) throw new Error(errors.join("\n"));
} finally {
  await browser?.close();
  core.kill();
}
