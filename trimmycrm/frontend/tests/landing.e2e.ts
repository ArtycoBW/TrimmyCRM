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
  await expect(page.getByRole("heading", { name: /До — идея/i })).toBeVisible();
  await expect(page.getByAltText("Абстрактный образ барбершопа")).toBeAttached();

  const beforeImage = page.locator(".before-after__image--before");
  const afterImage = page.locator(".before-after__image--after");
  await expect(beforeImage).toHaveAttribute("src", /before-consultation\.svg/);
  await expect(afterImage).toHaveAttribute("src", /after-style\.svg/);
  await beforeImage.scrollIntoViewIfNeeded();
  await expect.poll(() => beforeImage.evaluate((image: HTMLImageElement) => image.complete && image.naturalWidth > 0)).toBe(true);
  await expect.poll(() => afterImage.evaluate((image: HTMLImageElement) => image.complete && image.naturalWidth > 0)).toBe(true);

  const comparison = page.getByLabel("Сравнить образ до и после работы мастера");
  await comparison.fill("72");
  await expect(page.locator(".before-after")).toHaveCSS("--comparison-position", "72%");

  if (testInfo.project.name === "desktop-chrome") {
    await expect(page.getByRole("navigation", { name: "Основная навигация" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Открыть меню" })).toBeHidden();
  }
});

test("mobile hero fits the viewport and navigation opens", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "mobile-chrome", "Mobile-only layout assertion");
  await page.goto("/");

  const selectors = [
    ".site-header__capsule",
    ".site-header__menu-button",
    ".hero__content",
    ".hero__title",
    ".hero__actions",
  ];

  for (const selector of selectors) {
    const box = await page.locator(selector).boundingBox();
    expect(box, `${selector} should be rendered`).not.toBeNull();
    expect(box!.x, `${selector} starts inside viewport`).toBeGreaterThanOrEqual(-1);
    expect(box!.x + box!.width, `${selector} ends inside viewport`).toBeLessThanOrEqual(391);
  }

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
