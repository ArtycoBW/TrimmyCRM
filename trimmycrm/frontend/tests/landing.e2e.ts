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

test("first visit intro covers the page until the salon scene is ready", async ({ page }) => {
  await page.goto("/", { waitUntil: "commit" });

  const intro = page.getByTestId("first-visit-preloader");
  await expect(intro).toBeVisible();
  await expect(intro).not.toContainText(/Salon operating system/i);
  await expect(intro).toContainText("Готовим ваш салон");
  await expect.poll(() => intro.locator("article[data-depth='0']").evaluate((card) => {
    const title = card.querySelector("strong");
    if (!title) return false;
    const cardRect = card.getBoundingClientRect();
    const titleRect = title.getBoundingClientRect();
    return titleRect.left >= cardRect.left && titleRect.right <= cardRect.right;
  })).toBe(true);
  await expect.poll(() => page.locator("html").getAttribute("data-trimmy-scene"), { timeout: 30_000 }).toMatch(/ready|error/);
  await expect(intro).toBeHidden({ timeout: 3_000 });

  await page.reload();
  await expect(page.getByTestId("first-visit-preloader")).toHaveCount(0);
});

test("first visit always opens at the top after browser scroll restoration", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByTestId("first-visit-preloader")).toBeHidden({ timeout: 20_000 });
  await page.evaluate(() => {
    window.scrollTo(0, Math.min(2400, document.documentElement.scrollHeight - window.innerHeight));
    window.sessionStorage.removeItem("trimmycrm:first-visit-intro:v2");
  });
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBeGreaterThan(0);

  await page.reload({ waitUntil: "commit" });
  await expect(page.getByTestId("first-visit-preloader")).toBeVisible();
  await expect(page.getByTestId("first-visit-preloader")).toBeHidden({ timeout: 20_000 });
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBeLessThanOrEqual(1);
});

test("landing renders its core sections", async ({ page }, testInfo) => {
  const requestedAssets: string[] = [];
  page.on("request", (request) => requestedAssets.push(request.url()));
  await page.goto("/");

  await expect(page.getByRole("heading", { level: 1 })).toContainText("Салон");
  const header = page.getByRole("banner");
  await expect(header.evaluate((element) => getComputedStyle(element).position)).resolves.toBe("fixed");
  await expect(header.locator("img").first()).toHaveAttribute("src", /trimmy-symbol\.png/);
  await expect(page.locator(".editorial-landing")).toHaveAttribute("data-motion-ready", "true");
  const revealDuration = await page.locator("[data-reveal]").first().evaluate((element) =>
    Number.parseFloat(getComputedStyle(element).transitionDuration.split(",")[0]),
  );
  expect(revealDuration).toBeGreaterThanOrEqual(1);
  const salonStory = page.locator("#salon-story");
  await expect(salonStory.locator("canvas")).toBeVisible();
  await expect.poll(() => page.locator("html").getAttribute("data-trimmy-scene"), { timeout: 30_000 }).toBe("ready");
  await expect(page.getByTestId("first-visit-preloader")).toBeHidden({ timeout: 3_000 });
  const initialProgress = await salonStory.evaluate((element) => Number.parseFloat((element as HTMLElement).style.getPropertyValue("--story-progress") || "0"));
  await page.mouse.wheel(0, 180);
  await expect.poll(() => salonStory.evaluate((element) => Number.parseFloat((element as HTMLElement).style.getPropertyValue("--story-progress") || "0"))).toBeGreaterThan(initialProgress);
  expect(requestedAssets.some((url) => url.includes("salon-world-reference.png") || url.includes("salon-chair-reference.png"))).toBe(false);
  expect(requestedAssets.some((url) => url.includes("modern_arm_chair_01.glb"))).toBe(false);
  expect(requestedAssets.some((url) => url.includes("BarberShopChair_01.glb") || url.includes("ornate_mirror_01.glb") || url.includes("sofa_03.glb"))).toBe(false);
  expect(requestedAssets.filter((url) => url.endsWith(".glb"))).toHaveLength(3);
  await expect(page.locator("#product")).toBeAttached();
  await expect(page.locator("#examples")).toBeAttached();
  await expect(page.locator("#plans")).toBeAttached();
  await expect(page.locator("#faq")).toBeAttached();
  const faq = page.locator("#faq");
  await faq.scrollIntoViewIfNeeded();
  await expect.poll(() => faq.evaluate((element) => {
    const sectionRect = element.getBoundingClientRect();
    const listRect = element.lastElementChild?.getBoundingClientRect();
    return {
      sectionLeft: Math.abs(sectionRect.left),
      sectionRight: Math.abs(document.documentElement.clientWidth - sectionRect.right),
      listRight: Math.abs(document.documentElement.clientWidth - (listRect?.right ?? 0)),
    };
  })).toEqual({ sectionLeft: 0, sectionRight: 0, listRight: 0 });
  const faqButtons = faq.getByRole("button");
  await expect(faqButtons.first()).toHaveAttribute("aria-expanded", "true");
  const faqHeightBefore = await faq.locator("[class*='faqList']").evaluate((list) => list.getBoundingClientRect().height);
  await faqButtons.nth(1).click();
  await expect(faqButtons.first()).toHaveAttribute("aria-expanded", "false");
  await expect(faqButtons.nth(1)).toHaveAttribute("aria-expanded", "true");
  await expect.poll(() => faq.locator("[class*='faqList']").evaluate((list) => list.getBoundingClientRect().height)).toBe(faqHeightBefore);
  await expect(faq.locator("[class*='faqAnswer']").nth(1).evaluate((answer) => getComputedStyle(answer).transitionProperty)).resolves.toContain("height");
  await expect(page.getByRole("heading", { name: /Для разных салонов и разных клиентов/i })).toBeAttached();
  await page.locator("#examples").scrollIntoViewIfNeeded();
  const gallery = page.getByLabel("Работы салонов и барбершопов");
  const galleryTrack = gallery.locator("div[class*='track']");
  const galleryGroups = gallery.locator("div[class*='group']");
  await expect(galleryTrack).toHaveCount(1);
  await expect(galleryGroups).toHaveCount(2);
  await expect.poll(() => galleryGroups.evaluateAll((groups) =>
    Math.abs(groups[0].getBoundingClientRect().width - groups[1].getBoundingClientRect().width),
  )).toBeLessThanOrEqual(1);
  const womanPortrait = page.getByAltText("Клиентка с аккуратным медным бобом").first();
  const manPortrait = page.getByAltText("Клиент барбершопа с низким фейдом").first();
  await expect(womanPortrait).toHaveAttribute("src", /copper-bob\.webp/);
  await expect(manPortrait).toHaveAttribute("src", /taper-fade\.webp/);
  const [womanAsset, manAsset] = await Promise.all([
    page.request.get("/images/editorial/v2/copper-bob.webp"),
    page.request.get("/images/editorial/v2/taper-fade.webp"),
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
  await expect(page.getByTestId("first-visit-preloader")).toBeHidden({ timeout: 20_000 });

  await expect(page.locator("body").evaluate((body) => body.scrollWidth <= window.innerWidth)).resolves.toBe(true);
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  await expect(page.locator("#salon-story").getByRole("link", { name: /Попробовать бесплатно/i })).toBeVisible();

  const menuButton = page.getByRole("button", { name: "Меню" });
  await expect(menuButton).toBeVisible();
  await menuButton.click();
  const navigation = page.getByRole("navigation", { name: "Навигация по лендингу" });
  await expect(navigation).toBeVisible();
  await expect(navigation.getByRole("link", { name: "Тарифы" })).toBeVisible();
});

test("journey reacts continuously and reaches the next chapter with a short scroll", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByTestId("first-visit-preloader")).toBeHidden({ timeout: 30_000 });

  const journey = page.locator("#journey");
  await journey.evaluate((section) => {
    const top = window.scrollY + section.getBoundingClientRect().top;
    window.scrollTo({ top, behavior: "auto" });
  });
  await expect(journey).toHaveAttribute("data-active-chapter", "1");

  const firstCard = journey.locator("figure[class*='mediaCard']").first();
  const transformBefore = await firstCard.evaluate((card) => getComputedStyle(card).transform);
  await journey.evaluate((section) => {
    const top = window.scrollY + section.getBoundingClientRect().top;
    window.scrollTo({ top: top + Math.ceil(window.innerHeight * .24), behavior: "auto" });
  });

  await expect.poll(() => firstCard.evaluate((card) => getComputedStyle(card).transform)).not.toBe(transformBefore);
  await expect(journey).toHaveAttribute("data-active-chapter", "2");

  await journey.evaluate((section) => {
    const top = window.scrollY + section.getBoundingClientRect().top;
    const travel = (section as HTMLElement).offsetHeight - window.innerHeight;
    window.scrollTo({ top: top + travel * .71, behavior: "auto" });
  });
  await expect(journey).toHaveAttribute("data-active-chapter", "5");

  const fifthCard = journey.locator("figure[class*='mediaCard']").nth(4);
  await expect.poll(() => fifthCard.evaluate((card) => {
    const rect = card.getBoundingClientRect();
    const visibleHeight = Math.max(0, Math.min(window.innerHeight, rect.bottom) - Math.max(0, rect.top));
    return visibleHeight / rect.height;
  })).toBeGreaterThan(.85);
  await expect.poll(() => fifthCard.locator("img").evaluate((image: HTMLImageElement) =>
    image.complete && image.naturalWidth > 0,
  )).toBe(true);
});

test("pricing anchor and cards are reachable", async ({ page }) => {
  await page.goto("/");
  await page.locator("#plans").scrollIntoViewIfNeeded();
  await expect(page.getByRole("heading", { name: /Выберите тариф под свою команду/i })).toBeVisible();
  await expect(page.locator(".plan-card")).toHaveCount(3);
  await expect(page.locator(".plan-card--featured")).toContainText("Бизнес");
});

test("site builder reorders visual sections and the try-on uses real photography", async ({ page }, testInfo) => {
  await page.goto("/");

  const builder = page.locator("#builder");
  await builder.scrollIntoViewIfNeeded();
  await expect(builder.getByRole("heading", { name: "Витрина, которая умеет записывать." })).toBeVisible();
  const builderIntro = builder.locator("[class*='builderCopy']");
  await expect(builderIntro.evaluate((element) => getComputedStyle(element).position)).resolves.toBe(testInfo.project.name === "desktop-chrome" ? "relative" : "static");
  const handles = builder.getByRole("button", { name: /Переместить секцию/i });
  await expect(handles).toHaveCount(6);
  await expect(builder.locator("button[class*='handle']")).toHaveCount(0);
  await expect(builder.getByText(/Зажмите любой блок и поменяйте порядок/i)).toBeVisible();
  await expect(builder.locator("[data-inviting='true']").first()).toBeVisible();
  await expect.poll(() => builder.evaluate((element) => {
    const rect = element.getBoundingClientRect();
    return Math.max(Math.abs(rect.left), Math.abs(document.documentElement.clientWidth - rect.right));
  })).toBeLessThanOrEqual(1);
  if (testInfo.project.name === "desktop-chrome") {
    await handles.first().focus();
    await page.keyboard.press("Shift+ArrowDown");
    await expect(handles.nth(1)).toHaveAccessibleName("Переместить секцию Обложка");
    await expect(builder.locator("[aria-live='polite']")).toContainText("позиция 2 из 6");
  }

  const journey = page.locator("#journey");
  await journey.scrollIntoViewIfNeeded();
  const firstChapter = journey.getByRole("button", { name: /Запись без звонков/ });
  await expect(firstChapter).toBeVisible();
  await firstChapter.click();
  await expect(journey).toHaveAttribute("data-active-chapter", "1");
  await page.evaluate(() => {
    const section = document.querySelector<HTMLElement>("#journey");
    document.documentElement.style.scrollBehavior = "auto";
    if (section) window.scrollTo(0, section.offsetTop + (section.offsetHeight - innerHeight) * .52);
  });
  await expect.poll(() => journey.getAttribute("data-active-chapter")).toBe("4");
  await expect(journey.getByRole("button", { name: /Продолжить с нужного места/ })).toBeVisible();

  const tryOn = page.locator("section").filter({ has: page.getByRole("heading", { name: "Примерка без загрузки фото." }) });
  await tryOn.scrollIntoViewIfNeeded();
  const portrait = tryOn.getByRole("img", { name: /многослойной стрижкой/i });
  await expect(portrait).toHaveAttribute("src", /layered-cut\.webp/);
  await expect.poll(() => portrait.evaluate((image: HTMLImageElement) => image.complete && image.naturalWidth > 0)).toBe(true);
  await expect(page.getByText("Фото обрабатывается локально в браузере.")).toHaveCount(0);
  await expect(page.getByText(/Shift и стрелки/)).toHaveCount(0);
});

test("reduced motion stays static and the cinematic footer is complete", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/");

  await expect.poll(() => page.locator("[data-reveal]").evaluateAll((elements) =>
    elements.every((element) => element.getAttribute("data-reveal-state") === "visible"),
  )).toBe(true);
  const salonStory = page.locator("#salon-story");
  await expect(salonStory.locator("canvas")).toBeVisible();
  await expect(salonStory.evaluate((element) => getComputedStyle(element).height)).resolves.not.toBe("5616px");
  const photoRows = page.getByLabel("Работы салонов и барбершопов").locator("div[class*='track']");
  await expect(photoRows).toHaveCount(1);
  await expect.poll(() => photoRows.evaluateAll((rows) => rows.every((row) => getComputedStyle(row).animationName === "none"))).toBe(true);
  const journey = page.locator("#journey");
  await journey.scrollIntoViewIfNeeded();
  await expect(journey.evaluate((element) => getComputedStyle(element).height)).resolves.not.toContain("440");
  await expect(journey.getByRole("heading", { name: "Один рабочий день в TrimmyCRM." })).toBeVisible();
  await expect(journey.locator("article")).toHaveCount(6);

  const footer = page.locator("footer");
  await footer.scrollIntoViewIfNeeded();
  await expect(footer.getByRole("heading", { name: /Салон работает. Вы управляете./i })).toBeVisible();
  await expect.poll(() => footer.locator("div[class*='cta']").evaluate((cta) => {
    const title = cta.querySelector("h2");
    const lead = cta.querySelector("p[class*='lead']");
    if (!title || !lead) return 0;
    return lead.getBoundingClientRect().top - title.getBoundingClientRect().bottom;
  })).toBeGreaterThanOrEqual(32);
  await expect(footer.getByRole("navigation", { name: "Документы и поддержка" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Вернуться в начало страницы" })).toBeVisible();
  await expect(footer.getByText("Наверх", { exact: true })).toHaveCount(0);
  await expect(footer.locator("div[class*='marquee']")).toContainText("Онлайн-запись");
  await expect(footer.locator("div[class*='giantWord']")).toContainText("TRIMMY");
  await expect(footer.locator("div[class*='curtain']").evaluate((element) => getComputedStyle(element).clipPath)).resolves.toBe("none");
});
