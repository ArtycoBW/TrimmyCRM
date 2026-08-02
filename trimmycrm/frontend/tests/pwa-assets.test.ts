import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

import { expect, test } from "vitest";

import manifest from "@/app/manifest";

const publicDirectory = resolve(import.meta.dirname, "..", "public", "brand");

function pngDimensions(filename: string) {
  const image = readFileSync(resolve(publicDirectory, filename));
  expect(image.subarray(1, 4).toString("ascii")).toBe("PNG");
  return { width: image.readUInt32BE(16), height: image.readUInt32BE(20) };
}

test("PWA manifest exposes the TrimmyCRM mark in standard icon sizes", async () => {
  const appManifest = await manifest();

  expect(appManifest.icons).toEqual([
    { src: "/brand/trimmy-mark-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
    { src: "/brand/trimmy-mark-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
    { src: "/brand/trimmy-mark-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
  ]);
  expect(appManifest.background_color).toBe("#ffffff");
  expect(appManifest.theme_color).toBe("#d15022");
});

test("generated logo files are valid PNGs at the advertised sizes", () => {
  for (const [filename, size] of [
    ["trimmy-mark-64.png", 64],
    ["trimmy-mark-180.png", 180],
    ["trimmy-mark-192.png", 192],
    ["trimmy-mark-512.png", 512],
  ] as const) {
    expect(existsSync(resolve(publicDirectory, filename))).toBe(true);
    expect(pngDimensions(filename)).toEqual({ width: size, height: size });
  }
});
