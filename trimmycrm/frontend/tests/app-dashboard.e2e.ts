import { expect, test } from "@playwright/test";

import {
  mockDashboardApis,
  mockExistingSite,
  mockMissingSite,
  mockOwnerProfile,
  ownerMeFixture,
  siteFixture,
} from "./helpers/app-fixtures";

async function expectNoRightOverflow(page: import("@playwright/test").Page) {
  const offenders = await page.evaluate(() =>
    Array.from(document.querySelectorAll<HTMLElement>("body *"))
      .map((element) => {
        const box = element.getBoundingClientRect();
        return {
          tag: element.tagName.toLowerCase(),
          className: element.className,
          text: (element.textContent || "").trim().slice(0, 45),
          right: Math.round(box.right),
        };
      })
      .filter((item) => item.right > innerWidth + 1)
      .slice(0, 12),
  );
  expect(offenders).toEqual([]);
}

test("owner dashboard renders real operational data and stays inside viewport", async ({ page }, testInfo) => {
  await mockOwnerProfile(page);
  await mockExistingSite(page);
  await mockDashboardApis(page);

  await page.goto("/app");

  await expect(page.getByRole("heading", { name: /Добрый день, Ольга/i })).toBeVisible();
  await expect(page.locator(".crm-metric")).toHaveCount(4);
  await expect(page.getByText("Боня", { exact: true })).toBeVisible();
  await expect(page.getByText("2 400 ₽", { exact: true }).first()).toBeVisible();
  await expect(page.locator(".crm-launch")).toContainText("Подготовим салон к записи");
  await expect(page.getByRole("button", { name: "Уведомления" })).toHaveCount(0);
  const feedbackButton = page.getByRole("button", { name: "Обратная связь" });
  await expect(feedbackButton.evaluate((element) => ({
    display: getComputedStyle(element).display,
    columns: getComputedStyle(element).gridTemplateColumns,
    fontSize: getComputedStyle(element).fontSize,
    fontWeight: getComputedStyle(element).fontWeight,
  }))).resolves.toMatchObject({ display: "grid", columns: expect.stringContaining("22px") });
  const instructionsLink = page.getByRole("link", { name: "Инструкция" });
  await expect.poll(async () => {
    const [feedback, instructions] = await Promise.all([
      feedbackButton.evaluate((element) => ({
        fontSize: getComputedStyle(element).fontSize,
        fontWeight: getComputedStyle(element).fontWeight,
      })),
      instructionsLink.evaluate((element) => ({
        fontSize: getComputedStyle(element).fontSize,
        fontWeight: getComputedStyle(element).fontWeight,
      })),
    ]);
    return feedback.fontSize === instructions.fontSize
      && feedback.fontWeight === instructions.fontWeight;
  }).toBe(true);

  const viewportWidth = await page.evaluate(() => innerWidth);
  const scrollWidth = await page.evaluate(() => document.documentElement.scrollWidth);
  expect(scrollWidth).toBeLessThanOrEqual(viewportWidth + 1);
  await expectNoRightOverflow(page);

  const menuButton = page.getByRole("button", { name: "Открыть меню" });
  if (testInfo.project.name === "mobile-chrome") {
    await expect(menuButton).toBeVisible();
    await menuButton.click();
    await expect(page.locator(".crm-sidebar")).toHaveClass(/crm-sidebar--open/);
    await expect.poll(async () => {
      const box = await page.locator(".crm-sidebar").boundingBox();
      return box?.x ?? -999;
    }).toBeGreaterThanOrEqual(-1);
  } else {
    await expect(menuButton).toBeHidden();
    await expect(page.getByRole("navigation", { name: "Навигация кабинета" })).toBeVisible();
  }
});

test("platform owner keeps the salon cabinet and sees the admin panel link", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "desktop-chrome", "One desktop navigation pass is enough");
  await page.route("**/api/v1/auth/me", (route) => route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify({
      ...ownerMeFixture,
      user: { ...ownerMeFixture.user, role: "superadmin" },
    }),
  }));
  await mockExistingSite(page);
  await mockDashboardApis(page);
  await page.route("**/api/v1/admin/plans", (route) => route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify([]),
  }));
  await page.route("**/api/v1/admin/users**", (route) => route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify({ items: [], total: 0, page: 1, limit: 20 }),
  }));

  await page.goto("/app");

  await expect(page).toHaveURL(/\/app$/);
  await expect(page.getByRole("heading", { name: /Добрый день, Ольга/i })).toBeVisible();
  const adminLink = page.getByRole("link", { name: "Панель администратора" });
  await expect(adminLink).toBeVisible();
  await adminLink.click();
  await expect(page).toHaveURL(/\/admin$/);
  const navigation = page.getByRole("navigation", { name: "Навигация кабинета" });
  await expect(navigation.getByRole("link", { name: "Календарь" })).toBeVisible();
  await expect(navigation.getByRole("link", { name: "Клиенты" })).toBeVisible();
  await expect(navigation.getByRole("link", { name: "Настройки" })).toBeVisible();
  await expect(navigation.getByRole("link", { name: "Панель администратора" })).toHaveClass(/is-active/);
});

test("owner without a site is routed to adaptive onboarding", async ({ page }) => {
  await mockOwnerProfile(page);
  await mockMissingSite(page);

  await page.goto("/app");

  await expect(page).toHaveURL(/\/app\/onboarding$/, { timeout: 15_000 });
  await expect(page.getByRole("heading", { name: "Как вас представить?" })).toBeVisible();
  await expect(page.getByLabel("Название салона")).toBeVisible();
  await expect(page.getByLabel("Адрес сайта")).toBeVisible();
  await expectNoRightOverflow(page);

  const panel = await page.locator(".onboarding-panel").boundingBox();
  expect(panel).not.toBeNull();
  expect(panel!.x + panel!.width).toBeLessThanOrEqual((await page.evaluate(() => innerWidth)) + 1);
});

test("onboarding creates a site with the current backend payload", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "desktop-chrome", "One API integration pass is enough");
  await mockOwnerProfile(page);
  await mockMissingSite(page);
  await mockDashboardApis(page);

  await page.route("**/api/v1/sites/slug-available?*", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ available: true }),
    }),
  );
  await page.route("**/api/v1/sites", async (route) => {
    const payload = route.request().postDataJSON() as Record<string, unknown>;
    expect(payload).toMatchObject({
      name: "Хвостики",
      city: "Казань",
      slug: "hvostiki",
      timezone: "Europe/Moscow",
    });
    await route.fulfill({
      status: 201,
      contentType: "application/json",
      body: JSON.stringify({
        ...siteFixture,
        name: "Хвостики",
        city: "Казань",
        slug: "hvostiki",
      }),
    });
  });

  await page.goto("/app/onboarding");
  await expect(page.getByRole("heading", { name: "Как вас представить?" })).toBeVisible();
  await page.getByLabel("Название салона").fill("Хвостики");
  await page.getByLabel("Город").fill("Казань");
  await expect(page.getByLabel("Адрес сайта")).toHaveValue("hvostiki");
  await page.getByLabel("Адрес сайта").press("Tab");
  await expect(page.getByText("Адрес свободен")).toBeVisible();
  await page.getByRole("button", { name: "Создать кабинет →" }).click();

  await expect(page).toHaveURL(/\/app$/);
  await expect(page.getByRole("heading", { name: /Добрый день, Ольга/i })).toBeVisible();
  await expect(page.locator(".crm-salon-card")).toContainText("Хвостики");
});
