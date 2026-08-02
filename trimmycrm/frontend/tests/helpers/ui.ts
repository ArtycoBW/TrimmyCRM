import type { Page } from "@playwright/test";

/** Select an item from the shared shadcn/Radix select by its associated label. */
export async function selectOption(page: Page, label: string | RegExp, option: string | RegExp) {
  await page.getByLabel(label).click();
  await page.getByRole("option", { name: option }).click();
}
