import { expect, test, type Page } from "@playwright/test";

async function openPalette(page: Page, dock?: "bottom" | "left" | "right") {
  const failures: string[] = [];
  page.on("pageerror", (error) => failures.push(error.message));
  page.on("response", (response) => {
    if (response.status() >= 500) failures.push(`${response.status()} ${response.url()}`);
  });
  const url = `http://127.0.0.1:5173/tests/palette.html${dock ? `?dock=${dock}` : ""}`;
  await page.goto(url);
  const toolbar = page.getByRole("toolbar", { name: "阅读工具盘" });
  try { await expect(toolbar).toBeVisible({ timeout: 5_000 }); }
  catch {
    // A Vite-only harness may navigate before its module is served on a busy
    // Windows runner. Retry once; persistent failure retains diagnostics.
    const firstBody = await page.locator("body").innerText().catch(() => "<unavailable>");
    await page.reload();
    try { await expect(toolbar).toBeVisible({ timeout: 10_000 }); }
    catch { throw new Error(`Palette harness did not mount. First body: ${firstBody}; errors: ${failures.join(" | ")}`); }
    console.warn(`Palette harness required one reload: ${url}; first body: ${firstBody}; errors: ${failures.join(" | ")}`);
  }
}

for (const dock of ["bottom", "left", "right"] as const)
  test(`collapsed ${dock} palette stays at the click location`, async ({
    page,
  }) => {
    await openPalette(page, dock);
    const collapse = page.getByRole("button", { name: "收起工具盘" });
    await collapse.scrollIntoViewIfNeeded();
    const before = await collapse.boundingBox();
    expect(before).not.toBeNull();
    await page.mouse.click(
      before!.x + before!.width / 2,
      before!.y + before!.height / 2,
    );
    const after = await page
      .getByRole("button", { name: /展开工具盘/ })
      .boundingBox();
    expect(after).not.toBeNull();
    const axis = dock === "bottom" ? "x" : "y";
    const dimension = dock === "bottom" ? "width" : "height";
    const beforeCenter = before![axis] + before![dimension] / 2;
    const afterCenter = after![axis] + after![dimension] / 2;
    expect(Math.abs(afterCenter - beforeCenter)).toBeLessThanOrEqual(24);
    if (dock === "bottom")
      await page.screenshot({ path: "test-results/palette-collapsed.png" });
    await page.getByRole("button", { name: /展开工具盘/ }).click();
    const expanded = await collapse.boundingBox();
    expect(expanded).not.toBeNull();
    expect(
      Math.abs(expanded![axis] + expanded![dimension] / 2 - beforeCenter),
    ).toBeLessThanOrEqual(2);
  });

test("keyboard collapse stays beside the focused button", async ({ page }) => {
  await openPalette(page);
  const collapse = page.getByRole("button", { name: "收起工具盘" });
  const before = await collapse.boundingBox();
  expect(before).not.toBeNull();
  await collapse.focus();
  await page.keyboard.press("Enter");
  const after = await page
    .getByRole("button", { name: /展开工具盘/ })
    .boundingBox();
  expect(after).not.toBeNull();
  expect(
    Math.abs(after!.x + after!.width / 2 - before!.x - before!.width / 2),
  ).toBeLessThanOrEqual(24);
});

test("dragging the handle docks the palette at the nearest edge", async ({ page }) => {
  await openPalette(page);
  const grip = page.getByRole("button", { name: "拖动工具盘" });
  const box = await grip.boundingBox();
  expect(box).not.toBeNull();
  await page.mouse.move(box!.x + box!.width / 2, box!.y + box!.height / 2);
  await page.mouse.down();
  await page.mouse.move(20, page.viewportSize()!.height / 2, { steps: 12 });
  await page.mouse.up();
  await expect(page.getByRole("toolbar", { name: "阅读工具盘" })).toHaveAttribute("data-dock", "left");
  const after = await grip.boundingBox();
  expect(after).not.toBeNull();
  expect(after!.x).toBeLessThan(70);
});

for (const dock of ["bottom", "left", "right"] as const)
  test(`${dock} palette menu uses the shared bounded popover`, async ({ page }) => {
    await openPalette(page, dock);
    const trigger = page.getByRole("button", { name: "添加形状" });
    const triggerBox = await trigger.boundingBox();
    expect(triggerBox).not.toBeNull();
    await trigger.click();
    const menu = page.getByRole("menu", { name: "添加形状" });
    await expect(menu).toBeVisible();
    if (dock === "bottom")
      await page.screenshot({ path: "test-results/palette-menu-bottom.png" });
    const box = await menu.boundingBox();
    const viewport = page.viewportSize();
    expect(box).not.toBeNull();
    expect(viewport).not.toBeNull();
    expect(box!.x).toBeGreaterThanOrEqual(7);
    expect(box!.y).toBeGreaterThanOrEqual(7);
    expect(box!.x + box!.width).toBeLessThanOrEqual(viewport!.width - 7);
    expect(box!.y + box!.height).toBeLessThanOrEqual(viewport!.height - 7);
    if (dock === "bottom") expect(box!.y + box!.height).toBeLessThanOrEqual(triggerBox!.y + 2);
    if (dock === "left") expect(box!.x).toBeGreaterThanOrEqual(triggerBox!.x + triggerBox!.width - 2);
    if (dock === "right") expect(box!.x + box!.width).toBeLessThanOrEqual(triggerBox!.x + 2);
    await expect(menu.getByRole("menuitem", { name: "矩形" })).toBeFocused();
    await page.keyboard.press("ArrowDown");
    await expect(menu.getByRole("menuitem", { name: "椭圆" })).toBeFocused();
    await page.keyboard.press("Escape");
    await expect(menu).toBeHidden();
  });

for (const dock of ["bottom", "left", "right"] as const)
  test(`${dock} brush settings share bounded placement and keep two-click activation`, async ({ page }) => {
    await openPalette(page, dock);
    const pen = page.getByRole("button", { name: "画笔（P）" });
    await pen.click();
    await expect(pen).toHaveAttribute("aria-pressed", "true");
    const settings = page.getByRole("dialog", { name: "画笔设置" });
    await expect(settings).toBeHidden();
    await pen.click();
    await expect(settings).toBeVisible();
    if (dock === "bottom")
      await page.screenshot({ path: "test-results/palette-brush-settings.png" });
    const box = await settings.boundingBox(), viewport = page.viewportSize();
    expect(box).not.toBeNull();
    expect(viewport).not.toBeNull();
    expect(box!.x).toBeGreaterThanOrEqual(7);
    expect(box!.y).toBeGreaterThanOrEqual(7);
    expect(box!.x + box!.width).toBeLessThanOrEqual(viewport!.width - 7);
    expect(box!.y + box!.height).toBeLessThanOrEqual(viewport!.height - 7);
    await page.keyboard.press("Escape");
    await expect(settings).toBeHidden();
  });
