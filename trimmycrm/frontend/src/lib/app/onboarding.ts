import { z } from "zod";

import { salonTypes } from "@/lib/app/salon-profile";

const transliteration: Record<string, string> = {
  а: "a", б: "b", в: "v", г: "g", д: "d", е: "e", ё: "e", ж: "zh",
  з: "z", и: "i", й: "y", к: "k", л: "l", м: "m", н: "n", о: "o",
  п: "p", р: "r", с: "s", т: "t", у: "u", ф: "f", х: "h", ц: "c",
  ч: "ch", ш: "sh", щ: "sch", ъ: "", ы: "y", ь: "", э: "e", ю: "yu",
  я: "ya",
};

export function slugifySalonName(value: string) {
  const transliterated = Array.from(value.toLowerCase())
    .map((character) => transliteration[character] ?? character)
    .join("");
  return transliterated
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .replace(/-{2,}/g, "-")
    .slice(0, 63)
    .replace(/-+$/g, "");
}

export const onboardingSchema = z.object({
  name: z.string().trim().min(2, "Введите название салона").max(160, "Не более 160 символов"),
  salonType: z.enum(salonTypes),
  city: z.string().trim().max(160, "Не более 160 символов"),
  slug: z
    .string()
    .trim()
    .toLowerCase()
    .min(3, "Минимум 3 символа")
    .max(63, "Не более 63 символов")
    .regex(/^[a-z0-9](?:[a-z0-9-]{1,61}[a-z0-9])$/, "Только латиница, цифры и дефис"),
  timezone: z.string().min(1, "Выберите часовой пояс").max(64),
});

export type OnboardingValues = z.infer<typeof onboardingSchema>;
