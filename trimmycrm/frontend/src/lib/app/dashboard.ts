import type { AppointmentView, SiteView } from "@/lib/api/types";

export const appointmentStatuses: Record<
  AppointmentView["status"],
  { label: string; tone: "lime" | "lavender" | "peach" | "muted" | "magenta" }
> = {
  new: { label: "Новая", tone: "magenta" },
  confirmed: { label: "Подтверждена", tone: "lime" },
  completed: { label: "Завершена", tone: "lavender" },
  cancelled: { label: "Отменена", tone: "muted" },
  no_show: { label: "Не пришли", tone: "peach" },
};

export function salonDayKey(value: string | Date, timezone: string) {
  const parts = new Intl.DateTimeFormat("en", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    timeZone: timezone,
  }).formatToParts(typeof value === "string" ? new Date(value) : value);
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return values.year + "-" + values.month + "-" + values.day;
}

export function formatSalonTime(value: string, timezone: string) {
  return new Intl.DateTimeFormat("ru-RU", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    timeZone: timezone,
  }).format(new Date(value));
}

export function formatSalonTimezone(timezone: string) {
  const labels: Record<string, string> = {
    "Europe/Moscow": "Москва (UTC+3)",
    "Europe/Kaliningrad": "Калининград (UTC+2)",
    "Asia/Yekaterinburg": "Екатеринбург (UTC+5)",
    "Asia/Novosibirsk": "Новосибирск (UTC+7)",
    "Asia/Vladivostok": "Владивосток (UTC+10)",
  };
  return labels[timezone] || timezone.replace("_", " ");
}

export function formatMoney(value: string | number) {
  const amount = typeof value === "string" ? Number.parseFloat(value) : value;
  return new Intl.NumberFormat("ru-RU", {
    maximumFractionDigits: 0,
  }).format(Number.isFinite(amount) ? amount : 0) + " ₽";
}

export function launchChecklist(site: SiteView, services: number, staff: number) {
  return [
    { id: "salon", label: "Создать карточку салона", complete: Boolean(site.name && site.slug) },
    { id: "services", label: "Добавить первую услугу", complete: services > 0 },
    { id: "staff", label: "Добавить мастера", complete: staff > 0 },
    { id: "schedule", label: "Настроить график работы", complete: Object.keys(site.workHours).length > 0 },
    { id: "publish", label: "Опубликовать сайт", complete: site.publishedVersion !== null },
  ];
}
