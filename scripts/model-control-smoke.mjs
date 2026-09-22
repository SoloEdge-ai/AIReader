import { build } from "esbuild";
import { chromium, expect } from "@playwright/test";
import { createServer } from "node:http";
import { mkdir } from "node:fs/promises";

const bundle = await build({
  entryPoints: ["tests/fixtures/model-control.tsx"],
  bundle: true,
  write: false,
  outdir: ".local/model-control",
  loader: { ".woff": "dataurl", ".woff2": "dataurl", ".ttf": "dataurl" },
});
const server = createServer((req, res) => {
  const file = bundle.outputFiles.find((f) =>
    f.path.endsWith(req.url === "/app.js" ? ".js" : ".css"),
  );
  if (req.url === "/") {
    res.setHeader("Content-Type", "text/html");
    res.end(
      '<html lang="zh-CN"><meta charset="utf-8"><link rel="stylesheet" href="/app.css"><div id="root"></div><script src="/app.js"></script></html>',
    );
  } else {
    res.setHeader(
      "Content-Type",
      req.url === "/app.js" ? "text/javascript" : "text/css",
    );
    res.end(file.contents);
  }
});
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
let browser;
try {
  browser = await chromium.launch({ channel: "msedge", headless: true });
  const page = await browser.newPage({ viewport: { width: 390, height: 640 } });
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto(`http://127.0.0.1:${server.address().port}`);
  const trigger = page.getByRole("button", { name: /模型与思考强度/ });
  await trigger.click();
  const panel = page.getByRole("dialog", { name: "模型与思考强度" });
  await expect(panel).toBeVisible();
  const slider = page.getByRole("slider", { name: "思考强度" });
  await slider.focus();
  await page.keyboard.press("ArrowRight");
  await expect(page.getByLabel("Saved choice")).toContainText(
    '"effort":"ultra"',
  );
  await page.getByRole("button", { name: "恢复模型默认强度" }).click();
  await expect(slider).toHaveAttribute("aria-valuetext", "中");
  await page
    .getByRole("radio", { name: "Reader model B", exact: true })
    .click();
  await expect(page.getByLabel("Saved choice")).toContainText(
    '"effort":"high"',
  );
  await expect(slider).toHaveCount(0);
  await page.keyboard.press("Escape");
  await expect(panel).not.toBeVisible();
  await expect(trigger).toBeFocused();
  await page.getByRole("button", { name: "Retire choice" }).click();
  await expect(trigger).toContainText("重新选择");
  await trigger.click();
  await page
    .getByRole("radio", { name: "Reader model A", exact: true })
    .click();
  await expect(slider).toHaveAttribute("aria-valuetext", "中");
  await mkdir(".local/screenshots", { recursive: true });
  await page.screenshot({ path: ".local/screenshots/model-control-light.png" });
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: "Dark", exact: true }).click();
  await trigger.click();
  await page.screenshot({ path: ".local/screenshots/model-control-dark.png" });
  // Zoom-equivalent narrow viewport: the picker must remain on-screen.
  await page.setViewportSize({ width: 320, height: 420 });
  await page.keyboard.press("Escape");
  await trigger.click();
  const box = await panel.boundingBox();
  expect(box.x).toBeGreaterThanOrEqual(0);
  expect(box.y).toBeGreaterThanOrEqual(0);
  expect(box.x + box.width).toBeLessThanOrEqual(320);
  expect(box.y + box.height).toBeLessThanOrEqual(420);
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: "Fail save" }).click();
  await trigger.click();
  await slider.focus();
  await page.keyboard.press("ArrowRight");
  await expect(page.getByRole("alert")).toHaveText("设置未保存，请重试。");
  await expect(page.getByLabel("Saved choice")).toContainText(
    '"effort":"medium"',
  );
  await expect(slider).toHaveAttribute("aria-valuetext", "中");
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: "Remove models" }).click();
  await expect(trigger).toBeDisabled();
  expect(errors).toEqual([]);
  console.log(
    "Model control: service options, persistence callback, reset, retired choice, Escape/focus and narrow layout passed.",
  );
} finally {
  await browser?.close();
  await new Promise((resolve) => server.close(resolve));
}
