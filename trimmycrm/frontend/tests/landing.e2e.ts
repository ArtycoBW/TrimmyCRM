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

  await expect(page.getByRole("heading", { level: 1 })).toContainText("Салон в ритме");
  await expect(page.locator("#product")).toBeAttached();
  await expect(page.locator("#examples")).toBeAttached();
  await expect(page.locator("#plans")).toBeAttached();
  await expect(page.locator("#faq")).toBeAttached();
  await expect(page.getByRole("heading", { name: /Разные салоны/i })).toBeVisible();
  const womanPortrait = page.getByAltText("Женщина с медным графичным бобом").first();
  const manPortrait = page.getByAltText("Мужчина с текстурной короткой стрижкой").first();
  await expect(womanPortrait).toHaveAttribute("src", /woman-copper-bob\.webp/);
  await expect(manPortrait).toHaveAttribute("src", /man-textured-crop\.webp/);
  await expect.poll(() => womanPortrait.evaluate((image: HTMLImageElement) => image.complete && image.naturalWidth > 0)).toBe(true);
  await expect.poll(() => manPortrait.evaluate((image: HTMLImageElement) => image.complete && image.naturalWidth > 0)).toBe(true);

  if (testInfo.project.name === "desktop-chrome") {
    await expect(page.getByRole("navigation", { name: "Основная навигация" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Меню" })).toBeVisible();
    await expect(page.getByRole("dialog")).toBeHidden();
  }
});

test("mobile hero fits the viewport and navigation opens", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "mobile-chrome", "Mobile-only layout assertion");
  await page.goto("/");

  await expect(page.locator("body").evaluate((body) => body.scrollWidth <= window.innerWidth)).resolves.toBe(true);
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  await expect(page.getByRole("link", { name: /Попробовать 14 дней/i })).toBeVisible();

  const menuButton = page.getByRole("button", { name: "Меню" });
  await expect(menuButton).toBeVisible();
  await menuButton.click();
  const navigation = page.getByRole("navigation", { name: "Навигация по лендингу" });
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

test("site builder reorders blocks and Canvas2D switches modes", async ({ page }, testInfo) => {
  await page.goto("/");

  const builder = page.locator("section").filter({ has: page.getByRole("heading", { name: "Сайт в вашем порядке." }) });
  await builder.scrollIntoViewIfNeeded();
  const blocks = builder.getByRole("button");
  await expect(blocks).toHaveCount(6);
  if (testInfo.project.name === "desktop-chrome") {
    await blocks.first().focus();
    await page.keyboard.press("Shift+ArrowRight");
    await expect(blocks.nth(1)).toContainText("Обложка");
    await expect(builder.locator("[aria-live='polite']")).toContainText("позиция 2 из 6");
  }

  const tryOn = page.locator("section").filter({ has: page.getByRole("heading", { name: "Примерка работает локально." }) });
  await tryOn.scrollIntoViewIfNeeded();
  const canvas = tryOn.getByRole("img", { name: /Canvas2D-портрет/i });
  await expect(canvas).toBeVisible();
  await expect.poll(() => canvas.evaluate((element: HTMLCanvasElement) => element.width > 0 && element.height > 0)).toBe(true);
  await tryOn.getByRole("button", { name: "Точки" }).click();
  await expect(tryOn.getByRole("button", { name: "Точки" })).toHaveAttribute("aria-pressed", "true");
});

test("reduced motion stays static and the editorial footer is complete", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/");

  await expect.poll(() => page.locator("[data-reveal]").evaluateAll((elements) =>
    elements.every((element) => element.getAttribute("data-reveal-state") === "visible"),
  )).toBe(true);
  const heroTrack = page.getByLabel("Работы мужских и женских мастеров").locator(":scope > div");
  await expect.poll(() => heroTrack.evaluate((element) => getComputedStyle(element).animationName)).toBe("none");

  const footer = page.locator("footer");
  await footer.scrollIntoViewIfNeeded();
  await expect(footer.getByRole("heading", { name: /Соберите сайт/i })).toBeVisible();
  await expect(footer.getByRole("navigation", { name: "Документы и поддержка" })).toBeVisible();
  await expect(footer.getByRole("link", { name: /Попробовать TrimmyCRM/i })).toBeVisible();
});
