import { expect, test } from "@playwright/test";

test.skip(process.env.LOCAL_TRYON_ENABLED === "true", "enabled flow is covered by local-tryon.e2e.ts");

test("local try-on stays unavailable when the release flag is off", async ({ page }) => {
  const response = await page.goto("/try-on");
  expect(response?.status()).toBe(404);
  await expect(page.getByText("This page could not be found")).toBeVisible();
});
