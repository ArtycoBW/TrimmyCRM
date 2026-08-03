import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { fallbackPlans, normalizePlans } from "../src/content/landing";

describe("landing pricing contract", () => {
  it("matches prices seeded by the backend migration", () => {
    expect(fallbackPlans.map(({ code, price }) => ({ code, price }))).toEqual([
      { code: "start", price: 990 },
      { code: "business", price: 2490 },
      { code: "pro", price: 4990 },
    ]);
  });

  it("normalizes API decimals and keeps product order", () => {
    const result = normalizePlans([
      { id: "3", code: "pro", name: "Профи", price: "4990.00", period: "month" },
      { id: "1", code: "start", name: "Старт", price: "990.00", period: "month" },
      { id: "2", code: "business", name: "Бизнес", price: "2490.00", period: "month" },
    ]);

    expect(result.map((plan) => plan.code)).toEqual(["start", "business", "pro"]);
    expect(result[1].featured).toBe(true);
  });

  it("falls back when the API response is incomplete", () => {
    expect(normalizePlans([{ code: "start", name: "Старт", price: 990 }])).toBe(fallbackPlans);
  });
});

describe("editorial asset provenance", () => {
  it("tracks every generated visual with its exact checksum", () => {
    const manifest = JSON.parse(readFileSync(new URL("../public/images/editorial/manifest.json", import.meta.url), "utf8")) as {
      containsSyntheticPeopleOnly: boolean;
      productionApproved: boolean;
      assets: Array<{ path: string; sha256: string }>;
    };

    expect(manifest.containsSyntheticPeopleOnly).toBe(true);
    expect(manifest.productionApproved).toBe(false);
    expect(manifest.assets).toHaveLength(7);
    for (const asset of manifest.assets) {
      const bytes = readFileSync(new URL(`../public${asset.path}`, import.meta.url));
      expect(createHash("sha256").update(bytes).digest("hex")).toBe(asset.sha256);
    }
  });
});
