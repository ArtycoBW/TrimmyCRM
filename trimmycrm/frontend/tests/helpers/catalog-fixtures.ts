import type { Page, Route } from "@playwright/test";

import { siteFixture } from "./app-fixtures";
import { serviceFixture, staffFixture } from "./schedule-fixtures";

async function json(route: Route, body: unknown, status = 200) {
  await route.fulfill({
    status,
    contentType: "application/json",
    body: JSON.stringify(body),
  });
}

export const salonScheduleFixture = {
  monday: [{ start: "09:00", end: "18:00" }],
  tuesday: [{ start: "09:00", end: "18:00" }],
  wednesday: [{ start: "09:00", end: "18:00" }],
  thursday: [{ start: "09:00", end: "18:00" }],
  friday: [{ start: "09:00", end: "18:00" }],
  saturday: [{ start: "10:00", end: "16:00" }],
};

export const catalogSiteFixture = {
  ...siteFixture,
  workHours: salonScheduleFixture,
};

export const secondServiceFixture = {
  ...serviceFixture,
  id: "8c724864-f2c4-48ec-a75e-e75c6b86ae4a",
  name: "Экспресс-линька",
  description: "Вычёсывание подшёрстка и уход за кожей",
  price: "1800.00",
  durationMin: 60,
  bufferBeforeMin: 0,
  bufferAfterMin: 10,
  category: "Уход",
  isActive: false,
};

export const secondStaffFixture = {
  ...staffFixture,
  id: "1f84b2e2-e701-4bcc-a92b-b43755c8a02d",
  userId: "59cfdc80-605e-4c24-9a40-1957a3bf9530",
  name: "Елена Морозова",
  specialization: "Триммер · жесткошёрстные породы",
  schedule: {
    monday: [{ start: "11:00", end: "19:00" }],
    wednesday: [{ start: "11:00", end: "19:00" }],
  },
  serviceIds: [serviceFixture.id],
  isActive: false,
};

export const scheduleExceptionFixture = {
  id: "868997a4-f585-429f-99ac-c0ad9a882013",
  staffId: staffFixture.id,
  startsAt: "2026-08-03T06:00:00Z",
  endsAt: "2026-08-03T15:00:00Z",
  kind: "day_off",
  reason: "Обучение",
  createdAt: "2026-07-16T10:00:00Z",
  updatedAt: "2026-07-16T10:00:00Z",
};

export async function mockCatalogSite(page: Page) {
  await page.route("**/api/v1/sites/mine", (route) => json(route, catalogSiteFixture));
}

export async function mockCatalogApis(page: Page) {
  await page.route("**/api/v1/services**", async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    if (request.method() === "GET" && url.pathname.endsWith("/services")) {
      await json(route, [serviceFixture, secondServiceFixture]);
      return;
    }
    if (request.method() === "POST" && url.pathname.endsWith("/services")) {
      await json(route, secondServiceFixture, 201);
      return;
    }
    if (request.method() === "PATCH") {
      await json(route, serviceFixture);
      return;
    }
    if (request.method() === "DELETE") {
      await route.fulfill({ status: 204 });
      return;
    }
    await json(route, { message: "Unexpected services request" }, 500);
  });

  await page.route("**/api/v1/staff**", async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    if (request.method() === "GET" && url.pathname.includes("/schedule-exceptions")) {
      await json(route, [scheduleExceptionFixture]);
      return;
    }
    if (request.method() === "GET" && url.pathname.endsWith("/staff")) {
      await json(route, [staffFixture, secondStaffFixture]);
      return;
    }
    if (request.method() === "POST" && url.pathname.endsWith("/schedule-exceptions")) {
      await json(route, scheduleExceptionFixture, 201);
      return;
    }
    if (request.method() === "POST" && url.pathname.endsWith("/staff")) {
      await json(route, secondStaffFixture, 201);
      return;
    }
    if (request.method() === "PATCH") {
      await json(route, staffFixture);
      return;
    }
    if (request.method() === "DELETE") {
      await route.fulfill({ status: 204 });
      return;
    }
    await json(route, { message: "Unexpected staff request" }, 500);
  });
}
