import { expect, request as playwrightRequest, test, type APIRequestContext, type APIResponse } from "@playwright/test";

const platformBaseUrl = process.env.E2E_BASE_URL;
const tenantBaseUrl = process.env.E2E_TENANT_BASE_URL;
const email = process.env.LIVE_PLATFORM_EMAIL;
const password = process.env.LIVE_PLATFORM_PASSWORD;
const liveTargetEnabled =
  process.env.LIVE_E2E === "1" &&
  Boolean(platformBaseUrl && tenantBaseUrl && email && password);

const tinyPng = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScL9YQAAAABJRU5ErkJggg==",
  "base64",
);

type Json = Record<string, unknown>;

function apiUrl(baseUrl: string, path: string) {
  return new URL("/api/v1" + path, baseUrl).toString();
}

function dateIn(days: number) {
  const value = new Date();
  value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString().slice(0, 10);
}

async function expectStatus(response: APIResponse, ...expected: number[]) {
  const actual = response.status();
  if (!expected.includes(actual)) {
    const body = (await response.text()).slice(0, 1_000);
    throw new Error(`Expected HTTP ${expected.join(" or ")}, received ${actual}: ${body}`);
  }
}

async function login(baseUrl: string, path: string) {
  const anonymous = await playwrightRequest.newContext();
  try {
    const response = await anonymous.post(apiUrl(baseUrl, path), {
      data: { email, password },
    });
    await expectStatus(response, 200);
    const payload = await response.json() as { accessToken: string };
    expect(payload.accessToken).toBeTruthy();
    return payload.accessToken;
  } finally {
    await anonymous.dispose();
  }
}

async function authenticated(baseUrl: string, token: string) {
  return playwrightRequest.newContext({
    baseURL: baseUrl,
    extraHTTPHeaders: { Authorization: `Bearer ${token}` },
  });
}

async function expectOkOrFeatureGate(response: APIResponse) {
  await expectStatus(response, 200, 403);
  if (response.status() === 403) {
    const payload = await response.json() as Json;
    expect(typeof payload.code).toBe("string");
  }
}

async function freeSlots(
  anonymous: APIRequestContext,
  serviceId: string,
  staffId: string,
) {
  const found: { startAt: string; endAt: string }[] = [];
  for (let offset = 7; offset <= 60 && found.length < 2; offset += 1) {
    const response = await anonymous.get(
      apiUrl(tenantBaseUrl!, `/booking/slots?serviceId=${serviceId}&staffId=${staffId}&date=${dateIn(offset)}`),
    );
    await expectStatus(response, 200);
    const payload = await response.json() as { slots: { startAt: string; endAt: string; available: boolean }[] };
    for (const slot of payload.slots) {
      if (slot.available && !found.some((value) => value.startAt === slot.startAt)) {
        found.push(slot);
      }
      if (found.length === 2) break;
    }
  }
  expect(found, "At least two available public booking slots are required for the lifecycle test.").toHaveLength(2);
  return found;
}

test.describe("live endpoint lifecycle", () => {
  test.skip(
    !liveTargetEnabled,
    "Set LIVE_E2E=1, E2E_BASE_URL, E2E_TENANT_BASE_URL and LIVE_PLATFORM_* credentials.",
  );
  test.describe.configure({ mode: "serial" });

  test("owner and client API lifecycle works with test data that is cleaned up", async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== "desktop-chrome", "Avoid duplicate live mutations on the mobile project.");

    const runId = `e2e-${Date.now()}`;
    const platformToken = await login(platformBaseUrl!, "/auth/login");
    const tenantToken = await login(tenantBaseUrl!, "/t/auth/login");
    const platform = await authenticated(platformBaseUrl!, platformToken);
    const tenant = await authenticated(tenantBaseUrl!, tenantToken);
    const anonymous = await playwrightRequest.newContext();
    let createdMediaId: string | undefined;
    let createdAppointmentId: string | undefined;
    let originalDescription: string | null | undefined;

    try {
      const platformMe = await platform.get("/api/v1/auth/me");
      await expectStatus(platformMe, 200);
      const tenantMe = await tenant.get("/api/v1/t/auth/me");
      await expectStatus(tenantMe, 200);

      const siteResponse = await platform.get("/api/v1/sites/mine");
      await expectStatus(siteResponse, 200);
      const site = await siteResponse.json() as Json;
      originalDescription = site.description as string | null | undefined;

      const siteReads = await Promise.all([
        platform.get("/api/v1/sites/slug-available?slug=live-e2e-check-" + Date.now()),
        platform.get("/api/v1/sites/mine/blocks"),
        platform.get("/api/v1/sites/mine/block-catalog"),
        platform.get("/api/v1/services?include_inactive=true"),
        platform.get("/api/v1/staff?include_inactive=true"),
        platform.get("/api/v1/clients?page=1&limit=20"),
        platform.get(`/api/v1/admin/appointments?from=${encodeURIComponent(new Date().toISOString())}&to=${encodeURIComponent(new Date(Date.now() + 30 * 86_400_000).toISOString())}`),
        platform.get(`/api/v1/analytics/overview?from=${encodeURIComponent(new Date(Date.now() - 30 * 86_400_000).toISOString())}&to=${encodeURIComponent(new Date().toISOString())}`),
        platform.get(`/api/v1/analytics/services?from=${encodeURIComponent(new Date(Date.now() - 30 * 86_400_000).toISOString())}&to=${encodeURIComponent(new Date().toISOString())}`),
        platform.get("/api/v1/analytics/export/dashboard.csv?from=" + encodeURIComponent(new Date(Date.now() - 30 * 86_400_000).toISOString()) + "&to=" + encodeURIComponent(new Date().toISOString())),
        platform.get("/api/v1/analytics/export/dashboard.xlsx?from=" + encodeURIComponent(new Date(Date.now() - 30 * 86_400_000).toISOString()) + "&to=" + encodeURIComponent(new Date().toISOString())),
        platform.get("/api/v1/export/clients.csv"),
        platform.get("/api/v1/export/appointments.csv"),
        platform.get("/api/v1/export/clients.xlsx"),
        platform.get("/api/v1/export/appointments.xlsx"),
        platform.get("/api/v1/billing/subscription"),
        platform.get("/api/v1/billing/invoices"),
      ]);
      for (const response of siteReads) await expectStatus(response, 200);

      const conditionalReads = await Promise.all([
        platform.get("/api/v1/promotions"),
        platform.get("/api/v1/admin/reviews"),
        tenant.get("/api/v1/loyalty/mine"),
        anonymous.get(apiUrl(tenantBaseUrl!, "/public/promotions")),
        anonymous.get(apiUrl(tenantBaseUrl!, "/public/reviews")),
      ]);
      for (const response of conditionalReads) await expectOkOrFeatureGate(response);

      const publicReads = await Promise.all([
        anonymous.get(apiUrl(tenantBaseUrl!, "/public/site")),
        anonymous.get(apiUrl(tenantBaseUrl!, "/public/services")),
        anonymous.get(apiUrl(tenantBaseUrl!, "/public/staff")),
        tenant.get("/api/v1/appointments/mine?page=1&limit=20"),
        tenant.get("/api/v1/notification-preferences"),
      ]);
      for (const response of publicReads) await expectStatus(response, 200);

      const preview = await platform.post("/api/v1/sites/mine/preview");
      await expectStatus(preview, 200);
      const previewPayload = await preview.json() as { previewToken: string };
      const previewSnapshot = await anonymous.get(apiUrl(tenantBaseUrl!, `/public/site?previewToken=${previewPayload.previewToken}`));
      await expectStatus(previewSnapshot, 200);

      const updatedSite = await platform.patch("/api/v1/sites/mine", {
        data: { description: `${originalDescription || ""}\n${runId}`.trim() },
      });
      await expectStatus(updatedSite, 200);

      const uploadedMedia = await platform.post("/api/v1/media", {
        multipart: {
          file: { name: `${runId}.png`, mimeType: "image/png", buffer: tinyPng },
          purpose: "gallery",
        },
      });
      await expectStatus(uploadedMedia, 201);
      const media = await uploadedMedia.json() as { id: string; url: string };
      createdMediaId = media.id;
      await expectStatus(await platform.get(`/api/v1/media/${media.id}`), 200);
      await expectStatus(await anonymous.get(apiUrl(tenantBaseUrl!, `/public/media/${media.id}`)), 200);

      // Drive the actual browser form once; the rest of the test uses the same public API
      // to assert server contracts and ensure the generated record can be cleaned up.
      await page.goto(new URL("/login", platformBaseUrl!).toString(), { waitUntil: "domcontentloaded" });
      await page.locator("#login-email").fill(email!);
      await page.locator("#login-password").fill(password!);
      await page.locator("button[type=submit]").click();
      await expect(page).toHaveURL(/\/app(?:\/|$)/);
      await page.goto(new URL("/app/clients", platformBaseUrl!).toString(), { waitUntil: "domcontentloaded" });
      await page.getByRole("button", { name: /Добавить клиента/i }).click();
      await page.locator("#client-name").fill(`Проверка ${runId}`);
      await page.locator(".client-form input[type=checkbox]").check();
      await page.locator(".client-form form").getByRole("button", { name: /Добавить клиента/i }).click();
      await expect(page.locator(".crm-toast")).toBeVisible();

      const clients = await platform.get(`/api/v1/clients?page=1&limit=20&search=${encodeURIComponent(runId)}`);
      await expectStatus(clients, 200);
      const clientItems = await clients.json() as { items: { id: string; fullName: string }[] };
      const client = clientItems.items.find((item) => item.fullName.includes(runId));
      expect(client, "The client created through the browser form was not returned by CRM search.").toBeTruthy();
      const clientId = client!.id;
      await expectStatus(await platform.get(`/api/v1/clients/${clientId}`), 200);
      const clientUpdated = await platform.patch(`/api/v1/clients/${clientId}`, {
        data: { fullName: `Проверка обновлена ${runId}` },
      });
      await expectStatus(clientUpdated, 200);

      const servicesResponse = await anonymous.get(apiUrl(tenantBaseUrl!, "/public/services"));
      const staffResponse = await anonymous.get(apiUrl(tenantBaseUrl!, "/public/staff"));
      await expectStatus(servicesResponse, 200);
      await expectStatus(staffResponse, 200);
      const services = await servicesResponse.json() as { id: string }[];
      const staff = await staffResponse.json() as { id: string; serviceIds: string[] }[];
      const pair = staff.flatMap((member) => services
        .filter((service) => member.serviceIds.includes(service.id))
        .map((service) => ({ serviceId: service.id, staffId: member.id })))[0];
      expect(pair, "A public service with an assigned staff member is required for booking.").toBeTruthy();
      const [initialSlot, rescheduleSlot] = await freeSlots(anonymous, pair!.serviceId, pair!.staffId);

      const bookingPayload = {
        serviceId: pair!.serviceId,
        staffId: pair!.staffId,
        startAt: initialSlot.startAt,
      };
      const idempotencyKey = `trimmy-${runId}-booking`;
      const booking = await tenant.post("/api/v1/booking", {
        data: bookingPayload,
        headers: { "Idempotency-Key": idempotencyKey },
      });
      await expectStatus(booking, 201);
      const bookingResult = await booking.json() as { id: string; version: number };
      createdAppointmentId = bookingResult.id;
      const repeatedBooking = await tenant.post("/api/v1/booking", {
        data: bookingPayload,
        headers: { "Idempotency-Key": idempotencyKey },
      });
      await expectStatus(repeatedBooking, 201);
      expect((await repeatedBooking.json() as { id: string }).id).toBe(createdAppointmentId);
      await expectStatus(await tenant.get("/api/v1/appointments/mine?page=1&limit=100"), 200);
      await expectStatus(await platform.get(`/api/v1/admin/appointments?from=${encodeURIComponent(new Date(Date.now() - 86_400_000).toISOString())}&to=${encodeURIComponent(new Date(Date.now() + 90 * 86_400_000).toISOString())}&tenantUserId=${encodeURIComponent((await tenantMe.json() as { id: string }).id)}`), 200);

      const rescheduled = await tenant.post(`/api/v1/appointments/${createdAppointmentId}/reschedule`, {
        data: { startAt: rescheduleSlot.startAt, staffId: pair!.staffId, expectedVersion: bookingResult.version },
      });
      await expectStatus(rescheduled, 200);
      const rescheduledResult = await rescheduled.json() as { version: number };
      const editedByOwner = await platform.patch(`/api/v1/admin/appointments/${createdAppointmentId}`, {
        data: { notes: `Проверка ${runId}`, expectedVersion: rescheduledResult.version },
      });
      await expectStatus(editedByOwner, 200);
      await expectStatus(await tenant.post(`/api/v1/appointments/${createdAppointmentId}/cancel`, {
        data: { reason: "Автотест: очистка тестовой записи" },
      }), 200);

      const preferences = await tenant.get("/api/v1/notification-preferences");
      await expectStatus(preferences, 200);
      const preferencePayload = await preferences.json() as Json;
      const samePreferences = await tenant.patch("/api/v1/notification-preferences", {
        data: preferencePayload,
      });
      await expectStatus(samePreferences, 200);

      const invalidPlatformPasswordChange = await platform.post("/api/v1/auth/change-password", {
        data: { oldPassword: "not-the-current-password", newPassword: "Another-valid-password-123!" },
      });
      await expectStatus(invalidPlatformPasswordChange, 401);
      const invalidTenantPasswordChange = await tenant.post("/api/v1/t/auth/change-password", {
        data: { oldPassword: "not-the-current-password", newPassword: "Another-valid-password-123!" },
      });
      await expectStatus(invalidTenantPasswordChange, 401);

      await expectStatus(await platform.delete(`/api/v1/media/${createdMediaId}`), 204);
      createdMediaId = undefined;
      await expectStatus(await anonymous.get(apiUrl(tenantBaseUrl!, `/public/media/${media.id}`)), 404);
      await expectStatus(await platform.patch(`/api/v1/clients/${clientId}`, { data: { status: "anonymized" } }), 200);
      await expectStatus(await platform.get(`/api/v1/clients/${clientId}`), 200);
    } finally {
      if (createdAppointmentId) {
        const cancelled = await tenant.post(`/api/v1/appointments/${createdAppointmentId}/cancel`, {
          data: { reason: "Автотест: гарантированная очистка" },
        });
        expect([200, 409]).toContain(cancelled.status());
      }
      if (createdMediaId) {
        const deleted = await platform.delete(`/api/v1/media/${createdMediaId}`);
        expect([204, 404]).toContain(deleted.status());
      }
      if (originalDescription !== undefined) {
        const restored = await platform.patch("/api/v1/sites/mine", {
          data: { description: originalDescription },
        });
        expect([200, 401]).toContain(restored.status());
      }
      await Promise.all([platform.dispose(), tenant.dispose(), anonymous.dispose()]);
    }
  });
});
