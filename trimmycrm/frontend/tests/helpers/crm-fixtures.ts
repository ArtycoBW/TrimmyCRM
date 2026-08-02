import type { Page, Route } from "@playwright/test";

import { siteFixture } from "./app-fixtures";
import {
  clientFixture,
  petFixture,
  scheduleAppointment,
} from "./schedule-fixtures";

async function json(route: Route, body: unknown, status = 200) {
  await route.fulfill({
    status,
    contentType: "application/json",
    body: JSON.stringify(body),
  });
}

export const secondClientFixture = {
  id: "6c4f8956-3de8-41b0-a11e-63a17db18d07",
  tenantId: siteFixture.id,
  email: "maria@example.ru",
  fullName: "Мария Орлова",
  phone: "+79997654321",
  emailVerified: false,
  status: "crm_only",
  createdAt: "2026-07-10T08:00:00Z",
  pets: [],
};

export const secondPetFixture = {
  id: "a83a6bde-d339-4e49-a265-019afef22e65",
  tenantId: siteFixture.id,
  ownerId: secondClientFixture.id,
  name: "Ириска",
  species: "cat" as const,
  breed: "Мейн-кун",
  birthDate: "2022-05-12",
  weightKg: "6.20",
  coatType: "Длинная",
  temperament: "Спокойная, не любит фен",
  allergies: null,
  medicalNotes: null,
  additionalInfo: null,
  vaccinatedUntil: "2027-05-01",
  photos: [],
  documents: [],
  ageYears: 4,
  vaccinationCurrent: true,
  archivedAt: null,
  createdAt: "2026-07-11T08:00:00Z",
};

export const clientDetailsFixture = {
  ...clientFixture,
  pets: [petFixture],
  appointmentHistory: [{
    id: scheduleAppointment.id,
    petId: petFixture.id,
    serviceId: scheduleAppointment.serviceId,
    staffId: scheduleAppointment.staffId,
    startAt: scheduleAppointment.startAt,
    endAt: scheduleAppointment.endAt,
    status: "completed",
    price: "2400.00",
    prepaid: false,
    petName: petFixture.name,
    serviceName: scheduleAppointment.serviceName,
    staffName: scheduleAppointment.staffName,
  }],
};

export const hairProfileFixture = {
  id: "79a3a127-61b0-42da-8710-6f874c3dc937",
  tenantId: siteFixture.id,
  clientId: clientFixture.id,
  hairLength: "medium" as const,
  density: "high" as const,
  texture: "wavy" as const,
  porosity: "unknown" as const,
  conditionNotes: "Осветлённые концы",
  scalpSensitivityNotes: null,
  grayPercentage: 15,
  naturalColor: "уровень 6",
  currentColor: "уровень 7",
  colorHistory: "Мелирование шесть месяцев назад",
  beardLength: null,
  beardStyle: null,
  moustacheStyle: null,
  preferences: "Сохранять длину ниже плеч",
  version: 3,
  updatedById: "0f4d5f69-b8ad-4ca3-b3cb-663b22f424f1",
  createdAt: "2026-07-11T08:00:00Z",
  updatedAt: "2026-07-15T08:00:00Z",
};

export async function mockCrmApis(page: Page) {
  await page.route("**/api/v1/admin/pets**", async (route) => {
    const url = new URL(route.request().url());
    const limit = Number(url.searchParams.get("limit") || 24);
    await json(route, {
      items: [petFixture, secondPetFixture],
      total: 2,
      page: Number(url.searchParams.get("page") || 1),
      limit,
    });
  });

  await page.route("**/api/v1/clients**", async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const method = request.method();

    if (url.pathname.endsWith("/clients/" + clientFixture.id + "/hair-profile")) {
      if (method === "GET") {
        await json(route, hairProfileFixture);
        return;
      }
      if (method === "PUT") {
        const payload = request.postDataJSON();
        await json(route, {
          ...hairProfileFixture,
          ...payload,
          version: hairProfileFixture.version + 1,
          updatedAt: "2026-07-16T08:00:00Z",
        });
        return;
      }
    }

    if (method === "GET" && url.pathname.endsWith("/clients/" + clientFixture.id)) {
      await json(route, clientDetailsFixture);
      return;
    }

    if (method === "GET" && url.pathname.endsWith("/clients/" + secondClientFixture.id)) {
      await json(route, {
        ...secondClientFixture,
        pets: [secondPetFixture],
        appointmentHistory: [],
      });
      return;
    }

    if (method === "GET" && url.pathname.endsWith("/clients")) {
      const limit = Number(url.searchParams.get("limit") || 20);
      await json(route, {
        items: [clientFixture, secondClientFixture],
        total: 2,
        page: Number(url.searchParams.get("page") || 1),
        limit,
      });
      return;
    }

    if (method === "POST" && url.pathname.endsWith("/clients/" + clientFixture.id + "/pets")) {
      await json(route, { ...secondPetFixture, ownerId: clientFixture.id }, 201);
      return;
    }

    if (method === "POST" && url.pathname.endsWith("/clients")) {
      await json(route, secondClientFixture, 201);
      return;
    }

    if (method === "PATCH" && url.pathname.endsWith("/clients/" + clientFixture.id)) {
      await json(route, { ...clientFixture, fullName: "Анна Смирнова" });
      return;
    }

    await json(route, { message: "Unexpected CRM request" }, 500);
  });
}
