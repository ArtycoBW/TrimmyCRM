"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useState } from "react";
import { useForm, useWatch } from "react-hook-form";

import {
  resetPasswordSchema,
  type ResetPasswordValues,
} from "@/components/auth/auth-schemas";
import { authErrorMessage, passwordChecks } from "@/components/auth/auth-utils";
import { PasswordField } from "@/components/auth/password-field";
import { useAuthRealm } from "@/components/auth/use-auth-realm";
import { useHydrated } from "@/hooks/use-hydrated";
import { authRequest } from "@/lib/api/client";

export function ResetPasswordForm({ token }: { token: string }) {
  const realm = useAuthRealm();
  const hydrated = useHydrated();
  const [completed, setCompleted] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const {
    register,
    handleSubmit,
    control,
    formState: { errors, isSubmitting },
  } = useForm<ResetPasswordValues>({
    resolver: zodResolver(resetPasswordSchema),
    defaultValues: { password: "", passwordConfirm: "" },
  });
  const password = useWatch({ control, name: "password" });

  async function onSubmit(values: ResetPasswordValues) {
    setFormError(null);
    try {
      await authRequest(realm, "reset-password", {
        method: "POST",
        body: JSON.stringify({ token, ...values }),
      });
      setCompleted(true);
      window.history.replaceState({}, "", "/reset-password?status=complete");
    } catch (reason) {
      setFormError(authErrorMessage(reason));
    }
  }

  if (!token) {
    return (
      <div className="auth-success auth-success--error">
        <span className="auth-success__icon" aria-hidden="true">!</span>
        <p className="auth-kicker">Ссылка неполная</p>
        <h2>Нет токена сброса</h2>
        <p>Запросите новое письмо. Старые или уже использованные ссылки не работают.</p>
        <a className="button button--ink auth-submit" href="/forgot-password">Запросить новую ссылку</a>
      </div>
    );
  }

  if (completed) {
    return (
      <div className="auth-success">
        <span className="auth-success__icon" aria-hidden="true">✓</span>
        <p className="auth-kicker">Готово</p>
        <h2>Пароль изменён</h2>
        <p>Все прежние сессии завершены. Теперь можно войти с новым паролем.</p>
        <a className="button button--ink auth-submit" href="/login">Войти →</a>
      </div>
    );
  }

  return (
    <div className="auth-form-card">
      <div className="auth-form-heading">
        <p className="auth-kicker">Новый пароль</p>
        <h2>Вернём доступ</h2>
        <p>Придумайте новый пароль. После сохранения старые сессии будут закрыты.</p>
      </div>
      <form onSubmit={handleSubmit(onSubmit)} noValidate>
        <fieldset className="auth-fieldset" disabled={!hydrated || isSubmitting}>
        <PasswordField
          id="reset-password"
          label="Новый пароль"
          autoComplete="new-password"
          registration={register("password")}
          error={errors.password?.message}
          hint={
            <ul className="password-checks" aria-label="Требования к паролю">
              {passwordChecks(password || "").map((check) => (
                <li className={check.met ? "is-met" : ""} key={check.label}>
                  <span aria-hidden="true">{check.met ? "✓" : "·"}</span>{check.label}
                </li>
              ))}
            </ul>
          }
        />
        <PasswordField
          id="reset-password-confirm"
          label="Повторите пароль"
          autoComplete="new-password"
          registration={register("passwordConfirm")}
          error={errors.passwordConfirm?.message}
        />
        {formError && <p className="auth-alert auth-alert--error" role="alert">{formError}</p>}
        <button className="button button--ink auth-submit" type="submit" disabled={!hydrated || isSubmitting}>
          {isSubmitting ? "Сохраняем…" : "Сохранить пароль →"}
        </button>
        </fieldset>
      </form>
    </div>
  );
}
