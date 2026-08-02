import { expect, test } from "@playwright/test";

test("landing captures question, callback request and chat contact without layout overflow", async ({ page }) => {
  await page.route("**/api/v1/public/leads", (route) => route.fulfill({
    status: 201,
    contentType: "application/json",
    body: JSON.stringify({ message: "Заявка принята — скоро свяжемся с вами." }),
  }));
  await page.route("**/api/v1/public/chat-leads", (route) => route.fulfill({
    status: 201,
    contentType: "application/json",
    body: JSON.stringify({ message: "Контакты сохранены. Мы скоро свяжемся с вами." }),
  }));

  await page.goto("/");
  const contact = page.locator("#contact");
  await contact.scrollIntoViewIfNeeded();
  await expect(contact).toHaveAttribute("data-hydrated", "true");
  await expect(contact.locator(".landing-contact__form")).toBeVisible();
  await expect(contact.getByRole("link", { name: /согласие на обработку персональных данных/i })).toHaveAttribute("href", "/consent");
  await contact.getByLabel("Имя").fill("Арина");
  await contact.getByLabel("Телефон").fill("9896521542");
  await expect(contact.getByLabel("Телефон")).toHaveValue("+7 (989) 652 15 42");
  await contact.getByLabel("Ваш вопрос").fill("Как перенести клиентов?");
  await contact.getByRole("checkbox").check();
  await contact.getByRole("button", { name: "Отправить вопрос" }).click();
  await expect(page.getByText(/заявка принята/i)).toBeVisible();

  await contact.locator(".landing-contact__tabs button").nth(1).click();
  await contact.getByLabel("Когда удобно позвонить?").fill("14:30");
  await contact.getByRole("button", { name: "Заказать звонок" }).click();

  await page.getByRole("button", { name: "Спросить" }).click();
  await expect(page.getByText("TrimmyCRM на связи")).toBeVisible();
  const chat = page.locator(".landing-chat__panel");
  await expect(chat.getByRole("link", { name: /согласие на обработку персональных данных/i })).toHaveAttribute("href", "/consent");
  await expect(chat.locator(".landing-chat__messages").evaluate((element) => element.scrollWidth <= element.clientWidth)).resolves.toBe(true);
  await expect(chat.locator(".landing-chat__quick").evaluate((element) => element.scrollWidth <= element.clientWidth)).resolves.toBe(true);
  await expect(page.locator(".landing-chat__trigger > *").evaluateAll((elements) => elements.map((element) => element.tagName))).resolves.toEqual(["SPAN", "I"]);
  for (let index = 0; index < 4; index += 1) await chat.locator(".landing-chat__quick button").nth(index % 3).click();
  await expect(chat.locator(".landing-chat__messages").evaluate((element) => ({
    overflowY: getComputedStyle(element).overflowY,
    hasOverflow: element.scrollHeight > element.clientHeight,
    atLatest: Math.abs(element.scrollHeight - element.clientHeight - element.scrollTop) < 3,
  }))).resolves.toEqual({ overflowY: "auto", hasOverflow: true, atLatest: true });
  await page.getByPlaceholder("Ваше имя").fill("Арина");
  await page.getByPlaceholder("+7 (989) 652 15 42").last().fill("9896521542");
  await page.getByRole("checkbox").last().check();
  await page.getByRole("button", { name: "Оставить контакты" }).click();
  await expect(page.getByText(/контакты сохранены/i)).toBeVisible();
  expect(await page.locator("body").evaluate((body) => body.scrollWidth <= window.innerWidth)).toBeTruthy();
});
