import { ApiError } from "@/lib/api/client";

export function authErrorMessage(error: unknown) {
  if (!(error instanceof ApiError)) return "Не удалось связаться с сервисом. Попробуйте ещё раз.";

  if (error.code === "weak_password" && error.details && typeof error.details === "object") {
    const violations = (error.details as { violations?: unknown }).violations;
    if (Array.isArray(violations) && violations.every((item) => typeof item === "string")) {
      return violations.join(". ");
    }
  }
  return error.message;
}

export function passwordChecks(value: string) {
  return [
    { label: "10+ символов", met: value.length >= 10 },
    { label: "строчная буква", met: /\p{Ll}/u.test(value) },
    { label: "заглавная буква", met: /\p{Lu}/u.test(value) },
    { label: "цифра", met: /\d/u.test(value) },
    { label: "спецсимвол", met: /[^\p{L}\p{N}\s]/u.test(value) },
  ];
}
