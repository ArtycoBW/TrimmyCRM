import { expect, test } from "@playwright/test";

const platformBaseUrl = process.env.E2E_BASE_URL;
const tenantBaseUrl = process.env.E2E_TENANT_BASE_URL;
const liveTargetEnabled = process.env.LIVE_E2E === "1" && Boolean(platformBaseUrl && tenantBaseUrl);

async function expectNoHorizontalOverflow(page: import("@playwright/test").Page) {
  const geometry = await page.evaluate(() => ({ viewport: window.innerWidth, document: document.documentElement.scrollWidth }));
  expect(geometry.document).toBeLessThanOrEqual(geometry.viewport + 1);
}

test.describe("live mobile and PWA release checks", () => {
  test.skip(!liveTargetEnabled, "Set LIVE_E2E=1, E2E_BASE_URL and E2E_TENANT_BASE_URL.");

  test("mobile platform is installable, has an offline fallback and does not overflow", async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== "mobile-chrome", "Mobile-only PWA and adaptive-layout check.");

    const home = await page.goto(platformBaseUrl!, { waitUntil: "domcontentloaded" });
    expect(home?.status()).toBe(200);
    await expect(page.locator("main")).toBeVisible();
    await expectNoHorizontalOverflow(page);

    const manifestResponse = await page.request.get(new URL("/manifest.webmanifest", platformBaseUrl!).toString());
    expect(manifestResponse.ok()).toBe(true);
    const manifest = await manifestResponse.json() as { display?: string; start_url?: string; icons?: unknown[] };
    expect(manifest.display).toBe("standalone");
    expect(manifest.start_url).toBe("/");
    expect(manifest.icons?.length).toBeGreaterThan(0);

    await expect.poll(() => page.evaluate(async () => {
      if (!("serviceWorker" in navigator)) return false;
      const registration = await navigator.serviceWorker.ready;
      return Boolean(registration.active?.scriptURL.endsWith("/sw.js"));
    })).toBe(true);
    await page.reload({ waitUntil: "domcontentloaded" });
    await expect.poll(() => page.evaluate(() => Boolean(navigator.serviceWorker.controller))).toBe(true);

    const cdp = await page.context().newCDPSession(page);
    await cdp.send("Page.enable");
    const installability = await cdp.send("Page.getInstallabilityErrors") as {
      installabilityErrors?: Array<{ errorId: string }>;
    };
    const actionableInstallabilityErrors = (installability.installabilityErrors ?? [])
      .filter((error) => error.errorId !== "in-incognito");
    expect(actionableInstallabilityErrors).toEqual([]);

    await page.context().setOffline(true);
    try {
      await page.goto(new URL("/pwa-offline-release-check", platformBaseUrl!).toString(), { waitUntil: "domcontentloaded" });
      await expect(page.locator("main.card")).toBeVisible();
    } finally {
      await page.context().setOffline(false);
    }
  });

  test("published tenant site renders all images and stays adaptive on mobile", async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== "mobile-chrome", "Mobile-only adaptive-layout check.");

    const response = await page.goto(tenantBaseUrl!, { waitUntil: "domcontentloaded" });
    expect(response?.status()).toBe(200);
    await expect(page.locator("main")).toBeVisible();
    const images = page.locator("img");
    for (let index = 0; index < await images.count(); index += 1) {
      const image = images.nth(index);
      await image.scrollIntoViewIfNeeded();
      await expect.poll(() => image.evaluate((element: HTMLImageElement) => element.complete && element.naturalWidth > 0)).toBe(true);
    }
    await expectNoHorizontalOverflow(page);
  });
});
