import type { HairstyleAudience, HairstyleManifest, HairstyleTemplate } from "./template-types";

const allowedAudiences = new Set<HairstyleAudience>(["women", "men", "all"]);
const assetPathPattern = /^\/hairstyles\/(?:women|barber|beard)\/[a-z0-9-]+\.(?:png|webp)$/;
const checksumPattern = /^[a-f0-9]{64}$/;
const idPattern = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function finiteUnit(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value > 0 && value <= 1;
}

function parseTemplate(value: unknown): HairstyleTemplate | null {
  if (!isRecord(value) || !isRecord(value.anchor)) return null;
  const rawAudience = Array.isArray(value.audience) ? value.audience : [];
  const audience = rawAudience
    ? rawAudience.filter((item): item is HairstyleAudience => typeof item === "string" && allowedAudiences.has(item as HairstyleAudience))
    : [];
  const asset = typeof value.asset === "string" ? value.asset : "";
  const preview = typeof value.preview === "string" ? value.preview : "";
  if (
    typeof value.id !== "string" || !idPattern.test(value.id)
    || typeof value.label !== "string" || !value.label.trim()
    || audience.length === 0 || audience.length !== rawAudience.length
    || !assetPathPattern.test(asset) || !assetPathPattern.test(preview)
    || !finiteUnit(value.anchor.x) || !finiteUnit(value.anchor.y) || !finiteUnit(value.anchor.width)
    || typeof value.author !== "string" || !value.author.trim()
    || typeof value.rightsBasis !== "string" || !value.rightsBasis.trim()
    || typeof value.rightsDocument !== "string" || !value.rightsDocument.trim()
    || typeof value.sha256 !== "string" || !checksumPattern.test(value.sha256)
    || typeof value.productionApproved !== "boolean"
  ) return null;

  return {
    id: value.id,
    label: value.label.trim(),
    audience,
    asset,
    preview,
    anchor: { x: value.anchor.x, y: value.anchor.y, width: value.anchor.width },
    author: value.author.trim(),
    rightsBasis: value.rightsBasis.trim(),
    rightsDocument: value.rightsDocument.trim(),
    sha256: value.sha256,
    productionApproved: value.productionApproved,
  };
}

export function parseHairstyleManifest(value: unknown): HairstyleManifest {
  if (!isRecord(value) || value.version !== 1 || !Array.isArray(value.templates)) {
    throw new Error("Каталог причёсок имеет неверный формат");
  }
  const parsedTemplates = value.templates.map(parseTemplate);
  if (parsedTemplates.length === 0 || parsedTemplates.some((template) => template === null)) {
    throw new Error("Каталог причёсок не прошёл проверку безопасности");
  }
  const templates = parsedTemplates.filter((template): template is HairstyleTemplate => template !== null);
  const ids = new Set(templates.map((template) => template.id));
  if (ids.size !== templates.length) throw new Error("В каталоге причёсок есть повторяющиеся ID");
  return { version: 1, templates };
}

export async function loadHairstyleManifest(signal?: AbortSignal): Promise<HairstyleManifest> {
  const response = await fetch("/hairstyles/manifest.json", {
    cache: "force-cache",
    credentials: "omit",
    signal,
  });
  if (!response.ok) throw new Error("Не удалось открыть локальный каталог причёсок");
  return parseHairstyleManifest(await response.json());
}
