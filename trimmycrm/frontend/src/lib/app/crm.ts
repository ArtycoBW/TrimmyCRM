import { z } from "zod";

export const clientStatuses: Record<string, { label: string; tone: string }> = {
  crm_only: { label: "Только CRM", tone: "peach" },
  pending: { label: "Ждёт email", tone: "magenta" },
  active: { label: "Активен", tone: "lime" },
  blocked: { label: "Заблокирован", tone: "muted" },
  anonymized: { label: "Анонимизирован", tone: "muted" },
};

const optionalEmail = z
  .string()
  .trim()
  .max(320, "Email слишком длинный")
  .refine((value) => !value || z.email().safeParse(value).success, "Проверьте формат email");

const optionalPhone = z
  .string()
  .trim()
  .max(32, "Телефон слишком длинный")
  .refine((value) => !value || value.length >= 7, "Минимум 7 символов");

export const clientFormSchema = z.object({
  fullName: z.string().trim().min(2, "Введите имя клиента").max(160, "Не более 160 символов"),
  email: optionalEmail,
  phone: optionalPhone,
  consent: z.boolean(),
  status: z.enum(["crm_only", "pending", "active", "blocked"]),
});

export type ClientFormValues = z.infer<typeof clientFormSchema>;

export function personInitials(value: string | null | undefined) {
  if (!value?.trim()) return "К";
  return value
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join("");
}

export function formatShortDate(value: string | null | undefined) {
  if (!value) return "—";
  return new Intl.DateTimeFormat("ru-RU", {
    day: "numeric",
    month: "short",
    year: "numeric",
  }).format(new Date(value));
}
