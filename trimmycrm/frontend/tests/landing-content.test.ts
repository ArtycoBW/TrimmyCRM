import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { fallbackPlans, normalizePlans } from "../src/content/landing";
import { ASCII_RENDER_MODES } from "../src/components/landing/ascii-hair-portrait";

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

describe("editorial portrait provenance", () => {
  it("tracks every synthetic portrait with its exact checksum", () => {
    const manifest = JSON.parse(readFileSync(new URL("../public/images/editorial/manifest.json", import.meta.url), "utf8")) as {
      containsSyntheticPeopleOnly: boolean;
      productionApproved: boolean;
      assets: Array<{ path: string; sha256: string }>;
    };

    expect(manifest.containsSyntheticPeopleOnly).toBe(true);
    expect(manifest.productionApproved).toBe(false);
    expect(manifest.assets).toHaveLength(6);
    for (const asset of manifest.assets) {
      const bytes = readFileSync(new URL(`../public${asset.path}`, import.meta.url));
      expect(createHash("sha256").update(bytes).digest("hex")).toBe(asset.sha256);
    }
  });
});

describe("landing Canvas2D effect", () => {
  it("keeps every supported raster render mode available", () => {
    expect(ASCII_RENDER_MODES).toHaveLength(25);
    expect(new Set(ASCII_RENDER_MODES).size).toBe(ASCII_RENDER_MODES.length);
    expect(ASCII_RENDER_MODES).toContain("hatch");
    expect(ASCII_RENDER_MODES).toContain("matrix");
    expect(ASCII_RENDER_MODES).toContain("halfblocks");
  });
});
