import type { Page, Route } from "@playwright/test";

import { salonDayKey } from "../../src/lib/app/dashboard";
import { zonedDateTimeToIso } from "../../src/lib/app/calendar";
import { siteFixture } from "./app-fixtures";

async function json(route: Route, body: unknown, status = 200) {
  await route.fulfill({
    status,
    contentType: "application/json",
    body: JSON.stringify(body),
  });
}

const timezone = "Europe/Moscow";
const today = salonDayKey(new Date(), timezone);

export const clientFixture = {
  id: "b3c65cbd-8a91-4d6b-8aaf-ef415a75fc6b",
  tenantId: siteFixture.id,
  email: "anna@example.ru",
  fullName: "Анна Петрова",
  phone: "+79991234567",
  emailVerified: true,
  status: "active",
  createdAt: new Date().toISOString(),
  pets: [],
};

export const petFixture = {
  id: "68d8df57-cda3-4fd0-9b35-b651f279b2dc",
  tenantId: siteFixture.id,
  ownerId: clientFixture.id,
  name: "Боня",
  species: "dog",
  breed: "Шпиц",
  birthDate: null,
  weightKg: "4.80",
  coatType: null,
  temperament: null,
  allergies: null,
  medicalNotes: null,
  additionalInfo: "Боится громкого фена, лучше сделать короткий перерыв.",
  vaccinatedUntil: null,
  photos: [],
  documents: [
    {
      id: "c0fe0873-7026-42fc-b597-51da49cd5420",
      type: "passport",
      filename: "vet-passport.pdf",
      url: "/api/v1/pets/68d8df57-cda3-4fd0-9b35-b651f279b2dc/documents/c0fe0873-7026-42fc-b597-51da49cd5420/content",
      uploadedAt: new Date().toISOString(),
    },
  ],
  ageYears: 3,
  vaccinationCurrent: null,
  archivedAt: null,
  createdAt: new Date().toISOString(),
};

export const serviceFixture = {
  id: "063b61c0-c8fd-4ad5-ab6c-d74873f856a5",
  tenantId: siteFixture.id,
  name: "Стрижка и укладка",
  description: "Подбор формы, стрижка и финишная укладка",
  categoryId: "b4e14568-f265-4a67-93f8-537076d88429",
  categoryName: "Стрижки",
  price: "2400.00",
  maxPrice: null,
  priceType: "fixed" as const,
  currency: "RUB" as const,
  durationMin: 90,
  bufferBeforeMin: 0,
  bufferAfterMin: 15,
  category: "Стрижки",
  requiresConsultation: false,
  requiresPatchTest: false,
  allowOnlineBooking: true,
  variantSelectionRequired: true,
  preparationText: "Приходите с чистыми сухими волосами",
  aftercareText: "Используйте термозащиту перед укладкой",
  sortOrder: 0,
  isActive: true,
  variants: [{
    id: "9026d564-0738-42e1-9f21-fab8e7bea85b",
    serviceId: "063b61c0-c8fd-4ad5-ab6c-d74873f856a5",
    label: "Длинные волосы",
    priceDelta: "800.00",
    durationDeltaMin: 30,
    sortOrder: 0,
    isActive: true,
  }],
  addons: [{
    id: "b6caf871-9cb3-4a76-8593-885ef03bc50a",
    serviceId: "063b61c0-c8fd-4ad5-ab6c-d74873f856a5",
    name: "Экспресс-уход",
    priceDelta: "600.00",
    durationDeltaMin: 15,
    sortOrder: 0,
    isActive: true,
  }],
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
};

export const colorServiceFixture = {
  ...serviceFixture,
  id: "821a7b8e-9cad-4bed-907c-28ec6b97fe42",
  name: "Тонирование",
  description: "Обновление оттенка волос",
  price: "3200.00",
  durationMin: 60,
  bufferBeforeMin: 0,
  bufferAfterMin: 20,
  variantSelectionRequired: false,
  variants: [],
  addons: [],
};

export const staffFixture = {
  id: "e43f7318-1438-48fe-a7e5-9a14c87ee233",
  tenantId: siteFixture.id,
  userId: null,
  name: "Мария",
  specialization: "Стилист",
  photoUrl: null,
  schedule: {},
  serviceIds: [serviceFixture.id, colorServiceFixture.id],
  isActive: true,
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
};

export const scheduleAppointment = {
  id: "16c82824-367b-4b95-a98b-82bcaf00a3c1",
  tenantId: siteFixture.id,
  tenantUserId: clientFixture.id,
  petId: petFixture.id,
  serviceId: serviceFixture.id,
  staffId: staffFixture.id,
  startAt: zonedDateTimeToIso(today, "10:00", timezone),
  endAt: zonedDateTimeToIso(today, "11:30", timezone),
  status: "new",
  price: "3800.00",
  prepaid: false,
  notes: "Не стричь хвост коротко",
  version: 1,
  createdAt: new Date().toISOString(),
  clientName: clientFixture.fullName,
  petName: petFixture.name,
  serviceName: serviceFixture.name,
  staffName: staffFixture.name,
  items: [{
    id: "fee3312d-92f8-4a96-b914-256a23029db2",
    serviceId: serviceFixture.id,
    variantId: serviceFixture.variants[0].id,
    assignedStaffId: staffFixture.id,
    serviceName: serviceFixture.name,
    variantLabel: serviceFixture.variants[0].label,
    selectedOptions: { source: "catalogSelection" },
    unitPrice: "3800.00",
    finalPrice: null,
    durationMin: 135,
    bufferBeforeMin: 0,
    bufferAfterMin: 15,
    currency: "RUB" as const,
    sortOrder: 0,
    adjustmentReason: null,
    addons: [{
      id: "0353794d-8b7a-427d-8dd1-eb0322cfda66",
      addonId: serviceFixture.addons[0].id,
      name: serviceFixture.addons[0].name,
      price: serviceFixture.addons[0].priceDelta,
      durationMin: serviceFixture.addons[0].durationDeltaMin,
    }],
  }],
};

export async function mockScheduleApis(page: Page) {
  await page.route("**/api/v1/admin/appointments**", async (route) => {
    if (route.request().method() !== "GET") {
      await route.fallback();
      return;
    }
    await json(route, [scheduleAppointment]);
  });
  await page.route("**/api/v1/clients?*", (route) =>
    json(route, { items: [clientFixture], total: 1, page: 1, limit: 100 }),
  );
  await page.route("**/api/v1/clients/" + clientFixture.id, (route) =>
    json(route, { ...clientFixture, pets: [petFixture], appointmentHistory: [] }),
  );
  await page.route("**/api/v1/services", (route) =>
    json(route, [serviceFixture, colorServiceFixture]),
  );
  await page.route("**/api/v1/staff", (route) => json(route, [staffFixture]));
}
