import { expect, test, type Page, type Route } from "@playwright/test";

const tenantOrigin = "http://lapki-nozhnitsy.trimmycrm.localhost:3000";
const serviceId = "063b61c0-c8fd-4ad5-ab6c-d74873f856a5";
const staffId = "e43f7318-1438-48fe-a7e5-9a14c87ee233";
const petId = "68d8df57-cda3-4fd0-9b35-b651f279b2dc";
const tenantId = "19c2e868-6a3d-4ee3-9a9e-f5cc61a843f4";
const clientId = "b3c65cbd-8a91-4d6b-8aaf-ef415a75fc6b";

const site = {
  id: tenantId,
  name: "Лапки и ножницы",
  slug: "lapki-nozhnitsy",
  customDomain: null,
  description: "Бережный груминг для собак и кошек",
  city: "Москва",
  street: "Петровка, 12",
  phone: "+7 (988) 650 16 49",
  workHours: { monday: [{ start: "09:00", end: "20:00" }] },
  socials: {},
  logoUrl: null,
  theme: { color: "#d8ff3e" },
  timezone: "Europe/Moscow",
  templateKey: "default",
  blocks: [
    { id: "hero", type: "hero", position: 0, config: { title: "Лапки и ножницы", subtitle: "Ваш питомец в заботливых руках" }, enabled: true },
    { id: "services", type: "services", position: 1, config: { title: "Услуги и цены" }, enabled: true },
    { id: "gallery", type: "gallery", position: 2, config: { title: "Наши хвостики", columns: 3, items: [{ id: "media-1", src: "/api/v1/public/media/2c5257bf-d8fd-44fb-a9f8-d37e1d3386bd", caption: "Мия после груминга" }] }, enabled: true },
    { id: "reviews", type: "reviews", position: 3, config: { title: "Нас рекомендуют", limit: 6 }, enabled: true },
    { id: "booking", type: "booking", position: 4, config: { title: "Выберите удобное время" }, enabled: true },
    { id: "contacts", type: "contacts", position: 5, config: { title: "Ждём вас" }, enabled: true },
  ],
  version: 4,
  publishedAt: "2026-07-17T12:00:00Z",
};

const service = {
  id: serviceId,
  name: "Комплексный уход",
  description: "Мытьё, стрижка и уход за когтями",
  price: "2400.00",
  durationMin: 90,
  bufferBeforeMin: 0,
  bufferAfterMin: 15,
};

const staff = {
  id: staffId,
  name: "Мария Иванова",
  specialization: "Грумер",
  photoUrl: null,
  serviceIds: [serviceId],
};

const pet = {
  id: petId,
  tenantId,
  ownerId: clientId,
  name: "Боня",
  species: "dog",
  breed: "Шпиц",
  birthDate: null,
  weightKg: null,
  coatType: null,
  temperament: null,
  allergies: null,
  medicalNotes: null,
  additionalInfo: null,
  vaccinatedUntil: null,
  photos: [],
  documents: [],
  ageYears: null,
  vaccinationCurrent: null,
  archivedAt: null,
  createdAt: "2026-07-17T12:00:00Z",
};

async function json(route: Route, body: unknown, status = 200) {
  await route.fulfill({
    status,
    contentType: "application/json",
    headers: {
      "Access-Control-Allow-Origin": tenantOrigin,
      "Access-Control-Allow-Credentials": "true",
      "Access-Control-Allow-Headers": "Authorization, Content-Type, Idempotency-Key",
      "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    },
    body: status === 204 ? undefined : JSON.stringify(body),
  });
}

async function mockPublicSite(page: Page) {
  await page.route("**/api/v1/public/site**", (route) => json(route, site));
  await page.route("**/api/v1/public/services", (route) => json(route, [service]));
  await page.route("**/api/v1/public/staff", (route) => json(route, [staff]));
  await page.route("**/api/v1/public/reviews", (route) => json(route, [{
    id: "28b7526f-004a-4e2f-97ef-b73256cda9ee",
    rating: 5,
    text: "Мия спокойна, а стрижка получилась отличной.",
    authorName: "Клиент",
    createdAt: "2026-07-17T12:00:00Z",
  }]));
}

async function expectNoHorizontalOverflow(page: Page) {
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
}

test("tenant root and preview render salon data instead of the platform landing", async ({ page }) => {
  await mockPublicSite(page);

  await page.goto(tenantOrigin);
  await expect(page.getByRole("heading", { name: "Лапки и ножницы", level: 1 })).toBeVisible();
  await expect(page.getByText("Комплексный уход")).toBeVisible();
  await expect(page.getByText("Петровка, 12").first()).toBeVisible();
  await expect(page.getByText("Мия после груминга")).toBeVisible();
  await expect(page.getByText("Мия спокойна, а стрижка получилась отличной.")).toBeVisible();
  await expect(page.getByText("Онлайн-запись на сайте салона")).toBeVisible();
  await expect(page.getByText("TrimmyCRM")).toHaveCount(0);
  await expect(page.getByText("Салон растёт. Хвосты виляют.")).toHaveCount(0);
  expect(await page.evaluate(() => getComputedStyle(document.body).cursor)).toBe("auto");
  await expectNoHorizontalOverflow(page);

  const previewRequest = page.waitForRequest((request) => request.url().includes("/public/site?previewToken=preview-token"));
  await page.goto(`${tenantOrigin}/preview?token=preview-token-abcdefghijklmnopqrstuvwxyz`);
  await previewRequest;
  await expect(page.getByRole("heading", { name: "Лапки и ножницы", level: 1 })).toBeVisible();
  await expectNoHorizontalOverflow(page);
});

test("tenant login and client portal use the salon identity and Russian appointment statuses", async ({ page }) => {
  const brandedSite = {
    ...site,
    logoUrl: "/api/v1/public/media/2c5257bf-d8fd-44fb-a9f8-d37e1d3386bd",
  };
  await page.route("**/api/v1/public/site**", (route) => json(route, brandedSite));
  await page.route("**/api/v1/public/services", (route) => json(route, [service]));
  await page.route("**/api/v1/public/staff", (route) => json(route, [staff]));
  await page.route("**/api/v1/public/reviews", (route) => json(route, []));

  await page.goto(`${tenantOrigin}/login`);
  await expect(page.locator(".tenant-auth-brand").first()).toContainText("Лапки и ножницы");
  await expect(page.locator(".tenant-auth-brand img").first()).toHaveAttribute("src", brandedSite.logoUrl);
  await expect(page.locator(".brand-mark")).toHaveCount(0);

  await page.route("**/api/v1/t/auth/me", (route) => json(route, {
    id: clientId,
    tenantId,
    email: "client@example.ru",
    role: "client",
    fullName: "Анна Петрова",
    phone: "+79886501649",
    emailVerified: true,
    status: "active",
    createdAt: "2026-07-17T12:00:00Z",
  }));
  await page.route("**/api/v1/pets", (route) => json(route, [pet]));
  await page.route("**/api/v1/appointments/mine**", (route) => json(route, {
    items: [{
      id: "16c82824-367b-4b95-a98b-82bcaf00a3c1",
      tenantId,
      tenantUserId: clientId,
      petId,
      serviceId,
      staffId,
      startAt: "2026-08-05T06:15:00Z",
      endAt: "2026-08-05T06:45:00Z",
      status: "cancelled",
      price: "900.00",
      prepaid: false,
      notes: null,
      version: 1,
      createdAt: "2026-07-17T12:00:00Z",
      clientName: "Анна Петрова",
      petName: "Боня",
      serviceName: "Стрижка когтей и гигиена",
      staffName: "Алексей Воронов",
    }],
    total: 1,
    page: 1,
    limit: 100,
  }));

  await page.goto(`${tenantOrigin}/client`);
  await expect(page.locator(".client-portal__brand")).toContainText("Лапки и ножницы");
  await expect(page.locator(".client-portal__brand img")).toBeVisible();
  await page.getByRole("button", { name: /Мои записи/ }).click();
  await expect(page.locator(".client-appointment-list")).toContainText("Отменена");
  await expect(page.locator(".client-appointment-list")).not.toContainText("CANCELLED");
});

test("client can select a real slot and create an appointment", async ({ page }) => {
  const slotStart = new Date(Date.now() + 86_400_000).toISOString().replace(/T\d{2}:\d{2}/, "T07:00");
  const slotEnd = new Date(new Date(slotStart).getTime() + 90 * 60_000).toISOString();
  let bookingPayload: Record<string, unknown> | null = null;

  await mockPublicSite(page);
  await page.route("**/api/v1/t/auth/me", (route) => json(route, {
    id: clientId,
    tenantId,
    email: "client@example.ru",
    role: "client",
    fullName: "Анна Петрова",
    phone: "+79886501649",
    emailVerified: true,
    status: "active",
    createdAt: "2026-07-17T12:00:00Z",
  }));
  await page.route("**/api/v1/pets", (route) => json(route, [pet]));
  await page.route("**/api/v1/appointments/mine**", (route) => json(route, { items: [], total: 0, page: 1, limit: 100 }));
  await page.route("**/api/v1/booking/slots**", (route) => json(route, {
    timezone: "Europe/Moscow",
    serviceId,
    staffId,
    slots: [{ startAt: slotStart, endAt: slotEnd, available: true }],
  }));
  await page.route("**/api/v1/booking", async (route) => {
    if (route.request().method() === "OPTIONS") {
      await json(route, null, 204);
      return;
    }
    bookingPayload = route.request().postDataJSON() as Record<string, unknown>;
    expect(route.request().headers()["idempotency-key"]).toBeTruthy();
    await json(route, {
      id: "16c82824-367b-4b95-a98b-82bcaf00a3c1",
      tenantId,
      tenantUserId: clientId,
      petId,
      serviceId,
      staffId,
      startAt: slotStart,
      endAt: slotEnd,
      status: "new",
      price: "2400.00",
      prepaid: false,
      notes: null,
      version: 0,
      createdAt: new Date().toISOString(),
      clientName: "Анна Петрова",
      petName: "Боня",
      serviceName: "Комплексный уход",
      staffName: "Мария Иванова",
    }, 201);
  });

  await page.goto(`${tenantOrigin}/client?booking=1`);
  await expect(page.getByRole("heading", { name: "Запись без звонков." })).toBeVisible();
  await expect(page.getByLabel("Питомец")).toContainText("Боня");
  await expect(page.getByLabel("Услуга")).toContainText("Комплексный уход");
  await page.getByLabel("Услуга").click();
  const selectContent = page.locator(".ui-select-content");
  await expect(selectContent).toBeVisible();
  await expect(selectContent).toHaveCSS("background-color", "rgb(255, 255, 255)");
  await expect(selectContent).toHaveCSS("z-index", "2200");
  await page.keyboard.press("Escape");
  await expect(page.locator('input[type="date"]')).toHaveCount(0);
  await page.getByRole("button", { name: "Дата записи" }).click();
  const calendar = page.locator(".ui-date-picker__content");
  await expect(calendar).toBeVisible();
  await expect(calendar).toHaveCSS("background-color", "rgb(255, 255, 255)");
  await expect(calendar.locator(".ui-calendar__day-button")).not.toHaveCount(0);
  await page.keyboard.press("Escape");
  await expect(page.getByRole("button", { name: "10:00" })).toBeVisible();
  await page.getByRole("button", { name: "Подтвердить запись →" }).click();

  await expect(page.getByRole("status")).toContainText("Готово! Запись создана");
  await expect(page.getByText("Комплексный уход")).toBeVisible();
  expect(bookingPayload).toMatchObject({ petId, serviceId, staffId, startAt: slotStart });
  await expectNoHorizontalOverflow(page);
});

test("client can save pet details, photo and veterinary passport", async ({ page }) => {
  let petPayload: Record<string, unknown> | null = null;
  let photoUploaded = false;
  let passportUploaded = false;
  let passportDeleted = false;

  await mockPublicSite(page);
  await page.route("**/api/v1/t/auth/me", (route) => json(route, {
    id: clientId,
    tenantId,
    email: "client@example.ru",
    role: "client",
    fullName: "Анна Петрова",
    phone: "+79886501649",
    emailVerified: true,
    status: "active",
    createdAt: "2026-07-17T12:00:00Z",
  }));
  await page.route("**/api/v1/appointments/mine**", (route) =>
    json(route, { items: [], total: 0, page: 1, limit: 100 }),
  );
  await page.route("**/api/v1/pets", async (route) => {
    if (route.request().method() === "GET") {
      await json(route, []);
      return;
    }
    petPayload = route.request().postDataJSON() as Record<string, unknown>;
    await json(route, {
      ...pet,
      name: "Тоня",
      breed: "Шпиц",
      medicalNotes: petPayload.medicalNotes,
      additionalInfo: petPayload.additionalInfo,
      photos: [],
      documents: [],
    }, 201);
  });
  await page.route(`**/api/v1/pets/${petId}/photos`, async (route) => {
    photoUploaded = route.request().postDataBuffer()?.includes(Buffer.from("test-photo")) || false;
    await json(route, {
      id: "7d29792a-a1af-4327-a897-d652eb296f98",
      url: `/api/v1/pets/${petId}/photos/7d29792a-a1af-4327-a897-d652eb296f98/content`,
      isCover: true,
      position: 0,
      uploadedAt: new Date().toISOString(),
    }, 201);
  });
  await page.route(`**/api/v1/pets/${petId}/documents**`, async (route) => {
    if (route.request().method() === "DELETE") {
      passportDeleted = true;
      await route.fulfill({ status: 204 });
      return;
    }
    passportUploaded = route.request().postDataBuffer()?.includes(Buffer.from("%PDF-")) || false;
    await json(route, {
      id: "be09abb7-6552-45a9-9fc8-d77bb395ab3d",
      type: "passport",
      filename: "passport.pdf",
      url: `/api/v1/pets/${petId}/documents/be09abb7-6552-45a9-9fc8-d77bb395ab3d/content`,
      uploadedAt: new Date().toISOString(),
    }, 201);
  });

  await page.goto(`${tenantOrigin}/client`);
  await page.getByRole("button", { name: /Питомцы/ }).click();
  await page.getByRole("button", { name: "Добавить" }).click();
  await page.getByLabel("Имя питомца").fill("Тоня");
  await page.getByLabel("Порода").fill("Шпиц");
  await page.getByText("Особенности здоровья и противопоказания")
    .locator("..")
    .locator("textarea")
    .fill("Чувствительная кожа, не использовать ароматизированные средства");
  await page.getByText("Дополнительная информация для грумера")
    .locator("..")
    .locator("textarea")
    .fill("Боится громкого фена");
  await page.getByLabel("Фото питомца").setInputFiles({
    name: "tonya.png",
    mimeType: "image/png",
    buffer: Buffer.from("test-photo"),
  });
  await page.getByLabel("Ветеринарный паспорт").setInputFiles({
    name: "passport.pdf",
    mimeType: "application/pdf",
    buffer: Buffer.from("%PDF-1.7 test %%EOF"),
  });
  await page.getByRole("button", { name: "Сохранить питомца →" }).click();

  await expect(page.getByRole("status")).toContainText("Питомец добавлен");
  expect(petPayload).toMatchObject({
    name: "Тоня",
    species: "dog",
    breed: "Шпиц",
    medicalNotes: "Чувствительная кожа, не использовать ароматизированные средства",
    additionalInfo: "Боится громкого фена",
  });
  expect(photoUploaded).toBe(true);
  expect(passportUploaded).toBe(true);
  page.once("dialog", (dialog) => dialog.accept());
  await page.locator(".client-portal__tabs button").nth(2).click();
  await page.locator(".client-pet-card__delete-document").click();
  await expect.poll(() => passportDeleted).toBe(true);
  await expect(page.locator(".client-pet-card__delete-document")).toHaveCount(0);
  await expectNoHorizontalOverflow(page);
});
