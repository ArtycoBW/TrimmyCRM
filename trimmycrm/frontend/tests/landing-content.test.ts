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
    expect(manifest.assets).toHaveLength(22);
    for (const asset of manifest.assets) {
      const bytes = readFileSync(new URL(`../public${asset.path}`, import.meta.url));
      expect(createHash("sha256").update(bytes).digest("hex")).toBe(asset.sha256);
    }
  });

  it("tracks the generated references and Three.js scene plates", () => {
    const manifest = JSON.parse(readFileSync(new URL("../public/images/landing/three/manifest.json", import.meta.url), "utf8")) as {
      productionApproved: boolean;
      assets: Array<{
        path: string;
        sha256: string;
        reconstruction?: { workflow: string; fidelity: string };
        rendering?: { engine: string; fidelity: string };
      }>;
    };

    expect(manifest.productionApproved).toBe(false);
    expect(manifest.assets).toHaveLength(5);
    expect(manifest.assets[0].reconstruction?.workflow).toBe("img2threejs 1.5.1");
    expect(manifest.assets[0].reconstruction?.fidelity).toContain("stylized approximation");
    expect(manifest.assets[1].reconstruction?.workflow).toContain("img2threejs 1.5.1");
    expect(manifest.assets.slice(2)).toSatisfy((assets: typeof manifest.assets) =>
      assets.every((asset) => asset.rendering?.engine === "Three.js local texture shader" && asset.rendering.fidelity.includes("photoreal")),
    );
    for (const asset of manifest.assets) {
      const bytes = readFileSync(new URL(`../public${asset.path}`, import.meta.url));
      expect(createHash("sha256").update(bytes).digest("hex")).toBe(asset.sha256);
    }
  });

  it("tracks only the CC0 support models used alongside the procedural salon chairs", () => {
    const manifest = JSON.parse(readFileSync(new URL("../public/models/salon/manifest.json", import.meta.url), "utf8")) as {
      license: string;
      assets: Array<{ file: string; sourceUrl: string; sha256: string }>;
    };

    expect(manifest.license).toBe("CC0 1.0");
    expect(manifest.assets.map((asset) => asset.file)).toEqual([
      "modern_ceiling_lamp_01.glb",
      "modern_coffee_table_01.glb",
      "modern_wooden_cabinet.glb",
    ]);
    for (const asset of manifest.assets) {
      expect(asset.sourceUrl).toMatch(/^https:\/\/polyhaven\.com\/a\//);
      const bytes = readFileSync(new URL(`../public/models/salon/${asset.file}`, import.meta.url));
      expect(createHash("sha256").update(bytes).digest("hex")).toBe(asset.sha256);
    }
  });
});
