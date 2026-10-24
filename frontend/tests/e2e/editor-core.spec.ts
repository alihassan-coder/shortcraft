import {
  expect,
  focusStage,
  frameRatio,
  openEditor,
  reloadEditor,
  savedPlan,
  test,
  totalSeconds,
} from "./fixtures";

test.beforeEach(async ({ page }) => {
  await openEditor(page);
});

test("play and pause", async ({ page }) => {
  const time = page.locator("[data-time]");
  await expect(time).toHaveText("0:00.0");

  await page.getByRole("button", { name: "Play", exact: true }).click();
  await expect(page.getByRole("button", { name: "Pause", exact: true })).toBeVisible();
  await expect.poll(() => time.textContent(), { timeout: 10_000 }).not.toBe("0:00.0");

  await page.getByRole("button", { name: "Pause", exact: true }).click();
  await expect(page.getByRole("button", { name: "Play", exact: true })).toBeVisible();
  const paused = await time.textContent();
  await page.waitForTimeout(400);
  await expect(time).toHaveText(paused!);
});

test("cut a word with Delete, undo with Ctrl+Z", async ({ page }) => {
  const word = page.locator('[data-word="w21"]');
  await word.click();
  await page.keyboard.press("Delete");
  await expect(word).toHaveClass(/line-through/);

  await page.keyboard.press("ControlOrMeta+z");
  await expect(word).not.toHaveClass(/line-through/);
});

test("prompt 'make it calmer' applies and survives a reload", async ({ page }) => {
  const prompt = page.getByRole("textbox", { name: "Describe a change" });
  await prompt.fill("make it calmer");
  await prompt.press("Enter");
  await expect.poll(async () => (await savedPlan(page))?.captions.presetId, { timeout: 10_000 }).toBe("clean");

  await reloadEditor(page);
  expect((await savedPlan(page))?.captions.presetId).toBe("clean");
});

test("command palette sets the aspect ratio to 1:1", async ({ page }) => {
  expect(await frameRatio(page)).toBeCloseTo(9 / 16, 1);

  await page.keyboard.press("ControlOrMeta+k");
  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible();
  await page.keyboard.type("1:1");
  await expect(dialog.locator("[cmdk-item][data-selected=true]")).toContainText("1:1");
  await page.keyboard.press("Enter");

  await expect(dialog).toBeHidden();
  await expect.poll(() => frameRatio(page)).toBeCloseTo(1, 1);
  await expect.poll(async () => (await savedPlan(page))?.canvas.aspect).toBe("1:1");
});

test("split from the Edit menu creates a second clip", async ({ page }) => {
  await focusStage(page);
  for (let i = 0; i < 3; i++) await page.keyboard.press("l");
  await expect(page.locator("[data-time]")).toHaveText("0:03.0");

  await page.getByRole("menuitem", { name: "Edit" }).click();
  await page.locator('[data-action="split"]').click();
  await expect.poll(async () => (await savedPlan(page))?.clips.length).toBe(2);
});

test("clip speed 2× halves the duration, undo restores it", async ({ page }) => {
  const before = await totalSeconds(page);
  expect(before).toBeGreaterThan(1);

  await page.getByRole("button", { name: "Select clip on screen" }).click();
  await expect(page.locator("[data-inspector]")).toHaveAttribute("data-inspector", "clip");
  await page.getByRole("group", { name: "Speed" }).getByRole("button", { name: "2×", exact: true }).click();
  await expect.poll(() => totalSeconds(page)).toBeCloseTo(before / 2, 0);

  await focusStage(page);
  await page.keyboard.press("ControlOrMeta+z");
  await expect.poll(() => totalSeconds(page)).toBe(before);
});

test("custom canvas size 1000×1000", async ({ page }) => {
  await expect(page.locator("[data-inspector]")).toHaveAttribute("data-inspector", "project");
  for (const label of ["W", "H"]) {
    const input = page.getByRole("textbox", { name: label, exact: true });
    await input.fill("1000");
    await input.press("Enter");
  }

  await expect
    .poll(async () => {
      const c = (await savedPlan(page))?.canvas;
      return c && `${c.width}x${c.height} ${c.aspect}`;
    })
    .toBe("1000x1000 custom");
  await expect.poll(() => frameRatio(page)).toBeCloseTo(1, 1);
});
