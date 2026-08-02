import { expect, test } from "@playwright/test";

import { mockExistingSite, mockOwnerProfile } from "./helpers/app-fixtures";
import {
  clientDetailsFixture,
  mockCrmApis,
  secondClientFixture,
  secondPetFixture,
} from "./helpers/crm-fixtures";
import { selectOption } from "./helpers/ui";
import { clientFixture, petFixture } from "./helpers/schedule-fixtures";

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
  await expect(drawer.getByRole("button", { name: /Боня Шпиц/ })).toBeVisible();
  await expect(drawer.getByText("Комплексный уход", { exact: true })).toBeVisible();
  await expectNoRightOverflow(page);
});

test("pet directory opens the current owner-visible profile", async ({ page }) => {
  await prepare(page);
  await page.goto("/app/pets");

  await expect(page.getByRole("heading", { name: "Питомцы." })).toBeVisible();
  await expect(page.locator(".pet-card")).toHaveCount(2);
  await expect(page.getByText("Ириска", { exact: true })).toBeVisible();
  await expectNoRightOverflow(page);

  await page.locator(".pet-card").first().click();
  const drawer = page.getByRole("dialog", { name: "Боня" });
  await expect(drawer).toBeVisible();
  await expect(drawer.getByText(/владелец · Анна Петрова/)).toBeVisible();
  await expect(drawer.getByText("Боится громкого фена, лучше сделать короткий перерыв.")).toBeVisible();
  await expect(drawer.getByRole("button", { name: /Ветеринарный паспорт/ })).toBeVisible();
  await expect(drawer.getByText(/Изменять медицинские данные/)).toBeVisible();
  await expectNoRightOverflow(page);
});

test("editing a client uses PATCH and keeps loaded pets", async ({ page }, testInfo) => {
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
      body: JSON.stringify({ ...clientFixture, fullName: "Анна Смирнова", pets: [] }),
    });
  });

  await page.goto("/app/clients");
  await page.locator(".client-row").first().click();
  await page.getByRole("button", { name: "Изменить" }).click();
  await page.getByLabel("Имя и фамилия").fill("Анна Смирнова");
  await page.getByRole("button", { name: "Сохранить изменения →" }).click();

  const drawer = page.getByRole("dialog", { name: "Анна Смирнова" });
  await expect(drawer).toBeVisible();
  await expect(drawer.getByRole("button", { name: /Боня Шпиц/ })).toBeVisible();
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

test("pet creation uses the owner admin endpoint", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "desktop-chrome", "One mutation pass is enough");
  await prepare(page);
  await page.route("**/api/v1/clients/" + clientFixture.id + "/pets", async (route) => {
    expect(route.request().method()).toBe("POST");
    expect(route.request().postDataJSON()).toEqual({
      name: "Луна",
      species: "cat",
      breed: "Британская",
      birthDate: null,
      weightKg: 4.5,
      coatType: null,
      temperament: null,
      allergies: "Курица",
      medicalNotes: null,
      vaccinatedUntil: null,
    });
    await route.fulfill({
      status: 201,
      contentType: "application/json",
      body: JSON.stringify({
        ...secondPetFixture,
        id: "617229f5-26c6-432e-a564-04ed3b28566e",
        ownerId: clientFixture.id,
        name: "Луна",
        breed: "Британская",
        weightKg: "4.50",
        allergies: "Курица",
      }),
    });
  });

  await page.goto("/app/clients");
  await page.locator(".client-row").first().click();
  await page.locator(".client-drawer__section").first().getByRole("button", { name: /Добавить/ }).click();
  await page.getByLabel("Кличка").fill("Луна");
  await selectOption(page, "Вид", "Кошка");
  await page.getByLabel("Порода").fill("Британская");
  await page.getByLabel("Вес, кг").fill("4.5");
  await page.getByLabel("Аллергии").fill("Курица");
  await page.getByRole("button", { name: "Добавить питомца →" }).click();

  const drawer = page.getByRole("dialog", { name: "Анна Петрова" });
  await expect(drawer).toBeVisible();
  await expect(drawer.getByText("Луна", { exact: true })).toBeVisible();
  await expect(page.getByText("Питомец добавлен")).toBeVisible();
  await expect(page.locator(".client-pets > button")).toHaveCount(2);
  expect(petFixture.ownerId).toBe(clientFixture.id);
});
