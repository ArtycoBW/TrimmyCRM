import { expect, test, type Route } from "@playwright/test";

test.skip(process.env.LOCAL_TRYON_ENABLED !== "true", "local try-on is disabled by default");

const testBaseUrl = new URL(process.env.E2E_BASE_URL || `http://localhost:${process.env.E2E_PORT || "3000"}`);
const tenantOrigin = `${testBaseUrl.protocol}//forma.trimmycrm.localhost${testBaseUrl.port ? `:${testBaseUrl.port}` : ""}`;
const syntheticPng = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
  "base64",
);

const site = {
  id: "19c2e868-6a3d-4ee3-9a9e-f5cc61a843f4",
  name: "Форма",
  slug: "forma",
  salonType: "unisex_hair_salon",
  customDomain: null,
  description: "Парикмахерская с локальной примеркой",
  city: "Москва",
  street: "Петровка, 12",
  phone: null,
  workHours: {},
  socials: {},
  logoUrl: null,
  theme: { vermillion: "#d15022", acidMint: "#75dfb5", pureBlack: "#000000", paperWhite: "#ffffff" },
  timezone: "Europe/Moscow",
  templateKey: "unisex-hair",
  blocks: [{ id: "hero", type: "hero", position: 0, config: { title: "Форма" }, enabled: true }],
  version: 1,
  publishedAt: "2026-08-02T12:00:00Z",
};

async function json(route: Route, body: unknown) {
  await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(body) });
}

test("tenant site opens an isolated local try-on without transferring the photo", async ({ page }) => {
  await page.route("**/api/v1/public/site**", (route) => json(route, site));
  await page.route("**/api/v1/public/services", (route) => json(route, []));
  await page.route("**/api/v1/public/staff", (route) => json(route, []));
  await page.route("**/api/v1/public/reviews", (route) => json(route, []));

  await page.goto(tenantOrigin);
  const tryOnLink = page.getByRole("link", { name: "Примерка" });
  await expect(tryOnLink).toHaveAttribute("href", "/try-on");

  const responsePromise = page.waitForResponse((response) => response.url() === `${tenantOrigin}/try-on` && response.request().isNavigationRequest());
  await tryOnLink.click();
  const response = await responsePromise;
  const csp = (await response.allHeaders())["content-security-policy"] || "";
  expect(csp).toContain("connect-src 'self'");
  expect(csp).toContain("frame-ancestors 'none'");
  expect((await response.allHeaders())["permissions-policy"]).toContain("camera=()");

  await expect(page.getByRole("heading", { name: "Примерьте форму до встречи." })).toBeVisible();
  await expect(page.getByRole("button", { name: "Графичный боб" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Текстурный кроп" })).toBeVisible();
  const overflowing = await page.evaluate(() => [...document.querySelectorAll<HTMLElement>("body *")]
    .filter((element) => {
      const rect = element.getBoundingClientRect();
      return rect.right > window.innerWidth + 1 || rect.left < -1;
    })
    .map((element) => ({ tag: element.tagName, className: element.className, rect: element.getBoundingClientRect().toJSON() })));
  expect(overflowing).toEqual([]);

  const requests: Array<{ url: string; method: string; postData: string | null }> = [];
  page.on("request", (request) => requests.push({ url: request.url(), method: request.method(), postData: request.postData() }));

  await page.locator('input[type="file"]').first().setInputFiles({
    name: "synthetic-local-portrait.png",
    mimeType: "image/png",
    buffer: syntheticPng,
  });
  await expect(page.locator(".tryon-canvas-wrap")).toHaveClass(/has-photo/);
  const canvas = page.locator(".tryon-canvas-wrap canvas");
  await canvas.focus();
  const originalSize = Number(await page.getByLabel("Размер причёски").inputValue());
  await canvas.press("ArrowRight");
  await canvas.press("+");
  await canvas.press("]");
  await canvas.press("m");
  await expect(page.getByLabel("Размер причёски")).not.toHaveValue(String(originalSize));
  await expect(page.getByRole("button", { name: "Отразить" })).toHaveAttribute("aria-pressed", "true");

  const downloadPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: "Скачать" }).click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toBe("trimmycrm-tryon-result.png");

  const bookingUrl = new URL(await page.getByRole("link", { name: "Обсудить с мастером" }).getAttribute("href") || "", tenantOrigin);
  expect([...bookingUrl.searchParams.keys()].sort()).toEqual(["booking", "hairstyleTemplateId"]);
  expect(bookingUrl.searchParams.get("hairstyleTemplateId")).toBe("women-blunt-bob-01");

  await page.getByRole("button", { name: "Удалить" }).click();
  await expect(page.locator(".tryon-canvas-wrap")).not.toHaveClass(/has-photo/);
  const browserStorage = await page.evaluate(async () => ({
    local: Object.keys(localStorage),
    session: Object.keys(sessionStorage),
    indexedDb: typeof indexedDB.databases === "function" ? (await indexedDB.databases()).map((database) => database.name) : [],
    cache: typeof caches === "undefined" ? [] : await Promise.all((await caches.keys()).map(async (name) => ({
      name,
      requests: (await (await caches.open(name)).keys()).map((request) => request.url),
    }))),
  }));
  expect(browserStorage.local).toEqual([]);
  expect(browserStorage.indexedDb).toEqual([]);
  expect(browserStorage.session.every((key) => key.startsWith("__next_debug_channel:"))).toBe(true);
  const serializedStorage = JSON.stringify(browserStorage);
  expect(serializedStorage).not.toContain("synthetic-local-portrait.png");
  expect(serializedStorage).not.toContain("blob:");
  expect(serializedStorage).not.toContain("data:image");
  expect(serializedStorage).not.toContain("trimmycrm-tryon-result.png");
  expect(serializedStorage).not.toContain("/hairstyles/");

  const serializedRequests = JSON.stringify(requests);
  expect(serializedRequests).not.toContain("synthetic-local-portrait.png");
  expect(serializedRequests).not.toContain(syntheticPng.toString("base64").slice(0, 24));
  expect(requests.every((request) => new URL(request.url).origin === tenantOrigin)).toBe(true);
  expect(requests.every((request) => request.method === "GET")).toBe(true);

  await page.reload();
  await expect(page.locator(".tryon-canvas-wrap")).not.toHaveClass(/has-photo/);
});

test("invalid and oversized files fail locally without a request", async ({ page }) => {
  await page.goto(`${tenantOrigin}/try-on`);
  await expect(page.getByRole("button", { name: "Графичный боб" })).toBeVisible();
  const requests: string[] = [];
  page.on("request", (request) => requests.push(request.url()));

  const input = page.locator('input[type="file"]').first();
  await input.setInputFiles({ name: "not-a-photo.txt", mimeType: "text/plain", buffer: Buffer.from("local only") });
  await expect(page.locator('.tryon-status[role="alert"]')).toContainText("JPG, PNG или WebP");
  expect(requests).toEqual([]);

  await input.setInputFiles({ name: "too-large.png", mimeType: "image/png", buffer: Buffer.alloc(12 * 1024 * 1024 + 1) });
  await expect(page.locator('.tryon-status[role="alert"]')).toContainText("12 МБ");
  expect(requests).toEqual([]);
});
