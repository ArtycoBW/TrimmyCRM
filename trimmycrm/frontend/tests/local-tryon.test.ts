import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, test } from "vitest";

import { clampTransform, initialTransform, moveTransform } from "@/features/local-tryon/canvas-engine";
import { MAX_PHOTO_BYTES, validatePhotoFile, workingSize } from "@/features/local-tryon/image-loader";
import { consultationHref } from "@/features/local-tryon/privacy-boundary";
import { parseHairstyleManifest } from "@/features/local-tryon/template-manifest";

const frontendRoot = fileURLToPath(new URL("../", import.meta.url));
const repositoryRoot = fileURLToPath(new URL("../../", import.meta.url));

function text(path: string) {
  return readFileSync(path, "utf8");
}

describe("local hairstyle try-on privacy boundary", () => {
  test("validates local image metadata and limits working pixels", () => {
    expect(() => validatePhotoFile({ type: "image/png", size: 1024 })).not.toThrow();
    expect(() => validatePhotoFile({ type: "image/gif", size: 1024 })).toThrow("JPG, PNG или WebP");
    expect(() => validatePhotoFile({ type: "image/jpeg", size: MAX_PHOTO_BYTES + 1 })).toThrow("12 МБ");
    expect(workingSize(4000, 2000)).toEqual({ width: 2048, height: 1024 });
    expect(() => workingSize(6000, 5000)).toThrow("слишком много пикселей");
  });

  test("keeps transform values bounded and creates a template-only booking link", () => {
    const template = {
      id: "women-blunt-bob-01",
      label: "Графичный боб",
      audience: ["women" as const],
      asset: "/hairstyles/women/blunt-bob-01.png",
      preview: "/hairstyles/women/blunt-bob-01.png",
      anchor: { x: 0.5, y: 0.38, width: 0.64 },
      author: "TrimmyCRM",
      rightsBasis: "prototype",
      rightsDocument: "PENDING",
      sha256: "a".repeat(64),
      productionApproved: false,
    };
    const initial = initialTransform(template);
    expect(moveTransform(initial, 0.1, -0.08)).toMatchObject({ x: 0.6, y: 0.3 });
    expect(clampTransform({ ...initial, width: 9, opacity: 0, rotation: 999 })).toMatchObject({ width: 1.5, opacity: 0.25, rotation: 180 });
    expect(consultationHref(template.id)).toBe("/client?booking=1&hairstyleTemplateId=women-blunt-bob-01");
    expect(() => consultationHref("https://outside.example/style")).toThrow("Некорректный ID");
  });

  test("ships only curated same-origin prototype assets with matching checksums", () => {
    const manifestPath = `${frontendRoot}/public/hairstyles/manifest.json`;
    const manifest = parseHairstyleManifest(JSON.parse(text(manifestPath)));

    expect(manifest.templates).toHaveLength(2);
    for (const template of manifest.templates) {
      expect(template.asset).toMatch(/^\/hairstyles\/(women|barber|beard)\/[a-z0-9-]+\.(png|webp)$/);
      expect(template.productionApproved).toBe(false);
      expect(template.rightsDocument).toContain("PENDING-LEGAL");
      const assetPath = `${frontendRoot}/public${template.asset}`;
      const digest = createHash("sha256").update(readFileSync(assetPath)).digest("hex");
      expect(digest).toBe(template.sha256);
    }
  });

  test("defaults the kill switch to off and isolates the route from external origins", () => {
    expect(text(`${frontendRoot}/.env.example`)).toContain("LOCAL_TRYON_ENABLED=false");
    expect(text(`${repositoryRoot}/deploy/infra/.env.example`)).toContain("LOCAL_TRYON_ENABLED=false");
    const nextConfig = text(`${frontendRoot}/next.config.ts`);
    expect(nextConfig).toContain("connect-src 'self'");
    expect(nextConfig).toContain("frame-ancestors 'none'");
    expect(nextConfig).toContain("camera=(), microphone=(), geolocation=()");
    const serviceWorker = text(`${frontendRoot}/public/sw.js`);
    expect(serviceWorker).toContain('url.pathname === "/try-on"');
    expect(serviceWorker).toContain('url.pathname.startsWith("/hairstyles/")');
  });

  test("does not add a backend upload, job or result domain", () => {
    const backendFiles = [
      `${repositoryRoot}/backend/app/models.py`,
      `${repositoryRoot}/backend/app/schemas.py`,
      `${repositoryRoot}/backend/app/main.py`,
    ].map(text).join("\n").toLowerCase();
    expect(backendFiles).not.toContain("tryon");
    expect(backendFiles).not.toContain("try_on");
    expect(backendFiles).not.toContain("try-on");
  });

  test("privacy policy describes the implemented local data flow", () => {
    const policy = text(`${frontendRoot}/src/app/(legal)/privacy/page.tsx`);
    expect(policy).toContain("TrimmyCRM и салон не получают и не хранят исходное фото");
    expect(policy).toContain("без распознавания и установления личности");
    expect(policy).toContain("только идентификатор выбранного шаблона");
  });
});
