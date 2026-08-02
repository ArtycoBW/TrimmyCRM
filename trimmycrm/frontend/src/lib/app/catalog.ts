import { z } from "zod";

import type {
  PublicServiceView,
  ServiceAudience,
  ServicePriceType,
  ServiceView,
  SiteView,
} from "@/lib/api/types";

const moneyField = (required: boolean) => z
  .string()
  .trim()
  .refine(
    (value) => !value && !required || /^\d+(?:[.,]\d{1,2})?$/.test(value)
      && Number(value.replace(",", ".")) <= 99_999_999.99,
    "Цена должна быть положительным числом с двумя знаками после запятой",
  );

export const serviceFormSchema = z.object({
  name: z.string().trim().min(2, "Введите название услуги").max(160, "Не более 160 символов"),
  categoryId: z.string(),
  description: z.string().trim().max(3000, "Не более 3000 символов"),
  priceType: z.enum(["fixed", "from", "range", "consultation"]),
  price: moneyField(true).refine(Boolean, "Укажите цену"),
  maxPrice: moneyField(false),
  durationMin: z
    .string()
    .trim()
    .refine(
      (value) => Number.isInteger(Number(value)) && Number(value) >= 15 && Number(value) <= 1440 && Number(value) % 5 === 0,
      "От 15 до 1440 минут, шаг 5 минут",
    ),
  bufferBeforeMin: z
    .string()
    .trim()
    .refine(
      (value) => Number.isInteger(Number(value)) && Number(value) >= 0 && Number(value) <= 240,
      "От 0 до 240 минут",
    ),
  bufferAfterMin: z
    .string()
    .trim()
    .refine(
      (value) => Number.isInteger(Number(value)) && Number(value) >= 0 && Number(value) <= 240,
      "От 0 до 240 минут",
    ),
  requiresConsultation: z.boolean(),
  requiresPatchTest: z.boolean(),
  allowOnlineBooking: z.boolean(),
  variantSelectionRequired: z.boolean(),
  preparationText: z.string().trim().max(3000, "Не более 3000 символов"),
  aftercareText: z.string().trim().max(3000, "Не более 3000 символов"),
  isActive: z.boolean(),
}).superRefine((value, context) => {
  const price = Number(value.price.replace(",", "."));
  const maxPrice = value.maxPrice ? Number(value.maxPrice.replace(",", ".")) : null;
  if (value.priceType === "range" && maxPrice === null) {
    context.addIssue({ code: "custom", path: ["maxPrice"], message: "Укажите верхнюю границу" });
  }
  if (maxPrice !== null && maxPrice < price) {
    context.addIssue({
      code: "custom",
      path: ["maxPrice"],
      message: "Максимальная цена должна быть не ниже базовой",
    });
  }
});

export type ServiceFormValues = z.infer<typeof serviceFormSchema>;

export const servicePriceTypeOptions: Array<{ value: ServicePriceType; label: string }> = [
  { value: "fixed", label: "Фиксированная" },
  { value: "from", label: "От указанной суммы" },
  { value: "range", label: "Диапазон" },
  { value: "consultation", label: "После консультации" },
];

export const serviceAudienceOptions: Array<{ value: ServiceAudience; label: string }> = [
  { value: "all", label: "Для всех" },
  { value: "women", label: "Женские услуги" },
  { value: "men", label: "Мужские услуги" },
  { value: "kids", label: "Детские услуги" },
];

function moneyValue(value: string) {
  return Number(value.replace(",", "."));
}

export function buildServicePayload(values: ServiceFormValues) {
  return {
    name: values.name,
    description: values.description || null,
    categoryId: values.categoryId === "uncategorized" ? null : values.categoryId || null,
    price: moneyValue(values.price),
    maxPrice: values.maxPrice ? moneyValue(values.maxPrice) : null,
    priceType: values.priceType,
    currency: "RUB" as const,
    durationMin: Number(values.durationMin),
    bufferBeforeMin: Number(values.bufferBeforeMin),
    bufferAfterMin: Number(values.bufferAfterMin),
    requiresConsultation: values.requiresConsultation,
    requiresPatchTest: values.requiresPatchTest,
    allowOnlineBooking: values.allowOnlineBooking,
    variantSelectionRequired: values.variantSelectionRequired,
    preparationText: values.preparationText || null,
    aftercareText: values.aftercareText || null,
    isActive: values.isActive,
  };
}

export function formatServicePrice(service: Pick<
  ServiceView | PublicServiceView,
  "price" | "maxPrice" | "priceType"
>) {
  const format = (value: string | number) => new Intl.NumberFormat("ru-RU", {
    maximumFractionDigits: 0,
  }).format(Number(value)) + " ₽";
  if (service.priceType === "consultation") return "После консультации";
  if (service.priceType === "from") return "от " + format(service.price);
  if (service.priceType === "range" && service.maxPrice !== null) {
    return format(service.price) + " — " + format(service.maxPrice);
  }
  return format(service.price);
}

export const catalogOptionSchema = z.object({
  label: z.string().trim().min(1, "Введите название").max(120, "Не более 120 символов"),
  priceDelta: moneyField(true).refine(Boolean, "Укажите доплату, можно 0"),
  durationDeltaMin: z.string().trim().refine(
    (value) => Number.isInteger(Number(value))
      && Number(value) >= 0
      && Number(value) <= 1440
      && Number(value) % 5 === 0,
    "От 0 до 1440 минут, шаг 5 минут",
  ),
});

export type CatalogOptionValues = z.infer<typeof catalogOptionSchema>;

export function buildCatalogOptionPayload(values: CatalogOptionValues) {
  return {
    priceDelta: moneyValue(values.priceDelta),
    durationDeltaMin: Number(values.durationDeltaMin),
  };
}

const optionalStaffEmail = z
  .string()
  .trim()
  .max(320, "Email слишком длинный")
  .refine((value) => !value || z.email().safeParse(value).success, "Проверьте формат email");

export const staffFormSchema = z.object({
  name: z.string().trim().min(2, "Введите имя мастера").max(160, "Не более 160 символов"),
  email: optionalStaffEmail,
  specialization: z.string().trim().max(500, "Не более 500 символов"),
  isActive: z.boolean(),
});

export type StaffFormValues = z.infer<typeof staffFormSchema>;

export type ScheduleRange = { start: string; end: string };
export type WeeklySchedule = Record<string, ScheduleRange[]>;

export const weekdays = [
  { key: "monday", short: "Пн", label: "Понедельник" },
  { key: "tuesday", short: "Вт", label: "Вторник" },
  { key: "wednesday", short: "Ср", label: "Среда" },
  { key: "thursday", short: "Чт", label: "Четверг" },
  { key: "friday", short: "Пт", label: "Пятница" },
  { key: "saturday", short: "Сб", label: "Суббота" },
  { key: "sunday", short: "Вс", label: "Воскресенье" },
] as const;

const timePattern = /^([01]\d|2[0-3]):[0-5]\d$/;

export function emptyWeeklySchedule(): WeeklySchedule {
  return Object.fromEntries(weekdays.map((day) => [day.key, []]));
}

export function normalizeSchedule(value: SiteView["workHours"] | null | undefined): WeeklySchedule {
  const result = emptyWeeklySchedule();
  if (!value) return result;
  for (const day of weekdays) {
    const raw = value[day.key];
    const ranges = Array.isArray(raw) ? raw : raw ? [raw] : [];
    result[day.key] = ranges
      .filter((range): range is ScheduleRange => Boolean(range?.start && range?.end))
      .map((range) => ({ start: String(range.start), end: String(range.end) }));
  }
  return result;
}

export function compactSchedule(schedule: WeeklySchedule): SiteView["workHours"] {
  return Object.fromEntries(
    weekdays
      .map((day) => [day.key, schedule[day.key] || []] as const)
      .filter(([, ranges]) => ranges.length > 0),
  );
}

export function validateSchedule(schedule: WeeklySchedule): string | null {
  for (const day of weekdays) {
    const ranges = schedule[day.key] || [];
    if (ranges.length > 8) return day.label + ": не более 8 интервалов";
    const normalized = [...ranges].sort((left, right) => left.start.localeCompare(right.start));
    for (let index = 0; index < normalized.length; index += 1) {
      const range = normalized[index];
      if (!timePattern.test(range.start) || !timePattern.test(range.end)) {
        return day.label + ": проверьте формат времени";
      }
      if (range.end <= range.start) return day.label + ": окончание должно быть позже начала";
      if (index > 0 && normalized[index - 1].end > range.start) {
        return day.label + ": интервалы не должны пересекаться";
      }
    }
  }
  return null;
}

export function weeklyMinutes(schedule: WeeklySchedule) {
  return weekdays.reduce((total, day) => total + (schedule[day.key] || []).reduce((sum, range) => {
    const [startHour, startMinute] = range.start.split(":").map(Number);
    const [endHour, endMinute] = range.end.split(":").map(Number);
    return sum + (endHour * 60 + endMinute) - (startHour * 60 + startMinute);
  }, 0), 0);
}

export function formatDuration(minutes: number) {
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  if (!hours) return minutes + " мин";
  return rest ? hours + " ч " + rest + " мин" : hours + " ч";
}

export function staffInitials(value: string) {
  return value
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join("") || "М";
}

export const exceptionKinds = {
  day_off: { label: "Выходной", tone: "magenta" },
  break: { label: "Перерыв", tone: "peach" },
  working: { label: "Рабочее окно", tone: "lime" },
} as const;

export function localDateTimeValue(value: string, timezone: string) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(new Date(value));
  const part = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((item) => item.type === type)?.value || "";
  return part("year") + "-" + part("month") + "-" + part("day") + "T" + part("hour") + ":" + part("minute");
}

export function formatExceptionRange(startsAt: string, endsAt: string, timezone: string) {
  const start = new Date(startsAt);
  const end = new Date(endsAt);
  const date = new Intl.DateTimeFormat("ru-RU", {
    timeZone: timezone,
    day: "numeric",
    month: "short",
    year: "numeric",
  }).format(start);
  const time = new Intl.DateTimeFormat("ru-RU", {
    timeZone: timezone,
    hour: "2-digit",
    minute: "2-digit",
  });
  return date + " · " + time.format(start) + "–" + time.format(end);
}
