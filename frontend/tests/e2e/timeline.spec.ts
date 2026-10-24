import type { Locator, Page } from "@playwright/test";
import { expect, focusStage, openEditor, test } from "./fixtures";

// The edited (output-time) multi-track timeline: split, trim, reorder, item
// drag, zoom and multi-select, each followed by undo.

const clips = (page: Page) => page.getByTestId("timeline-clip");
const items = (page: Page) => page.getByTestId("timeline-item");
const total = async (page: Page) => Number(await page.locator("[data-total]").getAttribute("data-total"));
const clipOrder = (page: Page) => clips(page).evaluateAll((els) => els.map((el) => el.getAttribute("data-clip-id")));

async function box(l: Locator) {
  const b = await l.boundingBox();
  if (!b) throw new Error("not visible");
  return b;
}

/** Click the ruler at a fraction of the edited video's length. */
async function seekRuler(page: Page, fraction: number) {
  const clip = await box(clips(page).first());
  const ruler = await box(page.locator("[data-tl-ruler]"));
  const lastClip = await box(clips(page).last());
  const width = lastClip.x + lastClip.width - clip.x;
  await page.mouse.click(clip.x + width * fraction, ruler.y + ruler.height / 2);
}

async function drag(page: Page, from: { x: number; y: number }, dx: number, dy = 0) {
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(from.x + dx / 2, from.y + dy / 2, { steps: 4 });
  await page.mouse.move(from.x + dx, from.y + dy, { steps: 4 });
  await page.mouse.up();
}

/** Undo groups changes made within 400ms; wait so each action is its own step. */
const settle = (page: Page) => page.waitForTimeout(500);

async function undo(page: Page) {
  await focusStage(page);
  await page.keyboard.press("ControlOrMeta+z");
}

async function addText(page: Page) {
  await page.getByRole("button", { name: "Text", exact: true }).first().click();
  await page.getByRole("button", { name: "Add text", exact: true }).click();
  await settle(page);
}

test.beforeEach(async ({ page }) => {
  await openEditor(page);
  await expect(clips(page)).toHaveCount(1);
});

test("split at the playhead creates two clips, undo joins them", async ({ page }) => {
  await seekRuler(page, 0.4);
  await expect(page.locator("[data-time]")).not.toHaveText("0:00.0");
  await focusStage(page);
  await page.keyboard.press("s");
  await expect(clips(page)).toHaveCount(2);

  await settle(page);
  await undo(page);
  await expect(clips(page)).toHaveCount(1);
});

test("dragging the right trim handle shortens the video, undo restores it", async ({ page }) => {
  const before = await total(page);
  const b = await box(clips(page).first());
  await drag(page, { x: b.x + b.width - 3, y: b.y + b.height / 2 }, -160);
  await expect.poll(() => total(page)).toBeLessThan(before - 500);

  await settle(page);
  await undo(page);
  await expect.poll(() => total(page)).toBe(before);
});

test("dragging a clip reorders the main track, undo restores the order", async ({ page }) => {
  for (const f of [0.33, 0.66]) {
    await seekRuler(page, f);
    await focusStage(page);
    await page.keyboard.press("s");
    await settle(page);
  }
  await expect(clips(page)).toHaveCount(3);
  const order = await clipOrder(page);

  const first = await box(clips(page).first());
  const last = await box(clips(page).last());
  await drag(page, { x: first.x + first.width / 2, y: first.y + first.height / 2 }, last.x + last.width - 10 - (first.x + first.width / 2));
  await expect.poll(() => clipOrder(page)).toEqual([order[1], order[2], order[0]]);

  await settle(page);
  await undo(page);
  await expect.poll(() => clipOrder(page)).toEqual(order);
});

test("dragging a text item on the Text track changes its start, undo moves it back", async ({ page }) => {
  await addText(page);
  const item = items(page).first();
  await expect(item).toHaveAttribute("data-start", "0");
  await expect(page.locator('[data-tl-row="text"]')).toHaveCount(1);

  const b = await box(item);
  await drag(page, { x: b.x + b.width / 2, y: b.y + b.height / 2 }, 120);
  await expect.poll(async () => Number(await item.getAttribute("data-start"))).toBeGreaterThan(300);

  await settle(page);
  await undo(page);
  await expect(item).toHaveAttribute("data-start", "0");
});

test("zoom in and out changes the ruler", async ({ page }) => {
  const ruler = page.locator("[data-tl-ruler]");
  const fit = (await box(ruler)).width;
  const secondLabel = () => page.locator("[data-tick=major]").nth(1).textContent();
  expect(await secondLabel()).toBe("1s");

  await page.getByRole("button", { name: "Zoom in" }).click();
  await page.getByRole("button", { name: "Zoom in" }).click();
  await page.getByRole("button", { name: "Zoom in" }).click();
  await expect.poll(async () => (await box(ruler)).width).toBeGreaterThan(fit * 1.5);
  await expect.poll(secondLabel).toMatch(/f$/); // frames between seconds
  await expect(page.getByRole("button", { name: "Zoom to fit" })).toHaveAttribute("aria-pressed", "false");

  await focusStage(page);
  for (let i = 0; i < 8; i++) await page.keyboard.press("-");
  await expect.poll(async () => (await box(ruler)).width).toBeLessThan(fit);
  await expect.poll(secondLabel).toMatch(/^(2|5|10)s$/);

  await page.getByRole("button", { name: "Zoom to fit" }).click();
  await expect.poll(async () => (await box(ruler)).width).toBeCloseTo(fit, -1);
});

test("multi-select with Shift and delete both items, undo brings them back", async ({ page }) => {
  await addText(page);
  await seekRuler(page, 0.6);
  await addText(page);
  await expect(items(page)).toHaveCount(2);

  await items(page).nth(0).click();
  await items(page).nth(1).click({ modifiers: ["Shift"] });
  await expect(page.locator("[data-multi-select]")).toHaveAttribute("data-multi-select", "2");

  await focusStage(page);
  await page.keyboard.press("Delete");
  await expect(items(page)).toHaveCount(0);

  await settle(page);
  await undo(page);
  await expect(items(page)).toHaveCount(2);
});

test("box select picks clips and items, context menu offers clip actions", async ({ page }) => {
  await seekRuler(page, 0.5);
  await focusStage(page);
  await page.keyboard.press("s");
  await settle(page);

  // Drag a box from the empty zoom lane up across both clips.
  const zoomLane = await box(page.locator('[data-tl-lane="zoom"]'));
  const video = await box(page.locator('[data-tl-lane="video"]'));
  await drag(page, { x: video.x + 4, y: zoomLane.y + zoomLane.height - 3 }, video.width * 0.8, -(zoomLane.y - video.y) - 8);
  await expect(page.locator("[data-multi-select]")).toHaveAttribute("data-multi-select", "2");

  const c = await box(clips(page).first());
  await page.mouse.click(c.x + c.width / 2, c.y + c.height / 2, { button: "right" });
  await expect(page.getByRole("menuitem", { name: /Duplicate/ })).toBeVisible();
  await expect(page.getByRole("menuitem", { name: /Speed/ })).toBeVisible();
  await page.keyboard.press("Escape");
});
