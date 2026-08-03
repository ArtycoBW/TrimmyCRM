"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import type { Route } from "next";
import { useRouter, useSearchParams } from "next/navigation";
import { useCallback, useState } from "react";
import { useForm } from "react-hook-form";

import { loginSchema, type LoginValues } from "@/components/auth/auth-schemas";
import { authErrorMessage } from "@/components/auth/auth-utils";
import { PasswordField } from "@/components/auth/password-field";
import { SmartCaptcha } from "@/components/auth/smart-captcha";
import { useAuthRealm } from "@/components/auth/use-auth-realm";
import { useHydrated } from "@/hooks/use-hydrated";
import { authRequest, ApiError } from "@/lib/api/client";
import { safeNextPath } from "@/lib/auth/realm";
import { setAccessToken } from "@/lib/auth/session";
import type { AuthResponse } from "@/lib/api/types";

export function LoginForm() {
  const realm = useAuthRealm();
  const hydrated = useHydrated();
  const router = useRouter();
  const searchParams = useSearchParams();
  const [formError, setFormError] = useState<string | null>(null);
  const [errorCode, setErrorCode] = useState<string | null>(null);
  const [captchaRequired, setCaptchaRequired] = useState(false);
  const [captchaToken, setCaptchaToken] = useState("");
  const [resendStatus, setResendStatus] = useState<"idle" | "sending" | "sent">("idle");
  const {
    register,
    handleSubmit,
    getValues,
    formState: { errors, isSubmitting },
  } = useForm<LoginValues>({
    resolver: zodResolver(loginSchema),
    defaultValues: { email: "", password: "" },
  });

  const handleCaptcha = useCallback((token: string) => setCaptchaToken(token), []);

  async function onSubmit(values: LoginValues) {
    if (captchaRequired && !captchaToken) {
      setFormError("Подтвердите, что вы не робот");
      return;
    }
    setFormError(null);
    setErrorCode(null);
    try {
      const result = await authRequest<AuthResponse>(realm, "login", {
        method: "POST",
        body: JSON.stringify({
          email: values.email,
          password: values.password,
          captchaToken: captchaToken || null,
        }),
      });
      setAccessToken(realm, result.accessToken);
      const fallback = realm === "platform" ? "/app" : "/client";
      router.replace(safeNextPath(searchParams.get("next"), fallback) as Route);
    } catch (reason) {
      if (reason instanceof ApiError) {
        setErrorCode(reason.code);
        if (reason.code === "captcha_required") setCaptchaRequired(true);
      }
      setFormError(authErrorMessage(reason));
    }
  }

  async function resendVerification() {
    const email = getValues("email");
    if (!email) return;
    setResendStatus("sending");
    try {
      await authRequest(realm, "resend-verification", {
        method: "POST",
        body: JSON.stringify({ email }),
      });
      setResendStatus("sent");
    } catch (reason) {
      setFormError(authErrorMessage(reason));
      setResendStatus("idle");
    }
  }

  return (
    <div className="auth-form-card">
      <div className="auth-form-heading">
        <p className="auth-kicker">С возвращением</p>
        <h2>{realm === "platform" ? "Войти в TrimmyCRM" : "Войти в кабинет клиента"}</h2>
        <p>{realm === "platform" ? "Расписание, клиенты и сайт уже ждут." : "Ваши записи и история визитов в одном месте."}</p>
      </div>

      <form onSubmit={handleSubmit(onSubmit)} noValidate>
        <fieldset className="auth-fieldset" disabled={!hydrated || isSubmitting}>
        <div className="auth-field">
          <label htmlFor="login-email">Email</label>
          <div className={`auth-input-wrap${errors.email ? " auth-input-wrap--error" : ""}`}>
            <input
              id="login-email"
              type="email"
              inputMode="email"
              autoComplete="email"
              placeholder="name@example.ru"
              aria-invalid={Boolean(errors.email)}
              aria-describedby={errors.email ? "login-email-error" : undefined}
              {...register("email")}
            />
          </div>
          {errors.email && <p className="auth-field__error" id="login-email-error">{errors.email.message}</p>}
        </div>

        <PasswordField
          id="login-password"
          label="Пароль"
          autoComplete="current-password"
          registration={register("password")}
          error={errors.password?.message}
        />

        <div className="auth-form-row">
          <span />
          <a href="/forgot-password">Забыли пароль?</a>
        </div>

        <SmartCaptcha visible={captchaRequired} onToken={handleCaptcha} />

        {formError && (
          <div className="auth-alert auth-alert--error" role="alert">
            <span>{formError}</span>
            {errorCode === "email_not_verified" && (
              <button type="button" onClick={resendVerification} disabled={resendStatus === "sending"}>
                {resendStatus === "sent" ? "Письмо отправлено" : "Отправить письмо снова"}
              </button>
            )}
          </div>
        )}

        <button className="button button--ink auth-submit" type="submit" disabled={!hydrated || isSubmitting}>
          {isSubmitting ? "Входим…" : "Войти →"}
        </button>
        </fieldset>
      </form>

      <p className="auth-switch">Ещё нет аккаунта? <a href="/register">Попробовать бесплатно</a></p>
    </div>
  );
}
