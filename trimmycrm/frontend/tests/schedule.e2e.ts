import { expect, test } from "@playwright/test";

import { mockExistingSite, mockOwnerProfile } from "./helpers/app-fixtures";
import {
  clientFixture,
  colorServiceFixture,
  mockScheduleApis,
  petFixture,
  scheduleAppointment,
  serviceFixture,
  staffFixture,
} from "./helpers/schedule-fixtures";
import { selectOption } from "./helpers/ui";

async function prepare(page: import("@playwright/test").Page) {
  await mockOwnerProfile(page);
  await mockExistingSite(page);
  await mockScheduleApis(page);
}

test("weekly calendar switches to an agenda without overflow on mobile", async ({ page }, testInfo) => {
  await prepare(page);
  await page.goto("/app/calendar");

  await expect(page.getByRole("heading", { name: "Календарь." })).toBeVisible();

  if (testInfo.project.name === "mobile-chrome") {
    const calendar = page.locator(".calendar-agenda");
    await expect(calendar).toBeVisible();
    await expect(page.locator(".calendar-desktop")).toBeHidden();
    await expect(calendar.getByText("Боня", { exact: true })).toBeVisible();
    await expect(calendar.getByText(/Стрижка и укладка/)).toBeVisible();
  } else {
    const calendar = page.locator(".calendar-desktop");
    await expect(calendar).toBeVisible();
    await expect(page.locator(".calendar-agenda")).toBeHidden();
    await expect(calendar.getByText("Боня", { exact: true })).toBeVisible();
    await expect(calendar.getByText("Стрижка и укладка", { exact: true })).toBeVisible();
  }

  const geometry = await page.evaluate(() => ({
    viewport: innerWidth,
    document: document.documentElement.scrollWidth,
  }));
  expect(geometry.document).toBeLessThanOrEqual(geometry.viewport + 1);

  await page.getByRole("button", { name: "На весь экран" }).click();
  await expect(page.locator(".schedule-page")).toHaveClass(/schedule-page--calendar-fullscreen/);
  await expect(page.locator("body")).toHaveClass(/schedule-calendar-fullscreen/);
  const fullscreen = await page.locator(".schedule-page").boundingBox();
  expect(fullscreen).not.toBeNull();
  expect(fullscreen!.x).toBeLessThanOrEqual(1);
  expect(fullscreen!.y).toBeLessThanOrEqual(1);
  expect(fullscreen!.width).toBeGreaterThanOrEqual(geometry.viewport - 1);
  await page.getByRole("button", { name: "Свернуть" }).click();
  await expect(page.locator(".schedule-page")).not.toHaveClass(/schedule-page--calendar-fullscreen/);
});

test("overlapping visits are laid out side by side instead of covering each other", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "desktop-chrome", "The desktop time grid owns collision layout");
  await prepare(page);
  const overlaps = ["first", "second", "third"].map((suffix, index) => ({
    ...scheduleAppointment,
    id: `overlap-${suffix}`,
    petName: `Питомец ${index + 1}`,
    staffId: `staff-${index}`,
  }));
  await page.route("**/api/v1/admin/appointments**", (route) => route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify(overlaps),
  }));

  await page.goto("/app/calendar");
  const events = page.locator(".calendar-event");
  await expect(events).toHaveCount(3);
  await expect(events.first()).toHaveAttribute("data-calendar-lanes", "3");
  const boxes = await events.evaluateAll((items) => items.map((item) => {
    const box = item.getBoundingClientRect();
    return { left: Math.round(box.left), right: Math.round(box.right) };
  }));
  expect(new Set(boxes.map((box) => box.left)).size).toBe(3);
  for (let index = 1; index < boxes.length; index += 1) {
    expect(boxes[index - 1].right).toBeLessThanOrEqual(boxes[index].left);
  }
});

test("week switch keeps the current calendar visible while data refreshes", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "desktop-chrome", "One desktop refresh pass is enough");
  await prepare(page);
  let requests = 0;
  await page.route("**/api/v1/admin/appointments**", async (route) => {
    requests += 1;
    if (requests > 1) await new Promise((resolve) => setTimeout(resolve, 260));
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify([scheduleAppointment]) });
  });

  await page.goto("/app/calendar");
  await expect(page.locator(".calendar-desktop")).toBeVisible();
  await page.getByRole("button", { name: "Следующая неделя" }).click();
  await expect(page.locator(".schedule-calendar__refresh")).toBeVisible();
  await expect(page.locator(".schedule-page--loading")).toHaveCount(0);
  await expect(page.locator(".calendar-desktop")).toBeVisible();
  await expect(page.locator(".schedule-calendar__refresh")).toBeHidden();
});

test("date picker keeps its month controls inside the padded card", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "desktop-chrome", "Geometry is checked once on desktop");
  await prepare(page);
  await page.goto("/app/calendar");
  await page.getByRole("button", { name: "Новая запись" }).click();
  await page.getByRole("button", { name: "Дата визита" }).click();
  const content = page.locator(".ui-date-picker__content");
  const previous = content.locator(".ui-calendar__nav-button--previous");
  const next = content.locator(".ui-calendar__nav-button--next");
  const [contentBox, previousBox, nextBox] = await Promise.all([
    content.boundingBox(), previous.boundingBox(), next.boundingBox(),
  ]);
  expect(contentBox).not.toBeNull();
  expect(previousBox).not.toBeNull();
  expect(nextBox).not.toBeNull();
  expect(previousBox!.x).toBeGreaterThan(contentBox!.x + 10);
  expect(nextBox!.x + nextBox!.width).toBeLessThan(contentBox!.x + contentBox!.width - 10);
});

test("appointment status update sends expectedVersion", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "desktop-chrome", "One mutation pass is enough");
  await prepare(page);
  await page.route("**/api/v1/admin/appointments/" + scheduleAppointment.id, async (route) => {
    expect(route.request().method()).toBe("PATCH");
    expect(route.request().postDataJSON()).toEqual({
      status: "confirmed",
      expectedVersion: 1,
    });
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ ...scheduleAppointment, status: "confirmed", version: 2 }),
    });
  });

  await page.goto("/app/calendar");
  await page.getByRole("button", { name: /10:00, Боня, Стрижка и укладка/ }).click();
  await expect(page.getByRole("dialog", { name: "Боня" })).toBeVisible();
  await page.getByRole("button", { name: "Подтвердить" }).click();

  await expect(page.locator(".appointment-drawer .crm-status")).toHaveText("Подтверждена");
  await expect(page.getByText("Статус записи обновлён")).toBeVisible();
});

test("manual appointment sends multiple catalog items with options", async ({ page }, testInfo) => {
  await prepare(page);
  await page.route("**/api/v1/admin/appointments", async (route) => {
    expect(route.request().method()).toBe("POST");
    const payload = route.request().postDataJSON() as Record<string, unknown>;
    expect(payload).toMatchObject({
      tenantUserId: clientFixture.id,
      petId: petFixture.id,
      items: [
        {
          serviceId: serviceFixture.id,
          variantId: serviceFixture.variants[0].id,
          addonIds: [serviceFixture.addons[0].id],
        },
        {
          serviceId: colorServiceFixture.id,
          variantId: null,
          addonIds: [],
        },
      ],
      staffId: staffFixture.id,
      notes: null,
    });
    expect(payload.startAt).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:00\.000Z$/);
    await route.fulfill({
      status: 201,
      contentType: "application/json",
      body: JSON.stringify({
        ...scheduleAppointment,
        id: "4d225595-6abc-4a53-8766-7044fbd8a541",
        startAt: payload.startAt,
      }),
    });
  });

  await page.goto("/app/calendar");
  await page.getByRole("button", { name: "Новая запись" }).click();
  await selectOption(page, "Клиент", clientFixture.fullName);
  await expect(page.getByLabel("Питомец")).toBeEnabled();
  await selectOption(page, "Питомец", /Боня/);
  await selectOption(page, "Услуги визита", /Стрижка и укладка/);
  await page.getByRole("button", { name: "Добавить услугу" }).click();
  await selectOption(page, /Вариант обязательно/, /Длинные волосы/);
  await page.getByRole("checkbox", { name: /Экспресс-уход/ }).check();
  await selectOption(page, "Услуги визита", /Тонирование/);
  await page.getByRole("button", { name: "Добавить услугу" }).click();
  await selectOption(page, /^Мастер$/, staffFixture.name);
  await expect(page.getByText("195 мин", { exact: false })).toBeVisible();
  await expect(page.getByText("7 000 ₽", { exact: false })).toBeVisible();
  if (testInfo.project.name === "mobile-chrome") {
    const geometry = await page.evaluate(() => ({
      viewport: innerWidth,
      document: document.documentElement.scrollWidth,
    }));
    expect(geometry.document).toBeLessThanOrEqual(geometry.viewport + 1);
  }
  await expect(page.locator('input[type="date"]')).toHaveCount(0);
  await page.getByRole("button", { name: "Дата визита" }).click();
  await expect(page.locator(".ui-date-picker__content")).toBeVisible();
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: "Добавить запись →" }).click();

  await expect(page.getByText("Новая запись добавлена")).toBeVisible();
  await expect(page.getByRole("dialog", { name: "Боня" })).toBeVisible();
});

test("appointments list opens the same detail drawer", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "desktop-chrome", "Desktop list coverage is enough");
  await prepare(page);
  await page.goto("/app/appointments");

  await expect(page.getByRole("heading", { name: "Все записи." })).toBeVisible();
  await expect(page.locator(".appointments-row")).toHaveCount(1);
  await page.locator(".appointments-row").click();
  await expect(page.getByRole("dialog", { name: "Боня" })).toBeVisible();
  await expect(page.getByText("Не стричь хвост коротко")).toBeVisible();
});
