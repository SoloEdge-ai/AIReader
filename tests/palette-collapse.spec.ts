import { expect, test } from "@playwright/test";

for (const dock of ["bottom", "left", "right"] as const)
  test(`collapsed ${dock} palette stays at the click location`, async ({
    page,
  }) => {
    await page.goto(`http://127.0.0.1:5173/tests/palette.html?dock=${dock}`);
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
  await page.goto("http://127.0.0.1:5173/tests/palette.html");
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
  await page.goto("http://127.0.0.1:5173/tests/palette.html");
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
