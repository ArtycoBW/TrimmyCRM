import { expect, test } from "@playwright/test";

const liveTargetEnabled = process.env.LIVE_E2E === "1" && Boolean(process.env.E2E_BASE_URL);

test.describe("live production smoke", () => {
  test.skip(
    !liveTargetEnabled,
    "Set LIVE_E2E=1 and E2E_BASE_URL to run against an external environment.",
  );

  test("platform page, public API and safety headers are available without mutations", async ({ page }) => {
    const home = await page.goto("/", { waitUntil: "domcontentloaded" });
    expect(home?.status()).toBe(200);
    await expect(page.locator("main")).toBeVisible();
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();

    const geometry = await page.evaluate(() => ({
      viewport: innerWidth,
      document: document.documentElement.scrollWidth,
    }));
    expect(geometry.document).toBeLessThanOrEqual(geometry.viewport + 1);

    const headers = home?.headers() ?? {};
    expect(headers["strict-transport-security"]).toContain("max-age=");
    expect(headers["x-content-type-options"]).toBe("nosniff");
    expect(headers["x-frame-options"]).toBe("DENY");
    expect(headers["referrer-policy"]).toBe("strict-origin-when-cross-origin");

    const [health, plans, anonymousMe, robots, sitemap, manifest] = await Promise.all([
      page.request.get("/healthz"),
      page.request.get("/api/v1/plans"),
      page.request.get("/api/v1/auth/me"),
      page.request.get("/robots.txt"),
      page.request.get("/sitemap.xml"),
      page.request.get("/manifest.webmanifest"),
    ]);

    expect(health.status()).toBe(200);
    expect((await health.text()).trim()).toBe("ok");
    expect(plans.ok()).toBe(true);
    expect(await plans.json()).toBeInstanceOf(Array);
    expect(anonymousMe.status()).toBe(401);
    for (const response of [robots, sitemap, manifest]) expect(response.ok()).toBe(true);
  });
});
