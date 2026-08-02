import { expect, test } from "@playwright/test";

import { mockExistingSite, mockOwnerProfile } from "./helpers/app-fixtures";
import {
  clientDetailsFixture,
  hairProfileFixture,
  mockCrmApis,
  secondClientFixture,
} from "./helpers/crm-fixtures";
import { selectOption } from "./helpers/ui";
import { clientFixture } from "./helpers/schedule-fixtures";

async function prepare(page: import("@playwright/test").Page) {
  await mockOwnerProfile(page);
  await mockExistingSite(page);
  await mockCrmApis(page);
}

async function expectNoRightOverflow(page: import("@playwright/test").Page) {
  const geometry = await page.evaluate(() => ({
    viewport: innerWidth,
    document: document.documentElement.scrollWidth,
  }));
  expect(geometry.document).toBeLessThanOrEqual(geometry.viewport + 1);
}

test("client directory and details stay adaptive", async ({ page }) => {
  await prepare(page);
  await page.goto("/app/clients");

  await expect(page.getByRole("heading", { name: "Клиенты." })).toBeVisible();
  await expect(page.locator(".client-row")).toHaveCount(2);
  await expect(page.getByText("Анна Петрова", { exact: true })).toBeVisible();
  await expectNoRightOverflow(page);

  const search = page.getByRole("searchbox", { name: "Поиск клиентов" });
  await search.pressSequentially("Мария", { delay: 20 });
  await expect(search).toHaveValue("Мария");
  await page.getByRole("button", { name: "Очистить поиск" }).click();
  await expect(search).toHaveValue("");

  await page.locator(".client-row").first().click();
  const drawer = page.getByRole("dialog", { name: "Анна Петрова" });
  await expect(drawer).toBeVisible();
  await expect(drawer.getByText("Стрижка и укладка", { exact: true })).toBeVisible();
  await expect(drawer.getByText("Волнистые", { exact: true })).toBeVisible();
  await expect(drawer.getByText("Мелирование шесть месяцев назад", { exact: true })).toBeVisible();
  await expectNoRightOverflow(page);
});

test("owner can update the technical hair profile", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "desktop-chrome", "One mutation pass is enough");
  await prepare(page);
  let submitted: Record<string, unknown> | null = null;
  await page.route("**/api/v1/clients/" + clientFixture.id + "/hair-profile", async (route) => {
    if (route.request().method() === "GET") {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(hairProfileFixture),
      });
      return;
    }
    submitted = route.request().postDataJSON();
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        ...hairProfileFixture,
        ...submitted,
        version: 4,
        updatedAt: "2026-07-16T08:00:00Z",
      }),
    });
  });

  await page.goto("/app/clients");
  await page.locator(".client-row").first().click();
  const profile = page.locator(".client-hair-profile");
  await expect(profile.getByText("Мелирование шесть месяцев назад", { exact: true })).toBeVisible();
  await profile.getByRole("button", { name: "Изменить" }).click();
    await selectOption(page, /^Длина$/, /^Длинные$/);
  await profile.getByLabel("Текущий цвет").fill("уровень 8");
  await profile.getByLabel("Пожелания клиента").fill("Оставить мягкий контур у лица");
  await profile.getByRole("button", { name: "Сохранить профиль" }).click();

  await expect.poll(() => submitted).not.toBeNull();
  expect(submitted).toMatchObject({
    hairLength: "long",
    currentColor: "уровень 8",
    preferences: "Оставить мягкий контур у лица",
    expectedVersion: 3,
  });
  await expect(profile.getByText("Длинные", { exact: true })).toBeVisible();
  await expect(profile.getByText("Оставить мягкий контур у лица", { exact: true })).toBeVisible();
});

test("editing a client uses PATCH and keeps loaded profile", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "desktop-chrome", "One mutation pass is enough");
  await prepare(page);
  await page.route("**/api/v1/clients/" + clientFixture.id, async (route) => {
    if (route.request().method() === "GET") {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(clientDetailsFixture),
      });
      return;
    }
    expect(route.request().method()).toBe("PATCH");
    expect(route.request().postDataJSON()).toEqual({
      fullName: "Анна Смирнова",
      email: "anna@example.ru",
      phone: "+79991234567",
      status: "active",
    });
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ ...clientFixture, fullName: "Анна Смирнова" }),
    });
  });

  await page.goto("/app/clients");
  await page.locator(".client-row").first().click();
  await page.getByRole("button", { name: "Изменить" }).click();
  await page.getByLabel("Имя и фамилия").fill("Анна Смирнова");
  await page.getByRole("button", { name: "Сохранить изменения →" }).click();

  const drawer = page.getByRole("dialog", { name: "Анна Смирнова" });
  await expect(drawer).toBeVisible();
  await expect(drawer.getByText("Стрижка и укладка", { exact: true })).toBeVisible();
  await expect(page.getByText("Данные клиента сохранены")).toBeVisible();
});

test("new client uses the current POST payload", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "desktop-chrome", "One mutation pass is enough");
  await prepare(page);
  await page.route("**/api/v1/clients", async (route) => {
    if (route.request().method() === "GET") {
      await route.fallback();
      return;
    }
    expect(route.request().method()).toBe("POST");
    expect(route.request().postDataJSON()).toEqual({
      fullName: "Елена Волкова",
      email: "elena@example.ru",
      phone: "+79990001122",
      consent: true,
    });
    await route.fulfill({
      status: 201,
      contentType: "application/json",
      body: JSON.stringify({
        ...secondClientFixture,
        id: "11e122f1-ae84-4b6d-9e21-edcf046fa6d2",
        fullName: "Елена Волкова",
        email: "elena@example.ru",
        phone: "+79990001122",
      }),
    });
  });

  await page.goto("/app/clients");
  await page.getByRole("button", { name: /Добавить клиента/ }).click();
  await page.getByLabel("Имя и фамилия").fill("Елена Волкова");
  await page.getByLabel("Телефон").fill("+79990001122");
  await page.getByLabel("Email").fill("elena@example.ru");
  await page.getByLabel(/салон получил согласие клиента/).check();
  await page.getByRole("button", { name: "Добавить клиента →" }).click();

  await expect(page.getByRole("dialog", { name: "Елена Волкова" })).toBeVisible();
  await expect(page.getByText("Клиент добавлен")).toBeVisible();
});
