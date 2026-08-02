import { expect, test } from "@playwright/test";

const platformBaseUrl = process.env.E2E_BASE_URL;
const tenantBaseUrl = process.env.E2E_TENANT_BASE_URL;
const email = process.env.LIVE_PLATFORM_EMAIL;
const password = process.env.LIVE_PLATFORM_PASSWORD;
const liveTargetEnabled =
  process.env.LIVE_E2E === "1" &&
  Boolean(platformBaseUrl && tenantBaseUrl && email && password);

function url(baseUrl: string, path: string) {
  return new URL(path, baseUrl).toString();
}

async function signIn(page: import("@playwright/test").Page, baseUrl: string, destination: RegExp) {
  await page.goto(url(baseUrl, "/login"), { waitUntil: "domcontentloaded" });
  await expect(page.locator("#login-email")).toBeVisible();
  await page.locator("#login-email").fill(email!);
  await page.locator("#login-password").fill(password!);
  await page.locator("button[type=submit]").click();
  await expect(page).toHaveURL(destination);
}

async function expectNoHorizontalOverflow(page: import("@playwright/test").Page) {
  const geometry = await page.evaluate(() => ({
    viewport: window.innerWidth,
    document: document.documentElement.scrollWidth,
  }));
  expect(geometry.document).toBeLessThanOrEqual(geometry.viewport + 1);
}

test.describe("live authenticated production checks", () => {
  test.skip(
    !liveTargetEnabled,
    "Set LIVE_E2E=1, E2E_BASE_URL, E2E_TENANT_BASE_URL and LIVE_PLATFORM_* credentials.",
  );

  test("owner can open every CRM workspace; plans are read-only until acquiring is connected", async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== "desktop-chrome", "Avoid duplicate authenticated production sessions.");

    const pageErrors: Error[] = [];
    const missingPublicMedia: string[] = [];
    page.on("pageerror", (error) => pageErrors.push(error));
    page.on("response", (response) => {
      if (response.status() === 404 && response.url().includes("/api/v1/public/media/")) {
        missingPublicMedia.push(response.url());
      }
    });
    await signIn(page, platformBaseUrl!, /\/app(?:\/|$)/);
    await expect(page.locator("#crm-content")).toBeVisible();
    await expectNoHorizontalOverflow(page);

    // A browser reload drops the in-memory access token, so this checks refresh-cookie recovery
    // once without unnecessarily rotating the production refresh token on every workspace check.
    await page.reload({ waitUntil: "domcontentloaded" });
    await expect(page.locator("#crm-content")).toBeVisible();

    const workspacePaths = [
      "/app/calendar",
      "/app/appointments",
      "/app/clients",
      "/app/services",
      "/app/staff",
      "/app/site",
      "/app/analytics",
      "/app/settings",
      "/app/instructions",
    ];
    for (const path of workspacePaths) {
      await page.locator(`.crm-sidebar a[href="${path}"]`).click();
      await expect(page).toHaveURL(new RegExp(`${path}(?:$|[?#])`));
      await expect(page.locator("#crm-content")).toBeVisible();
      if (path === "/app/site") await page.waitForTimeout(1_000);
    }

    const planTrigger = page.getByRole("button", { name: /выбрать тариф/i });
    if (await planTrigger.count()) {
      await planTrigger.click();
      const dialog = page.getByRole("dialog");
      await expect(dialog).toBeVisible();
      await expect(dialog).toContainText(/после подключения эквайринга/i);
      await expect(dialog.locator("article")).toHaveCount(3);
      await expect(dialog.getByRole("button", { name: /оплат|купить|подключ/i })).toHaveCount(0);
    }

    expect(pageErrors, pageErrors.map((error) => error.message).join("\n")).toEqual([]);
    expect(missingPublicMedia, "The site workspace requested deleted public-media assets").toEqual([]);
  });

  test("published tenant site and client account work with the supplied account", async ({ browser }, testInfo) => {
    test.skip(testInfo.project.name !== "desktop-chrome", "Avoid duplicate authenticated production sessions.");

    const context = await browser.newContext();
    const page = await context.newPage();
    const home = await page.goto(tenantBaseUrl!, { waitUntil: "domcontentloaded" });
    expect(home?.status()).toBe(200);
    await expect(page.locator("main")).toBeVisible();
    await expectNoHorizontalOverflow(page);

    await signIn(page, tenantBaseUrl!, /\/client(?:\/|$)/);
    await expect(page.locator("main")).toBeVisible();
    await expectNoHorizontalOverflow(page);

    // A tenant client relies on the same refresh-cookie recovery after a browser reload.
    await page.reload({ waitUntil: "domcontentloaded" });
    await expect(page).toHaveURL(/\/client(?:\/|$)/);
    await expect(page.locator("main")).toBeVisible();

    let slotRequests = 0;
    page.on("request", (request) => {
      if (request.method() === "GET" && request.url().includes("/api/v1/booking/slots?")) slotRequests += 1;
    });
    await page.getByRole("button", { name: /новая запись/i }).click();
    const booking = page.locator(".client-booking");
    await expect(booking).toBeVisible();

    await expect.poll(() => slotRequests).toBeGreaterThan(0);
    await expect(page.getByLabel("Услуга")).toBeVisible();
    await expect(page.getByLabel("Мастер")).toBeVisible();
    await expect(page.getByRole("button", { name: "Дата записи" })).toBeVisible();
    await expect(booking.locator(".client-booking__slots")).toBeVisible();
    await context.close();
  });
});
