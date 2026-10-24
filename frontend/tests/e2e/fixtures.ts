import { test as base, expect, type Page } from "@playwright/test";

type ConsoleGuard = {
  /** Ignore console errors matching this pattern for the rest of the test. */
  allow: (pattern: RegExp) => void;
  errors: string[];
};

/**
 * `test` with an automatic console guard: any `console.error` or uncaught page
 * error fails the test when it finishes.
 */
export const test = base.extend<{ consoleGuard: ConsoleGuard }>({
  consoleGuard: [
    async ({ page }, use) => {
      const allowed: RegExp[] = [];
      const errors: string[] = [];
      page.on("pageerror", (e) => errors.push(`pageerror: ${e.message}`));
      page.on("console", (m) => {
        if (m.type() === "error") errors.push(`console: ${m.text()}`);
      });
      await use({ allow: (p) => allowed.push(p), errors });
      const unexpected = errors.filter((e) => !allowed.some((p) => p.test(e)));
      expect(unexpected, "console errors").toEqual([]);
    },
    { auto: true },
  ],
});

export { expect };

/* ---------- Editor helpers ---------- */

export const PLAN_KEY = "shortcraft:plan:demo";

/** Wait until the client-only editor has mounted. */
export async function waitForEditor(page: Page) {
  await expect(page.getByText("Opening editor…")).toHaveCount(0, { timeout: 30_000 });
  await expect(page.locator("[data-preview-frame]")).toBeVisible();
}

/** Open the demo editor with empty storage. */
export async function openEditor(page: Page) {
  await page.goto("/editor/demo");
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await waitForEditor(page);
}

export async function reloadEditor(page: Page) {
  await page.reload();
  await waitForEditor(page);
}

type SavedPlan = {
  clips: unknown[];
  canvas: { aspect: string; width: number; height: number };
  captions: { presetId: string };
};

/** The autosaved plan, or null before the first save. */
export const savedPlan = (page: Page) =>
  page.evaluate((key) => JSON.parse(localStorage.getItem(key) ?? "null"), PLAN_KEY) as Promise<SavedPlan | null>;

/** Width / height of the preview frame. */
export const frameRatio = (page: Page) =>
  page.locator("[data-preview-frame]").evaluate((el) => {
    const b = el.getBoundingClientRect();
    return b.width / b.height;
  });

/** Total output duration in seconds, from the "/ 0:12.0" label next to the playhead time. */
export async function totalSeconds(page: Page) {
  const text = (await page.locator("[data-time] + span").textContent()) ?? "";
  const m = text.match(/(\d+):(\d+(?:\.\d+)?)/);
  if (!m) throw new Error(`no duration in "${text}"`);
  return Number(m[1]) * 60 + Number(m[2]);
}

/** Move focus off inputs so editor shortcuts reach the window handler. */
export async function focusStage(page: Page) {
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
}
