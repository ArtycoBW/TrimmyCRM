import { expect, test } from "@playwright/test";

test.beforeEach(async ({ page }) => {
  await page.route("**/api/v1/auth/me", (route) => route.fulfill({
    status: 401,
    contentType: "application/json",
    body: JSON.stringify({ message: "Требуется авторизация", code: "unauthorized" }),
  }));
  await page.route("**/api/v1/frontend-auth/platform/refresh", (route) => route.fulfill({
    status: 401,
    contentType: "application/json",
    body: JSON.stringify({ message: "Сессия отсутствует", code: "unauthorized" }),
  }));
});

test("first visit intro plays once per browser session", async ({ page }) => {
  await page.goto("/");

  const intro = page.getByTestId("first-visit-preloader");
  await expect(intro).toBeVisible();
  await expect(intro).toBeHidden({ timeout: 5_000 });

  await page.reload();
  await expect(page.getByTestId("first-visit-preloader")).toHaveCount(0);
});

test("landing renders its core sections", async ({ page }, testInfo) => {
  const requestedAssets: string[] = [];
  page.on("request", (request) => requestedAssets.push(request.url()));
  await page.goto("/");

  await expect(page.getByRole("heading", { level: 1 })).toContainText("Записи и клиенты");
  const header = page.getByRole("banner");
  await expect(header.evaluate((element) => getComputedStyle(element).position)).resolves.toBe("fixed");
  await expect(header.locator("img").first()).toHaveAttribute("src", /trimmy-symbol\.svg/);
  await expect(page.locator(".editorial-landing")).toHaveAttribute("data-motion-ready", "true");
  const revealDuration = await page.locator("[data-reveal]").first().evaluate((element) =>
    Number.parseFloat(getComputedStyle(element).transitionDuration.split(",")[0]),
  );
  expect(revealDuration).toBeGreaterThanOrEqual(1);
  const interactiveHead = page.getByRole("application", { name: /Интерактивный 3D-портрет/i });
  await expect(interactiveHead.locator("canvas")).toBeVisible();
  const initialFrame = await interactiveHead.getAttribute("data-rotation");
  await interactiveHead.focus();
  await interactiveHead.press("ArrowRight");
  await expect.poll(() => interactiveHead.getAttribute("data-rotation")).not.toBe(initialFrame);
  expect(requestedAssets.some((url) => url.includes("three-point-cloud-portrait.webp"))).toBe(true);
  expect(requestedAssets.some((url) => url.includes("marble-bust"))).toBe(false);
  await expect(page.locator("#product")).toBeAttached();
  await expect(page.locator("#examples")).toBeAttached();
  await expect(page.locator("#plans")).toBeAttached();
  await expect(page.locator("#faq")).toBeAttached();
  const faq = page.locator("#faq");
  await faq.scrollIntoViewIfNeeded();
  const faqButtons = faq.getByRole("button");
  await expect(faqButtons.first()).toHaveAttribute("aria-expanded", "true");
  await faqButtons.nth(1).click();
  await expect(faqButtons.first()).toHaveAttribute("aria-expanded", "false");
  await expect(faqButtons.nth(1)).toHaveAttribute("aria-expanded", "true");
  await expect(faq.locator("[class*='faqAnswer']").nth(1).evaluate((answer) => getComputedStyle(answer).transitionProperty)).resolves.toContain("grid-template-rows");
  await expect(page.getByRole("heading", { name: /Для салона, барбершопа/i })).toBeVisible();
  await page.locator("#examples").scrollIntoViewIfNeeded();
  const gallery = page.getByLabel("Фотогалерея мужских и женских работ");
  const galleryRows = gallery.locator("div[class*='marqueeRow']");
  await expect(galleryRows).toHaveCount(2);
  await expect(gallery.evaluate((element) => getComputedStyle(element).borderTopWidth)).resolves.toBe("1px");
  await expect(galleryRows.evaluateAll((rows) => rows.every((row) => getComputedStyle(row).borderRadius === "0px"))).resolves.toBe(true);
  const womanPortrait = page.getByAltText("Женщина с медным графичным бобом").first();
  const manPortrait = page.getByAltText("Мужчина с текстурной короткой стрижкой").first();
  await expect(womanPortrait).toHaveAttribute("src", /woman-copper-bob\.webp/);
  await expect(manPortrait).toHaveAttribute("src", /man-textured-crop\.webp/);
  const [womanAsset, manAsset] = await Promise.all([
    page.request.get("/images/editorial/woman-copper-bob.webp"),
    page.request.get("/images/editorial/man-textured-crop.webp"),
  ]);
  expect(womanAsset.ok()).toBe(true);
  expect(manAsset.ok()).toBe(true);
  expect(womanAsset.headers()["content-type"]).toContain("image/webp");
  expect(manAsset.headers()["content-type"]).toContain("image/webp");

  if (testInfo.project.name === "desktop-chrome") {
    await expect(page.getByRole("navigation", { name: "Основная навигация" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Меню" })).toBeVisible();
    await expect(page.getByRole("dialog")).toBeHidden();
  }
});

test("mobile hero fits the viewport and navigation opens", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "mobile-chrome", "Mobile-only layout assertion");
  await page.goto("/");

  await expect(page.locator("body").evaluate((body) => body.scrollWidth <= window.innerWidth)).resolves.toBe(true);
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  await expect(page.getByRole("link", { name: /Попробовать бесплатно/i })).toBeVisible();

  const menuButton = page.getByRole("button", { name: "Меню" });
  await expect(menuButton).toBeVisible();
  await menuButton.click();
  const navigation = page.getByRole("navigation", { name: "Навигация по лендингу" });
  await expect(navigation).toBeVisible();
  await expect(navigation.getByRole("link", { name: "Тарифы" })).toBeVisible();
});

test("pricing anchor and cards are reachable", async ({ page }) => {
  await page.goto("/");
  await page.locator("#plans").scrollIntoViewIfNeeded();
  await expect(page.getByRole("heading", { name: /Тариф зависит от размера команды/i })).toBeVisible();
  await expect(page.locator(".plan-card")).toHaveCount(3);
  await expect(page.locator(".plan-card--featured")).toContainText("Бизнес");
});

test("site builder reorders visual sections and the try-on uses real photography", async ({ page }, testInfo) => {
  await page.goto("/");

  const builder = page.locator("section").filter({ has: page.getByRole("heading", { name: "Соберите сайт из готовых блоков." }) });
  await builder.scrollIntoViewIfNeeded();
  const builderIntro = builder.locator("div").filter({ has: page.getByRole("heading", { name: "Соберите сайт из готовых блоков." }) }).first();
  await expect(builderIntro.evaluate((element) => getComputedStyle(element).position)).resolves.toBe(testInfo.project.name === "desktop-chrome" ? "sticky" : "static");
  if (testInfo.project.name === "desktop-chrome") {
    await expect(builderIntro.evaluate((element) => Number.parseFloat(getComputedStyle(element).top))).resolves.toBeGreaterThan(80);
  }
  const handles = builder.getByRole("button", { name: /Переместить секцию/i });
  await expect(handles).toHaveCount(6);
  await expect(builder.locator("button[class*='handle']")).toHaveCount(0);
  if (testInfo.project.name === "desktop-chrome") {
    await handles.first().focus();
    await page.keyboard.press("Shift+ArrowDown");
    await expect(handles.nth(1)).toHaveAccessibleName("Переместить секцию Обложка");
    await expect(builder.locator("[aria-live='polite']")).toContainText("позиция 2 из 6");
  }

  const tryOn = page.locator("section").filter({ has: page.getByRole("heading", { name: "Примерьте причёску до записи." }) });
  await tryOn.scrollIntoViewIfNeeded();
  const portrait = tryOn.getByRole("img", { name: /тёмным архитектурным бобом/i });
  await expect(portrait).toHaveAttribute("src", /tryon-dark-bob-portrait\.webp/);
  await expect.poll(() => portrait.evaluate((image: HTMLImageElement) => image.complete && image.naturalWidth > 0)).toBe(true);
  await expect(page.getByText("Фото обрабатывается локально в браузере.")).toHaveCount(0);
  await expect(page.getByText(/Shift и стрелки/)).toHaveCount(0);
});

test("reduced motion stays static and the editorial footer is complete", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/");

  await expect.poll(() => page.locator("[data-reveal]").evaluateAll((elements) =>
    elements.every((element) => element.getAttribute("data-reveal-state") === "visible"),
  )).toBe(true);
  const interactiveHead = page.getByRole("application", { name: /Интерактивный 3D-портрет/i });
  await expect(interactiveHead).toBeVisible();
  const photoRows = page.getByLabel("Фотогалерея мужских и женских работ").locator("div[class*='track']");
  await expect(photoRows).toHaveCount(2);
  await expect.poll(() => photoRows.evaluateAll((rows) => rows.every((row) => getComputedStyle(row).animationName === "none"))).toBe(true);

  const footer = page.locator("footer");
  await footer.scrollIntoViewIfNeeded();
  await expect(footer.getByRole("heading", { name: /Попробуйте TrimmyCRM в работе/i })).toBeVisible();
  await expect(footer.getByRole("navigation", { name: "Документы и поддержка" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Вернуться в начало страницы" })).toBeVisible();
  await expect(footer.getByText("Наверх", { exact: true })).toHaveCount(0);
});
