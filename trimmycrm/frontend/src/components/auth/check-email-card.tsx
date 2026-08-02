"use client";

import { useState } from "react";

import { authErrorMessage } from "@/components/auth/auth-utils";
import { authRequest } from "@/lib/api/client";
import type { AuthRealm } from "@/lib/api/types";

type CheckEmailCardProps = {
  email: string;
  realm: AuthRealm;
  title?: string;
  text?: string;
};

export function CheckEmailCard({
  email,
  realm,
  title = "Проверьте почту",
  text = "Отправили ссылку для подтверждения. Она активирует аккаунт и откроет доступ к кабинету.",
}: CheckEmailCardProps) {
  const [status, setStatus] = useState<"idle" | "sending" | "sent" | "error">("idle");
  const [error, setError] = useState<string | null>(null);

  async function resend() {
    setStatus("sending");
    setError(null);
    try {
      await authRequest(realm, "resend-verification", {
        method: "POST",
        body: JSON.stringify({ email }),
      });
      setStatus("sent");
    } catch (reason) {
      setError(authErrorMessage(reason));
      setStatus("error");
    }
  }

  return (
    <div className="auth-success" role="status">
      <span className="auth-success__icon" aria-hidden="true">✉</span>
      <p className="auth-kicker">Письмо отправлено</p>
      <h2>{title}</h2>
      <p>{text}</p>
      <strong className="auth-success__email">{email}</strong>
      <p className="auth-success__hint">Если письма нет, проверьте папку «Спам» или отправьте его повторно.</p>
      {error && <p className="auth-alert auth-alert--error">{error}</p>}
      {status === "sent" && <p className="auth-alert auth-alert--success">Новое письмо отправлено.</p>}
      <button className="button button--outline auth-submit" type="button" onClick={resend} disabled={status === "sending"}>
        {status === "sending" ? "Отправляем…" : "Отправить ещё раз"}
      </button>
      <a className="auth-back-link" href="/login">← Вернуться ко входу</a>
    </div>
  );
}
