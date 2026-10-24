import type { Locator, Page } from "@playwright/test";
import { expect, focusStage, openEditor, reloadEditor, test } from "./fixtures";

const width = (l: Locator) => l.evaluate((el) => Math.round(el.getBoundingClientRect().width));
const height = (l: Locator) => l.evaluate((el) => Math.round(el.getBoundingClientRect().height));

/** Drag a separator by (dx, dy) pixels with real mouse events. */
async function drag(page: Page, separator: Locator, dx: number, dy: number) {
  const box = (await separator.boundingBox())!;
  const x = box.x + box.width / 2;
  const y = box.y + box.height / 2;
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x + dx / 2, y + dy / 2, { steps: 5 });
  await page.mouse.move(x + dx, y + dy, { steps: 5 });
  await page.mouse.up();
}

test.beforeEach(async ({ page }) => {
  await openEditor(page);
});

test.describe("desktop", () => {
  test.skip(({ viewport }) => (viewport?.width ?? 0) < 1280, "desktop layout only");

  test("[ ] \ collapse and expand the panels", async ({ page }) => {
    const assets = page.locator("#assets");
    const inspector = page.locator("#inspector");
    const timeline = page.locator("#timeline");
    const open = { assets: await width(assets), inspector: await width(inspector), timeline: await height(timeline) };
    expect(open.assets).toBeGreaterThan(200);
    expect(open.inspector).toBeGreaterThan(200);
    expect(open.timeline).toBeGreaterThan(100);

    await focusStage(page);
    await page.keyboard.press("[");
    await expect.poll(() => width(assets)).toBe(0);
    await page.keyboard.press("]");
    await expect.poll(() => width(inspector)).toBeLessThanOrEqual(41);
    await expect(page.getByRole("button", { name: "Show inspector" })).toBeVisible();
    await page.keyboard.press("\\");
    await expect.poll(() => height(timeline)).toBeLessThanOrEqual(33);
    await expect(page.getByRole("button", { name: "Show timeline" })).toBeVisible();

    await page.keyboard.press("[");
    await page.keyboard.press("]");
    await page.keyboard.press("\\");
    await expect.poll(() => width(assets)).toBe(open.assets);
    await expect.poll(() => width(inspector)).toBe(open.inspector);
    await expect.poll(() => height(timeline)).toBe(open.timeline);
  });

  test("shortcuts are ignored while typing", async ({ page }) => {
    const assets = page.locator("#assets");
    const before = await width(assets);
    await page.getByRole("textbox", { name: "Project name" }).press("[");
    await page.waitForTimeout(300);
    expect(await width(assets)).toBe(before);
  });

  test("dragging the assets separator resizes and persists", async ({ page }) => {
    const assets = page.locator("#assets");
    const before = await width(assets);
    await drag(page, page.locator('[role=separator][aria-controls="assets"]'), 80, 0);
    await expect.poll(() => width(assets)).toBeGreaterThan(before + 60);
    const after = await width(assets);

    await reloadEditor(page);
    await expect.poll(() => width(page.locator("#assets"))).toBe(after);
  });
});

test.describe("tablet", () => {
  test.skip(({ viewport }) => (viewport?.width ?? 0) >= 1024, "tablet layout only");

  test("section tabs switch by click and by [ ] \\", async ({ page }) => {
    const tabs = page.getByRole("tablist", { name: "Editor sections" });
    const tab = (name: string) => tabs.getByRole("tab", { name });
    await expect(tab("Assets")).toHaveAttribute("aria-selected", "true");

    await tab("Inspector").click();
    await expect(tab("Inspector")).toHaveAttribute("aria-selected", "true");
    await expect(page.locator("[data-inspector]")).toBeVisible();

    await focusStage(page);
    await page.keyboard.press("\\");
    await expect(tab("Timeline")).toHaveAttribute("aria-selected", "true");
    await page.keyboard.press("[");
    await expect(tab("Assets")).toHaveAttribute("aria-selected", "true");
    await page.keyboard.press("]");
    await expect(tab("Inspector")).toHaveAttribute("aria-selected", "true");
  });

  test("dragging the preview separator resizes and persists", async ({ page }) => {
    const preview = page.locator("#preview");
    const before = await height(preview);
    await drag(page, page.locator('[role=separator][aria-controls="preview"]'), 0, -120);
    await expect.poll(() => height(preview)).toBeLessThan(before - 80);
    const after = await height(preview);

    await reloadEditor(page);
    await expect.poll(() => height(page.locator("#preview"))).toBe(after);
  });
});
