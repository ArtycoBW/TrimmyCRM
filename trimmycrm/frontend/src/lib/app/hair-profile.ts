import { z } from "zod";

import type { ClientHairProfileView } from "@/lib/api/types";

export const hairLengthOptions = [
  { value: "", label: "Не указано" },
  { value: "shaved", label: "Бритьё / очень короткие" },
  { value: "short", label: "Короткие" },
  { value: "medium", label: "Средние" },
  { value: "long", label: "Длинные" },
  { value: "very_long", label: "Очень длинные" },
] as const;

export const hairDensityOptions = [
  { value: "", label: "Не указано" },
  { value: "low", label: "Низкая" },
  { value: "medium", label: "Средняя" },
  { value: "high", label: "Высокая" },
] as const;

export const hairTextureOptions = [
  { value: "", label: "Не указано" },
  { value: "straight", label: "Прямые" },
  { value: "wavy", label: "Волнистые" },
  { value: "curly", label: "Кудрявые" },
  { value: "coily", label: "Очень кудрявые" },
] as const;

export const hairPorosityOptions = [
  { value: "", label: "Не указано" },
  { value: "low", label: "Низкая" },
  { value: "medium", label: "Средняя" },
  { value: "high", label: "Высокая" },
  { value: "unknown", label: "Не определена" },
] as const;

const optionalText = (limit: number) => z.string().trim().max(limit, `Не более ${limit} символов`);

export const hairProfileFormSchema = z.object({
  hairLength: z.enum(["", "shaved", "short", "medium", "long", "very_long"]),
  density: z.enum(["", "low", "medium", "high"]),
  texture: z.enum(["", "straight", "wavy", "curly", "coily"]),
  porosity: z.enum(["", "low", "medium", "high", "unknown"]),
  conditionNotes: optionalText(3000),
  scalpSensitivityNotes: optionalText(3000),
  grayPercentage: z.string().trim().refine(
    (value) => value === "" || (/^\d{1,3}$/.test(value) && Number(value) <= 100),
    "Введите число от 0 до 100",
  ),
  naturalColor: optionalText(160),
  currentColor: optionalText(160),
  colorHistory: optionalText(5000),
  beardLength: optionalText(160),
  beardStyle: optionalText(500),
  moustacheStyle: optionalText(500),
  preferences: optionalText(5000),
});

export type HairProfileFormValues = z.infer<typeof hairProfileFormSchema>;

export function hairProfileInitialValues(
  profile: ClientHairProfileView | null,
): HairProfileFormValues {
  return {
    hairLength: profile?.hairLength || "",
    density: profile?.density || "",
    texture: profile?.texture || "",
    porosity: profile?.porosity || "",
    conditionNotes: profile?.conditionNotes || "",
    scalpSensitivityNotes: profile?.scalpSensitivityNotes || "",
    grayPercentage: profile?.grayPercentage == null ? "" : String(profile.grayPercentage),
    naturalColor: profile?.naturalColor || "",
    currentColor: profile?.currentColor || "",
    colorHistory: profile?.colorHistory || "",
    beardLength: profile?.beardLength || "",
    beardStyle: profile?.beardStyle || "",
    moustacheStyle: profile?.moustacheStyle || "",
    preferences: profile?.preferences || "",
  };
}

export function hairProfilePayload(values: HairProfileFormValues, version: number) {
  const nullable = (value: string) => value.trim() || null;
  return {
    hairLength: values.hairLength || null,
    density: values.density || null,
    texture: values.texture || null,
    porosity: values.porosity || null,
    conditionNotes: nullable(values.conditionNotes),
    scalpSensitivityNotes: nullable(values.scalpSensitivityNotes),
    grayPercentage: values.grayPercentage === "" ? null : Number(values.grayPercentage),
    naturalColor: nullable(values.naturalColor),
    currentColor: nullable(values.currentColor),
    colorHistory: nullable(values.colorHistory),
    beardLength: nullable(values.beardLength),
    beardStyle: nullable(values.beardStyle),
    moustacheStyle: nullable(values.moustacheStyle),
    preferences: nullable(values.preferences),
    expectedVersion: version,
  };
}

const labels: Record<string, string> = Object.fromEntries(
  [...hairLengthOptions, ...hairDensityOptions, ...hairTextureOptions, ...hairPorosityOptions]
    .filter((option) => option.value)
    .map((option) => [option.value, option.label]),
);

export function hairCharacteristicLabel(value: string | null): string {
  return value ? labels[value] || value : "Не указано";
}
