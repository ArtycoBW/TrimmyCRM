import { expect, test } from "@playwright/test";

import {
  mockExistingSite,
  mockOwnerProfile,
  siteFixture,
} from "./helpers/app-fixtures";
import { selectOption } from "./helpers/ui";

async function prepareOwner(page: import("@playwright/test").Page) {
  await mockOwnerProfile(page);
  await mockExistingSite(page);
}

test("dashboard tour can be replayed from instructions", async ({ page }) => {
  await prepareOwner(page);
  await page.goto("/app/instructions");
  await page.getByRole("button", { name: "Запустить тур" }).click();
  await expect(page.getByRole("dialog", { name: "Ваш рабочий кабинет" })).toBeVisible();
});

test("tariff dialog is opaque and presents readable plan features", async ({ page }, testInfo) => {
  await prepareOwner(page);
  await page.route("**/api/v1/plans", (route) => route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify([
      { id: "90cebf0d-d770-4dcd-a7ec-a847aa5afdaf", code: "start", name: "Старт", price: "990", period: "month", limits: {}, features: ["subdomain", "basic_blocks", "booking"], isActive: true },
      { id: "d2f673ae-cd20-47cb-a3d4-6f2d0a573f22", code: "business", name: "Бизнес", price: "2490", period: "month", limits: {}, features: ["all_blocks", "booking", "basic_analytics"], isActive: true },
    ]),
  }));

  await page.goto("/app");
  const trigger = page.getByRole("button", { name: "Выбрать тариф →" });
  if (testInfo.project.name === "mobile-chrome") {
    await page.getByRole("button", { name: "Открыть меню" }).click();
    const sidebar = page.locator(".crm-sidebar");
    await expect(sidebar).toHaveClass(/crm-sidebar--open/);
    await sidebar.evaluate((element) => element.scrollTo({ top: element.scrollHeight }));
  }
  await trigger.click();

  const dialog = page.getByRole("dialog", { name: "Выберите тариф" });
  await expect(dialog).toBeVisible();
  await expect(dialog).toHaveCSS("opacity", "1");
  await expect(dialog).toHaveCSS("background-color", "rgb(255, 254, 249)");
  await expect(dialog).toContainText("Базовые блоки сайта");
  await expect(dialog).not.toContainText("basic_blocks");
});

test("site builder saves an edited draft using the current API contract", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "desktop-chrome", "One API payload pass is enough");
  await prepareOwner(page);
  await page.route("**/api/v1/sites/mine/blocks", async (route) => {
    if (route.request().method() === "GET") {
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify([
        { id: "block-hero", type: "hero", position: 0, config: { title: "Лапки и ножницы" }, enabled: true },
      ]) });
      return;
    }
    const payload = route.request().postDataJSON() as { expectedVersion: number; blocks: Array<{ type: string; position: number; config: Record<string, unknown>; enabled: boolean }> };
    expect(payload).toMatchObject({ expectedVersion: siteFixture.draftVersion });
    expect(payload.blocks).toEqual(expect.arrayContaining([
      expect.objectContaining({ type: "hero", config: expect.objectContaining({ title: "Новый заголовок", accentColor: "#00aa88", titleSize: 88 }), enabled: true }),
    ]));
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify([
      { id: "block-hero", ...payload.blocks[0] },
    ]) });
  });
  await page.route("**/api/v1/sites/mine/block-catalog", (route) => route.fulfill({
    status: 200, contentType: "application/json", body: JSON.stringify([
      { type: "hero", name: "Первый экран", allowed: true, lockedReason: null, defaultConfig: { title: "" } },
    ]),
  }));
  await page.route("**/api/v1/sites/mine/preview", (route) => route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify({
      previewToken: "preview-token-abcdefghijklmnopqrstuvwxyz",
      previewUrl: "http://localhost:3000/preview?token=preview-token-abcdefghijklmnopqrstuvwxyz",
      expiresAt: "2026-07-17T23:00:00Z",
    }),
  }));

  await page.goto("/app/site");
  await expect(page.getByRole("heading", { name: "Сайт салона" })).toBeVisible();
  await page.getByLabel("Главный заголовок").fill("Новый заголовок");
  const accent = page.locator(".visual-builder__color").filter({ hasText: "Акцент" });
  await accent.locator("summary").click();
  await accent.getByLabel("Акцент: цвет в формате HEX").fill("#00aa88");
  await page.getByRole("slider", { name: "Размер заголовка" }).fill("88");
  await expect(page.locator(".visual-builder__preview")).toContainText("Новый заголовок");
  await expect(page.locator('[data-builder-block-id="block-hero"]')).toHaveCSS("--block-accent", "#00aa88");
  await page.getByRole("button", { name: "Сохранить", exact: true }).click();
  await expect(page.getByText("Черновик сохранён")).toBeVisible();

  const popupPromise = page.waitForEvent("popup");
  await page.getByRole("button", { name: "Предпросмотр" }).click();
  const popup = await popupPromise;
  await expect(popup).toHaveURL(/\/preview\?token=preview-token/);
  await popup.close();
});

test("site builder reorders blocks with drag and drop", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "desktop-chrome", "One drag-and-drop pass is enough");
  await prepareOwner(page);
  let savedTypes: string[] = [];
  await page.route("**/api/v1/sites/mine/blocks", async (route) => {
    const initial = [
      { id: "block-hero", type: "hero", position: 0, config: { title: "Лапки и ножницы" }, enabled: true },
      { id: "block-services", type: "services", position: 1, config: { title: "Услуги" }, enabled: true },
    ];
    if (route.request().method() === "GET") {
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(initial) });
      return;
    }
    const payload = route.request().postDataJSON() as { blocks: Array<{ type: string; position: number; config: Record<string, unknown>; enabled: boolean }> };
    savedTypes = payload.blocks.map((block) => block.type);
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(payload.blocks.map((block, position) => ({ ...block, id: `block-${block.type}`, position }))),
    });
  });
  await page.route("**/api/v1/sites/mine/block-catalog", (route) => route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify([
      { type: "hero", name: "Первый экран", allowed: true, lockedReason: null, defaultConfig: { title: "" } },
      { type: "services", name: "Услуги", allowed: true, lockedReason: null, defaultConfig: { title: "Услуги" } },
    ]),
  }));

  await page.goto("/app/site");
  const heroBlock = page.locator('[data-builder-block-id="block-hero"]');
  const servicesBlock = page.locator('[data-builder-block-id="block-services"]');
  await expect(heroBlock).toHaveClass(/site-preview-sortable/);
  const heroBox = await heroBlock.boundingBox();
  const servicesBox = await servicesBlock.boundingBox();
  expect(heroBox).not.toBeNull();
  expect(servicesBox).not.toBeNull();
  await page.mouse.move(heroBox!.x + 24, heroBox!.y + heroBox!.height * 0.7);
  await page.mouse.down();
  await page.mouse.move(servicesBox!.x + 24, servicesBox!.y + servicesBox!.height - 12, { steps: 14 });
  await page.mouse.up();
  await expect.poll(() => page.locator("[data-builder-block-id]").evaluateAll((items) => items.map((item) => item.getAttribute("data-builder-block-id")))).toEqual(["block-services", "block-hero"]);
  await page.getByRole("button", { name: "Сохранить", exact: true }).click();

  await expect(page.getByText("Черновик сохранён")).toBeVisible();
  expect(savedTypes).toEqual(["services", "hero"]);
});

test("site builder opens a full-size canvas and supports Windows keyboard shortcuts", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "desktop-chrome", "Desktop editor shortcut coverage is enough");
  await prepareOwner(page);
  await page.route("**/api/v1/sites/mine/blocks", (route) => route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify([
      { id: "block-hero", type: "hero", position: 0, config: { title: "Лапки и ножницы" }, enabled: true },
      { id: "block-services", type: "services", position: 1, config: { title: "Услуги и цены" }, enabled: true },
    ]),
  }));
  await page.route("**/api/v1/sites/mine/block-catalog", (route) => route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify([
      { type: "hero", name: "Первый экран", allowed: true, lockedReason: null, defaultConfig: { title: "" } },
      { type: "services", name: "Услуги", allowed: true, lockedReason: null, defaultConfig: { title: "Услуги и цены" } },
    ]),
  }));

  await page.goto("/app/site");
  await expect(page.locator(".visual-builder__shortcuts")).toContainText("Горячие клавиши");
  await page.getByRole("button", { name: "На весь экран" }).click();
  const fullscreen = page.locator(".visual-builder--fullscreen");
  await expect(fullscreen).toBeVisible();
  await expect(fullscreen.locator(".salon-site")).not.toHaveClass(/salon-site--embedded/);
  await expect(fullscreen.locator(".visual-builder__topbar")).toContainText("живой холст");
  await page.keyboard.press("Control+ArrowDown");
  await expect(page.locator('[data-builder-block-id="block-services"]')).toHaveClass(/is-selected/);
  await page.keyboard.press("Alt+ArrowUp");
  await expect.poll(() => page.locator("[data-builder-block-id]").evaluateAll((items) => items.map((item) => item.getAttribute("data-builder-block-id")))).toEqual(["block-services", "block-hero"]);

  await page.getByRole("button", { name: "Выйти из полноэкранного режима" }).click();
  await expect(page.locator(".visual-builder--fullscreen")).toHaveCount(0);
});

test("heading font selector opens above the full-screen builder", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "desktop-chrome", "Fullscreen portal layering is checked on desktop");
  await prepareOwner(page);
  await page.route("**/api/v1/sites/mine/blocks", (route) => route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify([
      { id: "block-hero", type: "hero", position: 0, config: { title: "Лапки и ножницы" }, enabled: true },
    ]),
  }));
  await page.route("**/api/v1/sites/mine/block-catalog", (route) => route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify([
      { type: "hero", name: "Первый экран", allowed: true, lockedReason: null, defaultConfig: { title: "" } },
    ]),
  }));

  await page.goto("/app/site");
  await page.getByRole("button", { name: "На весь экран" }).click();
  const fullscreen = page.locator(".visual-builder--fullscreen");
  await expect(fullscreen).toBeVisible();
  await fullscreen.getByRole("combobox").first().click();
  const fontMenu = page.locator(".ui-select-content");
  await expect(fontMenu).toBeVisible();
  await expect(fontMenu).toHaveCSS("z-index", "2200");
  await expect(fontMenu.getByRole("option", { name: /Unbounded/ })).toBeVisible();
});

test("site builder uploads a pet photo with a caption into the gallery", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "desktop-chrome", "One upload contract pass is enough");
  await prepareOwner(page);
  let savedItems: Array<Record<string, unknown>> = [];
  await page.route("**/api/v1/sites/mine/blocks", async (route) => {
    const initial = [{ id: "block-gallery", type: "gallery", position: 0, config: { title: "Наши работы", columns: 3, items: [] }, enabled: true }];
    if (route.request().method() === "GET") return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(initial) });
    const payload = route.request().postDataJSON() as { blocks: Array<{ type: string; config: { items?: Array<Record<string, unknown>> } }> };
    savedItems = payload.blocks[0].config.items || [];
    return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(payload.blocks.map((block) => ({ ...block, id: "block-gallery" }))) });
  });
  await page.route("**/api/v1/sites/mine/block-catalog", (route) => route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify([{ type: "gallery", name: "До/после", allowed: true, lockedReason: null, defaultConfig: { title: "Наши работы", columns: 3, items: [] } }]),
  }));
  await page.route("**/api/v1/media", (route) => route.fulfill({
    status: 201,
    contentType: "application/json",
    body: JSON.stringify({
      id: "2c5257bf-d8fd-44fb-a9f8-d37e1d3386bd",
      url: "/api/v1/public/media/2c5257bf-d8fd-44fb-a9f8-d37e1d3386bd",
      purpose: "gallery",
      isPublic: true,
      contentType: "image/jpeg",
      sizeBytes: 4,
      createdAt: "2026-07-17T12:00:00Z",
    }),
  }));

  await page.goto("/app/site");
  await page.locator('input[type="file"][multiple]').setInputFiles({ name: "pet.jpg", mimeType: "image/jpeg", buffer: Buffer.from([255, 216, 255, 217]) });
  await expect(page.getByText("Фотография добавлена в черновик")).toBeVisible();
  await page.getByLabel("Подпись к фотографии 1").fill("Мия после груминга");
  await expect(page.locator(".visual-builder__preview")).toContainText("Мия после груминга");
  await page.getByRole("button", { name: "Сохранить", exact: true }).click();
  await expect(page.getByText("Черновик сохранён")).toBeVisible();
  expect(savedItems).toEqual([
    expect.objectContaining({
      id: "2c5257bf-d8fd-44fb-a9f8-d37e1d3386bd",
      src: "/api/v1/public/media/2c5257bf-d8fd-44fb-a9f8-d37e1d3386bd",
      caption: "Мия после груминга",
    }),
  ]);
});

test("site builder edits FAQ content directly beside the live preview", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "desktop-chrome", "One content editing pass is enough");
  await prepareOwner(page);
  let savedItems: Array<Record<string, unknown>> = [];
  await page.route("**/api/v1/sites/mine/blocks", async (route) => {
    const initial = [{ id: "block-faq", type: "faq", position: 0, config: { title: "Частые вопросы", subtitle: "Подготовьтесь к визиту", items: [] }, enabled: true }];
    if (route.request().method() === "GET") return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(initial) });
    const payload = route.request().postDataJSON() as { blocks: Array<{ type: string; config: { items?: Array<Record<string, unknown>> } }> };
    savedItems = payload.blocks[0].config.items || [];
    return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(payload.blocks.map((block) => ({ ...block, id: "block-faq", position: 0 }))) });
  });
  await page.route("**/api/v1/sites/mine/block-catalog", (route) => route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify([{ type: "faq", name: "FAQ", allowed: true, lockedReason: null, defaultConfig: { title: "Частые вопросы", subtitle: "", items: [] } }]),
  }));

  await page.goto("/app/site");
  const repeat = page.locator(".visual-builder__repeat");
  await repeat.getByRole("button", { name: "Добавить" }).click();
  const item = repeat.locator("article").first();
  await item.getByLabel("Вопрос").fill("Можно ли привести кошку?");
  await item.getByLabel("Ответ").fill("Да, мы работаем и с кошками.");
  await expect(page.locator(".visual-builder__preview")).toContainText("Можно ли привести кошку?");
  await page.getByRole("button", { name: "Сохранить", exact: true }).click();
  await expect(page.getByText("Черновик сохранён")).toBeVisible();

  expect(savedItems).toEqual([{ question: "Можно ли привести кошку?", answer: "Да, мы работаем и с кошками." }]);
});

test("analytics and settings use the production API payloads", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "desktop-chrome", "One API payload pass is enough");
  await prepareOwner(page);
  await page.route("**/api/v1/analytics/overview?*", (route) => route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify({ from: "2026-07-01T00:00:00Z", to: "2026-07-31T00:00:00Z", appointments: 18, revenue: "43200", newClients: 5, staffUtilizationPercent: 74.5 }),
  }));
  await page.route("**/api/v1/analytics/services?*", (route) => route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify([{ serviceId: "service-1", serviceName: "Комплексный уход", appointments: 11, revenue: "26400" }]),
  }));
  await page.route("**/api/v1/analytics/export/dashboard.csv?*", (route) => route.fulfill({
    status: 200,
    contentType: "text/csv; charset=utf-8",
    headers: {
      "Content-Disposition": 'attachment; filename="analytics-dashboard.csv"',
      "Access-Control-Expose-Headers": "Content-Disposition",
    },
    body: "section;name;value\nmetric;appointments;18",
  }));
  await page.route("**/api/v1/analytics/export/dashboard.xlsx?*", (route) => route.fulfill({
    status: 200,
    contentType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    headers: {
      "Content-Disposition": 'attachment; filename="analytics-dashboard.xlsx"',
      "Access-Control-Expose-Headers": "Content-Disposition",
    },
    body: "xlsx-fixture",
  }));
  await page.route("**/api/v1/sites/mine", async (route) => {
    if (route.request().method() !== "PATCH") return route.fallback();
    const payload = route.request().postDataJSON() as Record<string, unknown>;
    expect(payload.phone).toBe("+79886501649");
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ ...siteFixture, ...payload }) });
  });

  await page.goto("/app/analytics");
  await expect(page.getByRole("heading", { name: "Аналитика" })).toBeVisible();
  await expect(page.getByText("43 200 ₽")).toBeVisible();
  await expect(page.getByRole("heading", { name: "Популярность услуг" })).toBeVisible();
  await expect.poll(() => page.locator(".analytics-chart, .analytics-services").evaluateAll((cards) => {
    const [chart, services] = cards.map((card) => Math.round(card.getBoundingClientRect().height));
    return chart === services;
  })).toBe(true);
  await expect(page.getByRole("button", { name: "CSV" })).toBeEnabled();
  await expect(page.getByRole("button", { name: "Excel" })).toBeEnabled();
  await expect(page.getByRole("button", { name: "PDF" })).toBeEnabled();
  const csvDownload = page.waitForEvent("download");
  await page.getByRole("button", { name: "CSV" }).click();
  expect((await csvDownload).suggestedFilename()).toBe("analytics-dashboard.csv");
  const xlsxDownload = page.waitForEvent("download");
  await page.getByRole("button", { name: "Excel" }).click();
  expect((await xlsxDownload).suggestedFilename()).toBe("analytics-dashboard.xlsx");
  const pdfDownload = page.waitForEvent("download");
  await page.getByRole("button", { name: "PDF" }).click();
  expect((await pdfDownload).suggestedFilename()).toBe("analytics-30-days.pdf");
  await selectOption(page, "Период", "7 дней");

  await page.goto("/app/settings");
  await page.getByLabel("Телефон").fill("89886501649");
  await expect(page.getByLabel("Телефон")).toHaveValue("+7 (988) 650 16 49");
  await page.getByRole("button", { name: "Сохранить настройки" }).click();
  await expect(page.getByText("Настройки сохранены")).toBeVisible();
});

test("owner can upload and remove the logo used by the salon site", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "desktop-chrome", "One upload contract pass is enough");
  await prepareOwner(page);
  const logoUrl = "/api/v1/public/media/2c5257bf-d8fd-44fb-a9f8-d37e1d3386bd";
  let uploaded = false;
  let deleted = false;

  await page.route("**/api/v1/sites/mine", async (route) => {
    if (route.request().method() !== "GET") return route.fallback();
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ ...siteFixture, logoUrl: uploaded && !deleted ? logoUrl : null }),
    });
  });
  await page.route("**/api/v1/media", async (route) => {
    expect(route.request().method()).toBe("POST");
    expect(route.request().postDataBuffer()?.includes(Buffer.from("logo-file"))).toBe(true);
    uploaded = true;
    await route.fulfill({
      status: 201,
      contentType: "application/json",
      body: JSON.stringify({
        id: "2c5257bf-d8fd-44fb-a9f8-d37e1d3386bd",
        url: logoUrl,
        purpose: "logo",
        isPublic: true,
        contentType: "image/png",
        sizeBytes: 9,
        createdAt: "2026-07-17T12:00:00Z",
      }),
    });
  });
  await page.route("**/api/v1/media/2c5257bf-d8fd-44fb-a9f8-d37e1d3386bd", async (route) => {
    expect(route.request().method()).toBe("DELETE");
    deleted = true;
    await route.fulfill({ status: 204 });
  });

  await page.goto("/app/settings");
  await expect(page.getByText("Логотип сайта")).toBeVisible();
  await page.getByLabel("Загрузить логотип").setInputFiles({
    name: "salon-logo.png",
    mimeType: "image/png",
    buffer: Buffer.from("logo-file"),
  });
  await expect(page.getByRole("status")).toContainText("Логотип сайта обновлён");
  await expect(page.locator(".settings-logo__preview img")).toBeVisible();
  await page.getByRole("button", { name: "Удалить" }).click();
  await expect(page.getByRole("status")).toContainText("Логотип удалён");
  await expect(page.locator(".settings-logo__preview img")).toHaveCount(0);
});

test("new owner workspaces fit the mobile viewport", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "mobile-chrome", "Mobile-specific layout check");
  await prepareOwner(page);
  await page.route("**/api/v1/sites/mine/blocks", (route) => route.fulfill({
    status: 200, contentType: "application/json", body: JSON.stringify([
      { id: "block-hero", type: "hero", position: 0, config: { title: "Лапки и ножницы" }, enabled: true },
    ]),
  }));
  await page.route("**/api/v1/sites/mine/block-catalog", (route) => route.fulfill({
    status: 200, contentType: "application/json", body: JSON.stringify([
      { type: "services", name: "Услуги", allowed: true, lockedReason: null, defaultConfig: { title: "Услуги" } },
    ]),
  }));
  await page.route("**/api/v1/analytics/overview?*", (route) => route.fulfill({
    status: 200, contentType: "application/json", body: JSON.stringify({ from: "2026-07-01T00:00:00Z", to: "2026-07-31T00:00:00Z", appointments: 18, revenue: "43200", newClients: 5, staffUtilizationPercent: 74.5 }),
  }));
  await page.route("**/api/v1/analytics/services?*", (route) => route.fulfill({
    status: 200, contentType: "application/json", body: JSON.stringify([{ serviceId: "service-1", serviceName: "Комплексный уход", appointments: 11, revenue: "26400" }]),
  }));

  for (const path of ["/app/site", "/app/analytics", "/app/settings"]) {
    await page.goto(path);
    await expect(page.locator("#crm-content")).toBeVisible();
    await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
  }
});
