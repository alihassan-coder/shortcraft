import { expect, test } from "./fixtures";

const ROUTES = [
  "/",
  "/features",
  "/pricing",
  "/examples",
  "/styles",
  "/about",
  "/blog",
  "/blog/first-three-seconds",
  "/login",
  "/signup",
];

for (const route of ROUTES) {
  test(`${route} loads with a heading`, async ({ page }) => {
    const res = await page.goto(route);
    expect(res?.status()).toBe(200);
    await expect(page.locator("h1").first()).toBeVisible();
    await expect(page).toHaveTitle(/Shortcraft/);
  });
}

test("unknown route shows the 404 page", async ({ page, consoleGuard }) => {
  // The browser logs the 404 response of the document itself.
  consoleGuard.allow(/status of 404/);
  const res = await page.goto("/does-not-exist");
  expect(res?.status()).toBe(404);
  await expect(page.locator("h1").first()).toBeVisible();
});

test("main nav links navigate", async ({ page }) => {
  await page.goto("/");
  const nav = page.getByRole("navigation", { name: "Main" });
  const links = nav.getByRole("link");
  const count = await links.count();
  expect(count).toBeGreaterThan(0);

  for (let i = 0; i < count; i++) {
    const link = links.nth(i);
    const href = await link.getAttribute("href");
    await link.click();
    await expect(page).toHaveURL(new RegExp(`${href}$`));
    await expect(link).toHaveAttribute("aria-current", "page");
    await expect(page.locator("h1").first()).toBeVisible();
  }

  await page.getByRole("link", { name: "Shortcraft home" }).first().click();
  await expect(page).toHaveURL(/\/$/);
});

test("pricing toggle switches between yearly and monthly prices", async ({ page }) => {
  await page.goto("/pricing");
  const period = page.getByRole("group", { name: "Billing period" });
  const yearly = period.getByRole("button", { name: /Yearly/ });
  const monthly = period.getByRole("button", { name: "Monthly" });
  await expect(yearly).toHaveAttribute("aria-pressed", "true");

  const prices = page.getByText(/^\$\d+$/);
  const before = await prices.allTextContents();
  await expect(page.getByText(/billed yearly/).first()).toBeVisible();

  await monthly.click();
  await expect(monthly).toHaveAttribute("aria-pressed", "true");
  await expect.poll(() => prices.allTextContents()).not.toEqual(before);
  await expect(page.getByText("Billed monthly").first()).toBeVisible();

  await yearly.click();
  await expect.poll(() => prices.allTextContents()).toEqual(before);
});
