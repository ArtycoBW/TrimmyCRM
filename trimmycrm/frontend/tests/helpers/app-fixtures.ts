import type { Page, Route } from "@playwright/test";

async function json(route: Route, body: unknown, status = 200) {
  await route.fulfill({
    status,
    contentType: "application/json",
    body: JSON.stringify(body),
  });
}

export const ownerMeFixture = {
  user: {
    id: "0f4d5f69-b8ad-4ca3-b3cb-663b22f424f1",
    email: "owner@example.ru",
    role: "owner",
    fullName: "Ольга Соколова",
    phone: null,
    emailVerified: true,
    status: "active",
    createdAt: "2026-07-01T10:00:00Z",
  },
  subscription: {
    id: "6e73d1de-4a9d-4b29-8dbf-041b59a920d7",
    plan: {
      id: "90cebf0d-d770-4dcd-a7ec-a847aa5afdaf",
      code: "start",
      name: "Старт",
      price: "990.00",
      period: "month",
      limits: { clients: 50, staff: 1, blocks: 4 },
      features: ["subdomain", "basic_blocks", "booking", "crm", "email_notifications"],
      isActive: true,
    },
    status: "trialing",
    currentPeriodStart: new Date(Date.now() - 2 * 86_400_000).toISOString(),
    currentPeriodEnd: new Date(Date.now() + 12 * 86_400_000).toISOString(),
    autoRenew: true,
    graceUntil: null,
  },
};

export const siteFixture = {
  id: "19c2e868-6a3d-4ee3-9a9e-f5cc61a843f4",
  ownerId: ownerMeFixture.user.id,
  name: "ФОРМА",
  slug: "forma",
  salonType: "women_hair_salon",
  serviceFocuses: ["haircut", "color", "styling", "care"],
  locale: "ru-RU",
  currency: "RUB",
  customDomain: null,
  domainVerified: false,
  description: null,
  city: "Москва",
  street: null,
  phone: null,
  workHours: {},
  socials: {},
  logoUrl: null,
  theme: { vermillion: "#d15022", acidMint: "#75dfb5", pureBlack: "#000000", paperWhite: "#ffffff" },
  timezone: "Europe/Moscow",
  templateKey: "women-hair",
  status: "draft",
  publishedAt: null,
  draftVersion: 0,
  publishedVersion: null,
  createdAt: "2026-07-16T10:00:00Z",
  updatedAt: "2026-07-16T10:00:00Z",
};

export async function mockOwnerProfile(page: Page) {
  await page.route("**/api/v1/auth/me", (route) => json(route, ownerMeFixture));
}

export async function mockExistingSite(page: Page) {
  await page.route("**/api/v1/sites/mine", (route) => json(route, siteFixture));
}

export async function mockMissingSite(page: Page) {
  await page.route("**/api/v1/sites/mine", (route) =>
    json(route, {
      statusCode: 404,
      error: "Not Found",
      message: "Сайт ещё не создан",
      code: "site_not_found",
    }, 404),
  );
}

export async function mockDashboardApis(page: Page) {
  const salonNow = new Date(Date.now() + 3 * 60 * 60_000);
  const appointmentStart = new Date(Date.UTC(
    salonNow.getUTCFullYear(),
    salonNow.getUTCMonth(),
    salonNow.getUTCDate(),
    9,
  ));
  const appointmentEnd = new Date(appointmentStart.getTime() + 90 * 60_000);
  await page.route("**/api/v1/admin/appointments**", (route) =>
    json(route, [{
      id: "16c82824-367b-4b95-a98b-82bcaf00a3c1",
      tenantId: siteFixture.id,
      tenantUserId: "b3c65cbd-8a91-4d6b-8aaf-ef415a75fc6b",
      serviceId: "063b61c0-c8fd-4ad5-ab6c-d74873f856a5",
      staffId: "e43f7318-1438-48fe-a7e5-9a14c87ee233",
      startAt: appointmentStart.toISOString(),
      endAt: appointmentEnd.toISOString(),
      status: "completed",
      price: "2400.00",
      prepaid: false,
      notes: null,
      version: 2,
      createdAt: appointmentStart.toISOString(),
      clientName: "Анна",
      serviceName: "Комплексный уход",
      staffName: "Мария",
      items: [{
        id: "fb2832e5-bcb5-47df-8847-8f51e385a36d",
        serviceId: "063b61c0-c8fd-4ad5-ab6c-d74873f856a5",
        serviceName: "Комплексный уход",
        variantId: null,
        variantName: null,
        quantity: 1,
        unitPrice: "2400.00",
        durationMin: 90,
        position: 0,
        addOns: [],
      }],
    }]),
  );
  await page.route("**/api/v1/clients**", (route) =>
    json(route, {
      items: [{ id: "b3c65cbd-8a91-4d6b-8aaf-ef415a75fc6b", createdAt: new Date().toISOString() }],
      total: 12,
      page: 1,
      limit: 100,
    }),
  );
  await page.route("**/api/v1/services**", (route) =>
    json(route, [{
      id: "063b61c0-c8fd-4ad5-ab6c-d74873f856a5",
      tenantId: siteFixture.id,
      name: "Комплексный уход",
      description: null,
      price: "2400.00",
      durationMin: 90,
      bufferBeforeMin: 0,
      bufferAfterMin: 15,
      category: "Стрижки",
      isActive: true,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    }]),
  );
  await page.route("**/api/v1/staff**", (route) =>
    json(route, [{
      id: "e43f7318-1438-48fe-a7e5-9a14c87ee233",
      tenantId: siteFixture.id,
      userId: null,
      name: "Мария",
      specialization: "Стилист",
      photoUrl: null,
      schedule: {},
      serviceIds: ["063b61c0-c8fd-4ad5-ab6c-d74873f856a5"],
      isActive: true,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    }]),
  );
}
