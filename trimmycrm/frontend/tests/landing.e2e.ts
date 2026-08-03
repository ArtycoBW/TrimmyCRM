import { expect, test } from "@playwright/test";

test.beforeEach(async ({ page }) => {
  await page.route("**/api/v1/auth/me", (route) => route.fulfill({
    status: 401,
    contentType: "application/json",
    body: JSON.stringify({ message: "Требуется авторизация", code: "unauthorized" }),
  }));
  await page.route("**/api/v1/frontend-auth/platform/refresh", (route) => route.fulfill({
    status: 401,
    contentType: "application/json",
    body: JSON.stringify({ message: "Сессия отсутствует", code: "unauthorized" }),
  }));
});

test("landing renders its core sections", async ({ page }, testInfo) => {
  await page.goto("/");

  await expect(page.getByRole("heading", { level: 1 })).toContainText("Салон растёт");
  await expect(page.locator("#product")).toBeAttached();
  await expect(page.locator("#examples")).toBeAttached();
  await expect(page.locator("#plans")).toBeAttached();
  await expect(page.locator("#faq")).toBeAttached();
  await expect(page.getByRole("heading", { name: /Разная эстетика/i })).toBeVisible();
  const womanPortrait = page.getByAltText("Женская стрижка — медный графичный боб");
  const manPortrait = page.getByAltText("Мужская стрижка — текстурный кроп");
  await expect(womanPortrait).toHaveAttribute("src", /woman-copper-bob\.webp/);
  await expect(manPortrait).toHaveAttribute("src", /man-textured-crop\.webp/);
  await expect.poll(() => womanPortrait.evaluate((image: HTMLImageElement) => image.complete && image.naturalWidth > 0)).toBe(true);
  await expect.poll(() => manPortrait.evaluate((image: HTMLImageElement) => image.complete && image.naturalWidth > 0)).toBe(true);

  if (testInfo.project.name === "desktop-chrome") {
    await expect(page.getByRole("navigation", { name: "Основная навигация" })).toBeHidden();
    await expect(page.getByRole("button", { name: "Открыть меню" })).toBeVisible();
  }
});

test("mobile hero fits the viewport and navigation opens", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "mobile-chrome", "Mobile-only layout assertion");
  await page.goto("/");

  await expect(page.locator("body").evaluate((body) => body.scrollWidth <= window.innerWidth)).resolves.toBe(true);
  await expect(page.locator(".hero__content")).toBeVisible();
  await expect(page.locator(".hero__actions")).toBeVisible();

  const menuButton = page.getByRole("button", { name: "Открыть меню" });
  await expect(menuButton).toBeVisible();
  await menuButton.click();
  const navigation = page.getByRole("navigation", { name: "Основная навигация" });
  await expect(navigation).toBeVisible();
  await expect(navigation.getByRole("link", { name: "Тарифы" })).toBeVisible();
});

test("pricing anchor and cards are reachable", async ({ page }) => {
  await page.goto("/");
  await page.locator("#plans").scrollIntoViewIfNeeded();
  await expect(page.getByRole("heading", { name: /Начните с малого/i })).toBeVisible();
  await expect(page.locator(".plan-card")).toHaveCount(3);
  await expect(page.locator(".plan-card--featured")).toContainText("Бизнес");
});
