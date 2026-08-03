import { expect, test } from "@playwright/test";

import {
  mockDashboardApis,
  mockExistingSite,
  ownerMeFixture,
} from "./helpers/app-fixtures";

async function mockAnonymous(page: import("@playwright/test").Page) {
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
}

test("login and registration layouts fit both viewports", async ({ page }) => {
  await mockAnonymous(page);
  await page.goto("/login");
  await expect(page.getByRole("heading", { name: /Войти в TrimmyCRM/i })).toBeVisible();
  await expect(page.locator(".brand-mark__image").first()).toHaveAttribute("src", "/brand/trimmy-symbol.svg");
  if (await page.locator(".auth-story").isVisible()) {
    await expect(page.getByAltText("Стилист работает над короткой стрижкой в современной студии")).toHaveAttribute("src", /auth-salon-studio\.webp/);
  }
  await expect(page.getByLabel("Email")).toBeVisible();
  await expect(page.getByLabel("Пароль", { exact: true })).toBeVisible();
  const passwordWrap = page.getByLabel("Пароль", { exact: true }).locator("..");
  await expect(passwordWrap).toHaveCSS("overflow", "hidden");
  await expect(page.getByRole("button", { name: "Показать пароль" })).toHaveCSS(
    "background-color",
    "rgba(0, 0, 0, 0)",
  );

  const panel = await page.locator(".auth-panel").boundingBox();
  expect(panel).not.toBeNull();
  expect(panel!.x + panel!.width).toBeLessThanOrEqual((await page.evaluate(() => innerWidth)) + 1);

  await page.goto("/register");
  await expect(page.getByRole("heading", { name: /Создать аккаунт/i })).toBeVisible();
  await expect(page.getByLabel("Шаги регистрации").locator("li[data-state='active']")).toContainText("Контакты");
  await page.getByRole("button", { name: /Продолжить/i }).click();
  await expect(page.getByText("Введите email")).toBeVisible();
  await expect(page.getByText("Укажите номер телефона")).toBeVisible();
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollHeight <= innerHeight + 1)).toBe(true);
  await page.getByLabel("Email").fill("layout@example.ru");
  await page.getByLabel("Телефон").fill("9896521542");
  await page.getByRole("button", { name: /Продолжить/i }).click();
  await page.getByLabel("Название салона").fill("ФОРМА");
  await page.getByLabel(/Женский салон/).check();
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollHeight <= innerHeight + 1)).toBe(true);
  await page.getByRole("button", { name: /Продолжить/i }).click();
  await expect(page.getByLabel("Шаги регистрации").locator("li[data-state='active']")).toContainText("Защита");
  await expect(page.getByText("Минимум 10 символов")).toHaveCount(0);
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollHeight <= innerHeight + 1)).toBe(true);
});

test("legal documents are readable and fit both viewports", async ({ page }) => {
  for (const [path, title] of [
    ["/terms", "Условия использования TrimmyCRM"],
    ["/privacy", "Политика обработки персональных данных"],
    ["/consent", "Согласие владельца аккаунта на обработку персональных данных"],
    ["/client-consent", "Согласие клиента салона на обработку персональных данных"],
    ["/data-processing-instructions", "Поручение на обработку персональных данных"],
  ] as const) {
    const response = await page.goto(path);
    expect(response?.ok(), `${path} should render`).toBeTruthy();
    await expect(page.getByRole("heading", { name: title, level: 1 })).toBeVisible();
    await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
  }
});

test("recovery and client-facing screens have no horizontal overflow", async ({ page }) => {
  for (const path of ["/forgot-password", "/reset-password", "/verify-email", "/client"]) {
    const response = await page.goto(path);
    expect(response?.ok(), `${path} should render`).toBeTruthy();
    await expect(page.locator("body")).toBeVisible();
    const geometry = await page.evaluate(() => ({
      viewport: innerWidth,
      document: document.documentElement.scrollWidth,
    }));
    expect(geometry.document, `${path} should fit the viewport`).toBeLessThanOrEqual(geometry.viewport + 1);
  }
});

test("platform login continues to authenticated entry", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "desktop-chrome", "Single integration pass is enough");
  let loggedIn = false;
  await page.route("**/api/v1/auth/login", async (route) => {
    loggedIn = true;
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ accessToken: "test-access-token", tokenType: "bearer", expiresIn: 900 }),
    });
  });
  await page.route("**/api/v1/auth/me", async (route) => {
    if (!loggedIn) {
      await route.fulfill({
        status: 401,
        contentType: "application/json",
        body: JSON.stringify({ message: "Требуется авторизация", code: "unauthorized" }),
      });
      return;
    }
    expect(route.request().headers().authorization).toBe("Bearer test-access-token");
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(ownerMeFixture),
    });
  });
  await mockExistingSite(page);
  await mockDashboardApis(page);
  await page.route("**/api/v1/frontend-auth/platform/refresh", (route) => route.fulfill({
    status: 401,
    contentType: "application/json",
    body: JSON.stringify({ message: "Сессия отсутствует", code: "unauthorized" }),
  }));

  await page.goto("/login");
  await page.getByLabel("Email").fill("owner@example.ru");
  await page.getByLabel("Пароль", { exact: true }).fill("Strong-pass1!");
  await page.getByRole("button", { name: "Войти →" }).click();
  await expect(page).toHaveURL(/\/app$/);
  await expect(page.getByRole("heading", { name: /Добрый день, Ольга/i })).toBeVisible();
  await expect(page.locator(".crm-profile")).toContainText("Старт");
});

test("registration shows privacy-safe email confirmation", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "desktop-chrome", "Single integration pass is enough");
  let registrationPayload: Record<string, unknown> | null = null;
  await mockAnonymous(page);
  await page.route("**/api/v1/auth/register", async (route) => {
    registrationPayload = route.request().postDataJSON() as Record<string, unknown>;
    await route.fulfill({
      status: 201,
      contentType: "application/json",
      body: JSON.stringify({ id: "user-id", email: "new@example.ru", status: "pending" }),
    });
  });

  await page.goto("/register");
  await page.getByLabel("Email").fill("new@example.ru");
  await page.getByLabel("Телефон").fill("9896521542");
  await expect(page.getByLabel("Телефон")).toHaveValue("+7 (989) 652 15 42");
  await page.getByRole("button", { name: /Продолжить/i }).click();
  await expect(page.getByLabel("Шаги регистрации").locator("li[data-state='active']")).toContainText("Салон");
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollHeight <= innerHeight + 1)).toBe(true);
  await page.getByLabel("Название салона").fill("ФОРМА");
  await page.getByLabel(/Женский салон/).check();
  await page.getByLabel("Город").fill("Москва");
  await page.getByRole("button", { name: /Продолжить/i }).click();
  await expect(page.getByLabel("Шаги регистрации").locator("li[data-state='active']")).toContainText("Защита");
  await expect(page.getByText("Минимум 10 символов")).toHaveCount(0);
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollHeight <= innerHeight + 1)).toBe(true);
  await page.getByLabel("Пароль", { exact: true }).fill("Strong-pass1!");
  await page.getByLabel("Повторите пароль").fill("Strong-pass1!");
  await page.getByRole("checkbox").nth(0).check();
  await page.getByRole("checkbox").nth(1).check();
  await page.getByRole("checkbox").nth(2).check();
  await page.getByRole("button", { name: "Создать аккаунт →" }).click();
  await expect(page.getByRole("heading", { name: "Проверьте почту" })).toBeVisible();
  await expect(page.getByText("new@example.ru")).toBeVisible();
  expect(registrationPayload).toMatchObject({
    email: "new@example.ru",
    phone: "+79896521542",
    salonName: "ФОРМА",
    salonType: "women_hair_salon",
    city: "Москва",
    timezone: "Europe/Moscow",
    termsAccepted: true,
    consent: true,
    dataProcessingInstructionAccepted: true,
  });
});

test("authenticated platform session sees cabinet links and cannot reopen auth forms", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "desktop-chrome", "Single authenticated navigation pass is enough");
  await page.route("**/api/v1/auth/me", (route) => route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify(ownerMeFixture),
  }));
  await mockExistingSite(page);
  await mockDashboardApis(page);

  await page.goto("/");
  const header = page.getByRole("banner");
  await header.getByRole("button", { name: "Меню" }).click();
  const navigationDialog = page.getByRole("dialog");
  await expect(navigationDialog.getByRole("link", { name: "Личный кабинет" })).toBeVisible();
  await expect(navigationDialog.getByRole("link", { name: "Войти" })).toHaveCount(0);
  await navigationDialog.getByRole("button", { name: "Закрыть" }).click();
  await expect(page.getByRole("link", { name: "Перейти в кабинет" }).first()).toHaveAttribute("href", "/app");

  await page.goto("/login");
  await expect(page).toHaveURL(/\/app$/);
  await page.goto("/register");
  await expect(page).toHaveURL(/\/app$/);
});
