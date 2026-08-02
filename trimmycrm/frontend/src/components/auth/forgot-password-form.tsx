"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useState } from "react";
import { useForm } from "react-hook-form";

import {
  forgotPasswordSchema,
  type ForgotPasswordValues,
} from "@/components/auth/auth-schemas";
import { authErrorMessage } from "@/components/auth/auth-utils";
import { useAuthRealm } from "@/components/auth/use-auth-realm";
import { useHydrated } from "@/hooks/use-hydrated";
import { authRequest } from "@/lib/api/client";

export function ForgotPasswordForm() {
  const realm = useAuthRealm();
  const hydrated = useHydrated();
  const [sentTo, setSentTo] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<ForgotPasswordValues>({
    resolver: zodResolver(forgotPasswordSchema),
    defaultValues: { email: "" },
  });

  async function onSubmit(values: ForgotPasswordValues) {
    setFormError(null);
    try {
      await authRequest(realm, "forgot-password", {
        method: "POST",
        body: JSON.stringify(values),
      });
      setSentTo(values.email);
    } catch (reason) {
      setFormError(authErrorMessage(reason));
    }
  }

  if (sentTo) {
    return (
      <div className="auth-success" role="status">
        <span className="auth-success__icon" aria-hidden="true">✉</span>
        <p className="auth-kicker">Запрос принят</p>
        <h2>Проверьте почту</h2>
        <p>Если аккаунт с таким email существует, мы отправили ссылку для создания нового пароля.</p>
        <strong className="auth-success__email">{sentTo}</strong>
        <p className="auth-success__hint">Ссылка действует ограниченное время и может быть использована только один раз.</p>
        <a className="button button--outline auth-submit" href="/login">Вернуться ко входу</a>
      </div>
    );
  }

  return (
    <div className="auth-form-card">
      <div className="auth-form-heading">
        <p className="auth-kicker">Восстановление доступа</p>
        <h2>Забыли пароль?</h2>
        <p>Введите email — пришлём одноразовую ссылку для создания нового пароля.</p>
      </div>
      <form onSubmit={handleSubmit(onSubmit)} noValidate>
        <fieldset className="auth-fieldset" disabled={!hydrated || isSubmitting}>
        <div className="auth-field">
          <label htmlFor="forgot-email">Email</label>
          <div className={`auth-input-wrap${errors.email ? " auth-input-wrap--error" : ""}`}>
            <input
              id="forgot-email"
              type="email"
              inputMode="email"
              autoComplete="email"
              placeholder="name@example.ru"
              aria-invalid={Boolean(errors.email)}
              aria-describedby={errors.email ? "forgot-email-error" : undefined}
              {...register("email")}
            />
          </div>
          {errors.email && <p className="auth-field__error" id="forgot-email-error">{errors.email.message}</p>}
        </div>
        {formError && <p className="auth-alert auth-alert--error" role="alert">{formError}</p>}
        <button className="button button--ink auth-submit" type="submit" disabled={!hydrated || isSubmitting}>
          {isSubmitting ? "Отправляем…" : "Получить ссылку →"}
        </button>
        </fieldset>
      </form>
      <a className="auth-back-link" href="/login">← Я вспомнил пароль</a>
    </div>
  );
}
