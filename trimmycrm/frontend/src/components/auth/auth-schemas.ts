import { z } from "zod";

import { salonTypes } from "@/lib/app/salon-profile";

export const emailSchema = z
  .string()
  .trim()
  .min(1, "Введите email")
  .email("Проверьте формат email")
  .max(320, "Email слишком длинный");

export const passwordSchema = z
  .string()
  .min(10, "Минимум 10 символов")
  .max(128, "Не более 128 символов")
  .superRefine((value, context) => {
    const requirements = [
      [/\p{Ll}/u, "Добавьте строчную букву"],
      [/\p{Lu}/u, "Добавьте заглавную букву"],
      [/\d/u, "Добавьте цифру"],
      [/[^\p{L}\p{N}\s]/u, "Добавьте специальный символ"],
    ] as const;
    requirements.forEach(([pattern, message]) => {
      if (!pattern.test(value)) context.addIssue({ code: "custom", message });
    });
    if (value !== value.trim()) {
      context.addIssue({ code: "custom", message: "Уберите пробелы в начале и конце" });
    }
  });

export const loginSchema = z.object({
  email: emailSchema,
  password: z.string().min(1, "Введите пароль").max(128, "Пароль слишком длинный"),
});

export const phoneSchema = z
  .string()
  .trim()
  .min(7, "Укажите номер телефона")
  .max(32, "Номер телефона слишком длинный")
  .refine((value) => value.replace(/\D/g, "").length >= 10, "Проверьте номер телефона");

export const registerSchema = z
  .object({
    email: emailSchema,
    phone: phoneSchema,
    password: passwordSchema,
    passwordConfirm: z.string().min(1, "Повторите пароль"),
    termsAccepted: z.boolean().refine(Boolean, "Нужно принять условия сервиса"),
    consent: z.boolean().refine(Boolean, "Нужно согласие на обработку данных"),
    dataProcessingInstructionAccepted: z.boolean().optional(),
    salonName: z.string().trim().min(2, "Введите название салона").max(160, "Не более 160 символов").optional(),
    salonType: z.enum(salonTypes).optional(),
    city: z.string().trim().max(160, "Не более 160 символов").optional(),
    timezone: z.string().min(1, "Выберите часовой пояс").max(64).optional(),
  })
  .refine((value) => value.password === value.passwordConfirm, {
    path: ["passwordConfirm"],
    message: "Пароли не совпадают",
  });

export const platformRegisterSchema = registerSchema.superRefine((value, context) => {
  if (!value.dataProcessingInstructionAccepted) {
    context.addIssue({
      code: "custom",
      path: ["dataProcessingInstructionAccepted"],
      message: "Нужно принять поручение на обработку клиентской базы",
    });
  }
  if (!value.salonName) {
    context.addIssue({
      code: "custom",
      path: ["salonName"],
      message: "Введите название салона",
    });
  }
  if (!value.salonType) {
    context.addIssue({
      code: "custom",
      path: ["salonType"],
      message: "Выберите тип салона",
    });
  }
});

export const forgotPasswordSchema = z.object({ email: emailSchema });

export const resetPasswordSchema = z
  .object({
    password: passwordSchema,
    passwordConfirm: z.string().min(1, "Повторите пароль"),
  })
  .refine((value) => value.password === value.passwordConfirm, {
    path: ["passwordConfirm"],
    message: "Пароли не совпадают",
  });

export type LoginValues = z.infer<typeof loginSchema>;
export type RegisterValues = z.infer<typeof registerSchema>;
export type ForgotPasswordValues = z.infer<typeof forgotPasswordSchema>;
export type ResetPasswordValues = z.infer<typeof resetPasswordSchema>;
