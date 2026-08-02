import { expect, test } from "@playwright/test";

import { mockOwnerProfile } from "./helpers/app-fixtures";
import {
  mockCatalogApis,
  mockCatalogSite,
  salonScheduleFixture,
  scheduleExceptionFixture,
  secondServiceFixture,
  secondStaffFixture,
} from "./helpers/catalog-fixtures";
import { selectOption } from "./helpers/ui";
import { serviceFixture, staffFixture } from "./helpers/schedule-fixtures";

async function prepare(page: import("@playwright/test").Page) {
  await mockOwnerProfile(page);
  await mockCatalogSite(page);
  await mockCatalogApis(page);
}

async function expectNoRightOverflow(page: import("@playwright/test").Page) {
  const geometry = await page.evaluate(() => ({
    viewport: innerWidth,
    document: document.documentElement.scrollWidth,
  }));
  expect(geometry.document).toBeLessThanOrEqual(geometry.viewport + 1);
}

test("service catalog and details stay adaptive", async ({ page }) => {
  await prepare(page);
  await page.goto("/app/services");

  await expect(page.getByRole("heading", { name: "Услуги." })).toBeVisible();
  await expect(page.locator(".service-card")).toHaveCount(2);
  await expect(page.getByText("Экспресс-линька", { exact: true })).toBeVisible();
  await expectNoRightOverflow(page);

  await page.locator(".service-card").first().click();
  const drawer = page.getByRole("dialog", { name: "Комплексный уход" });
  await expect(drawer).toBeVisible();
  await expect(drawer.getByText("Мария", { exact: true })).toBeVisible();
  await expect(drawer.getByText("2 400 ₽", { exact: true })).toBeVisible();
  await expectNoRightOverflow(page);
});

test("team profile exposes services, weekly shifts and exceptions", async ({ page }) => {
  await prepare(page);
  await page.goto("/app/staff");

  await expect(page.getByRole("heading", { name: "Мастера." })).toBeVisible();
  await expect(page.locator(".staff-card")).toHaveCount(2);
  await expect(page.getByText("Елена Морозова", { exact: true })).toBeVisible();
  if (await page.evaluate(() => innerWidth > 760)) {
    const filter = page.locator(".catalog-filter");
    const trigger = filter.getByRole("combobox");
    const [toolbarBox, filterBox, triggerBox] = await Promise.all([
      page.locator(".catalog-toolbar").boundingBox(),
      filter.boundingBox(),
      trigger.boundingBox(),
    ]);
    expect(toolbarBox?.height).toBeLessThanOrEqual(68);
    expect(filterBox).not.toBeNull();
    expect(triggerBox).not.toBeNull();
    expect(triggerBox!.x).toBeGreaterThanOrEqual(filterBox!.x - 1);
    expect(triggerBox!.x + triggerBox!.width).toBeLessThanOrEqual(filterBox!.x + filterBox!.width + 1);
    expect(triggerBox!.y).toBeGreaterThanOrEqual(filterBox!.y - 1);
    expect(triggerBox!.y + triggerBox!.height).toBeLessThanOrEqual(filterBox!.y + filterBox!.height + 1);
  }
  await expectNoRightOverflow(page);

  await page.locator(".staff-card").first().click();
  const drawer = page.getByRole("dialog", { name: "Мария" });
  await expect(drawer).toBeVisible();
  await expect(drawer.getByText("Комплексный уход", { exact: true })).toBeVisible();
  await expect(drawer.getByText("Обучение", { exact: true })).toBeVisible();
  await expect(drawer.locator(".staff-week article")).toHaveCount(7);
  await expectNoRightOverflow(page);
});

test("service creation sends the complete current payload", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "desktop-chrome", "One mutation pass is enough");
  await prepare(page);
  await page.route("**/api/v1/services", async (route) => {
    if (route.request().method() === "GET") {
      await route.fallback();
      return;
    }
    expect(route.request().method()).toBe("POST");
    expect(route.request().postDataJSON()).toEqual({
      name: "SPA-уход",
      description: "Маска, массаж и уход за шерстью",
      price: 1600,
      durationMin: 60,
      bufferBeforeMin: 5,
      bufferAfterMin: 10,
      category: "Уход",
      isActive: true,
    });
    await route.fulfill({
      status: 201,
      contentType: "application/json",
      body: JSON.stringify({
        ...secondServiceFixture,
        id: "cbdfe34f-1ed5-4d18-98a7-20e90b89fb89",
        name: "SPA-уход",
        description: "Маска, массаж и уход за шерстью",
        price: "1600.00",
        isActive: true,
      }),
    });
  });

  await page.goto("/app/services");
  await page.getByRole("button", { name: /Добавить услугу/ }).click();
  await page.getByLabel("Название").fill("SPA-уход");
  await selectOption(page, "Категория", "Уход");
  await page.getByLabel("Цена, ₽").fill("1600");
  await page.getByLabel("Длительность, мин").fill("60");
  await page.getByLabel("Подготовка до, мин").fill("5");
  await page.getByLabel("Буфер после, мин").fill("10");
  await page.getByLabel(/Описание/).fill("Маска, массаж и уход за шерстью");
  await page.getByRole("button", { name: "Добавить услугу →" }).click();

  await expect(page.getByRole("dialog", { name: "SPA-уход" })).toBeVisible();
  await expect(page.getByText("Услуга добавлена")).toBeVisible();
});

test("service editing and removal follow PATCH then DELETE", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "desktop-chrome", "One mutation pass is enough");
  await prepare(page);
  let deleted = false;
  await page.route("**/api/v1/services/" + serviceFixture.id, async (route) => {
    if (route.request().method() === "PATCH") {
      expect(route.request().postDataJSON()).toEqual({
        name: "Комплекс премиум",
        description: null,
        price: 2400,
        durationMin: 90,
        bufferBeforeMin: 0,
        bufferAfterMin: 15,
        category: "Груминг",
        isActive: true,
      });
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ ...serviceFixture, name: "Комплекс премиум" }),
      });
      return;
    }
    expect(route.request().method()).toBe("DELETE");
    deleted = true;
    await route.fulfill({ status: 204 });
  });

  await page.goto("/app/services");
  await page.locator(".service-card").first().click();
  await page.getByRole("button", { name: "Изменить", exact: true }).click();
  await page.getByLabel("Название").fill("Комплекс премиум");
  await page.getByRole("button", { name: "Сохранить изменения →" }).click();
  await expect(page.getByRole("dialog", { name: "Комплекс премиум" })).toBeVisible();

  await page.getByRole("button", { name: "Убрать услугу" }).click();
  await page.getByRole("button", { name: "Подтвердить" }).click();
  await expect(page.getByText("Каталог услуг обновлён")).toBeVisible();
  expect(deleted).toBe(true);
});

test("staff invitation keeps inherited salon schedule empty", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "desktop-chrome", "One mutation pass is enough");
  await prepare(page);
  await page.route("**/api/v1/staff", async (route) => {
    if (route.request().method() === "GET") {
      await route.fallback();
      return;
    }
    expect(route.request().method()).toBe("POST");
    expect(route.request().postDataJSON()).toEqual({
      name: "Алина Романова",
      specialization: "Грумер-универсал",
      schedule: {},
      serviceIds: [serviceFixture.id],
      isActive: true,
      email: "alina@example.ru",
    });
    await route.fulfill({
      status: 201,
      contentType: "application/json",
      body: JSON.stringify({
        ...secondStaffFixture,
        id: "7c3bf08c-4ab5-47c7-a86e-fe85d4a67fd6",
        name: "Алина Романова",
        specialization: "Грумер-универсал",
        schedule: {},
        isActive: true,
      }),
    });
  });

  await page.goto("/app/staff");
  await page.getByRole("button", { name: /Добавить мастера/ }).click();
  await page.getByLabel("Имя и фамилия").fill("Алина Романова");
  await page.getByLabel(/Email/).fill("alina@example.ru");
  await page.getByLabel("Специализация").fill("Грумер-универсал");
  await page.getByLabel(/Комплексный уход/).check();
  await page.getByRole("button", { name: "Добавить мастера →" }).click();

  await expect(page.getByRole("dialog", { name: "Алина Романова" })).toBeVisible();
  await expect(page.getByText("Мастер добавлен")).toBeVisible();
});

test("staff edit uploads a public photo and custom shifts", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "desktop-chrome", "One mutation pass is enough");
  await prepare(page);
  const photoUrl = "/api/v1/public/media/9c5aa3af-fb71-43e2-b864-ab7a04bc1752";
  await page.route("**/api/v1/staff/" + staffFixture.id, async (route) => {
    expect(route.request().method()).toBe("PATCH");
    expect(route.request().postDataJSON()).toEqual({
      name: "Мария",
      specialization: "Грумер",
      schedule: {
        ...salonScheduleFixture,
        monday: [{ start: "10:00", end: "18:00" }],
      },
      serviceIds: [serviceFixture.id],
      isActive: true,
    });
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        ...staffFixture,
        schedule: {
          ...salonScheduleFixture,
          monday: [{ start: "10:00", end: "18:00" }],
        },
      }),
    });
  });
  await page.route("**/api/v1/media", async (route) => {
    expect(route.request().method()).toBe("POST");
    expect(route.request().headers()["content-type"]).toContain("multipart/form-data");
    const body = route.request().postDataBuffer()?.toString("utf8") || "";
    expect(body).toContain('name="purpose"');
    expect(body).toContain("staff");
    expect(body).toContain('name="targetId"');
    expect(body).toContain(staffFixture.id);
    await route.fulfill({
      status: 201,
      contentType: "application/json",
      body: JSON.stringify({
        id: "9c5aa3af-fb71-43e2-b864-ab7a04bc1752",
        url: photoUrl,
        purpose: "staff",
        isPublic: true,
        contentType: "image/png",
        sizeBytes: 8,
        createdAt: "2026-07-16T10:00:00Z",
      }),
    });
  });

  await page.goto("/app/staff");
  await page.locator(".staff-card").first().click();
  await page.getByRole("button", { name: "Изменить профиль" }).click();
  await page.getByRole("button", { name: "Свои смены" }).click();
  await page.getByLabel("Понедельник, начало интервала 1").fill("10:00");
  await page.locator(".staff-form input[type=file]").setInputFiles({
    name: "maria.png",
    mimeType: "image/png",
    buffer: Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
  });
  await page.getByRole("button", { name: "Сохранить профиль →" }).click();

  const drawer = page.getByRole("dialog", { name: "Мария" });
  await expect(drawer).toBeVisible();
  await expect(drawer.locator(".staff-drawer__portrait")).toHaveAttribute("style", new RegExp(photoUrl.replaceAll("/", "\\/")));
  await expect(page.getByText("Профиль мастера сохранён")).toBeVisible();
});

test("schedule exception is converted from salon time to ISO", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "desktop-chrome", "One mutation pass is enough");
  await prepare(page);
  const created = {
    ...scheduleExceptionFixture,
    id: "328948b1-84e0-4191-bd23-64a66fef54f0",
    startsAt: "2026-08-10T07:00:00.000Z",
    endsAt: "2026-08-10T09:00:00.000Z",
    kind: "working",
    reason: "Дополнительная смена",
  };
  await page.route("**/api/v1/staff/" + staffFixture.id + "/schedule-exceptions", async (route) => {
    if (route.request().method() === "GET") {
      await route.fallback();
      return;
    }
    expect(route.request().method()).toBe("POST");
    expect(route.request().postDataJSON()).toEqual({
      startsAt: "2026-08-10T07:00:00.000Z",
      endsAt: "2026-08-10T09:00:00.000Z",
      kind: "working",
      reason: "Дополнительная смена",
    });
    await route.fulfill({
      status: 201,
      contentType: "application/json",
      body: JSON.stringify(created),
    });
  });

  await page.goto("/app/staff");
  await page.locator(".staff-card").first().click();
  await expect(page.getByText("Обучение", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "+ Добавить", exact: true }).click();
  await selectOption(page, "Тип изменения", /Рабочее окно/);
  await page.getByLabel("Начало").fill("2026-08-10T10:00");
  await page.getByLabel("Окончание").fill("2026-08-10T12:00");
  await page.getByLabel(/Причина/).fill("Дополнительная смена");
  await page.getByRole("button", { name: "Добавить в график →" }).click();

  await expect(page.getByText("Дополнительная смена", { exact: true })).toBeVisible();
  await expect(page.getByText("График мастера обновлён")).toBeVisible();
});
