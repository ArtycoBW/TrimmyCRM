import { afterEach, describe, expect, test, vi } from "vitest";

import { mediaUrl } from "@/components/site/public-salon-site";
import type { PublicSiteSnapshot } from "@/lib/api/types";

const snapshot = {
  id: "site-1",
  name: "Форма",
  slug: "forma",
  salonType: "women_hair_salon",
  serviceFocuses: ["haircut", "color"],
  locale: "ru-RU",
  currency: "RUB",
  description: null,
  city: null,
  street: null,
  phone: null,
  workHours: {},
  socials: {},
  logoUrl: null,
  theme: {},
  timezone: "Europe/Moscow",
  templateKey: "default",
  blocks: [],
} satisfies PublicSiteSnapshot;

afterEach(() => vi.unstubAllEnvs());

describe("mediaUrl", () => {
  test("uses the tenant origin during server rendering of the embedded builder", () => {
    vi.stubEnv("NEXT_PUBLIC_SITE_URL", "http://trimmycrm.localhost:8080");
    vi.stubEnv("NEXT_PUBLIC_TENANT_BASE_DOMAIN", "trimmycrm.localhost:8080");

    expect(mediaUrl("/api/v1/public/media/11111111-1111-4111-8111-111111111111", snapshot, true))
      .toBe("http://forma.trimmycrm.localhost:8080/api/v1/public/media/11111111-1111-4111-8111-111111111111");
  });

  test("uses a verified custom domain for embedded media", () => {
    expect(mediaUrl("/api/v1/public/media/11111111-1111-4111-8111-111111111111", {
      ...snapshot,
      customDomain: "salon.example.ru",
    }, true)).toBe("https://salon.example.ru/api/v1/public/media/11111111-1111-4111-8111-111111111111");
  });

  test("keeps public-site media relative", () => {
    expect(mediaUrl("/api/v1/public/media/11111111-1111-4111-8111-111111111111", snapshot, false))
      .toBe("/api/v1/public/media/11111111-1111-4111-8111-111111111111");
  });
});
