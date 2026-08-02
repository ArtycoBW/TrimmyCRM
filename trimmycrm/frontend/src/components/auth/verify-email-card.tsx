"use client";

import { useEffect, useState } from "react";

import { authErrorMessage } from "@/components/auth/auth-utils";
import { authRequest } from "@/lib/api/client";
import { currentAuthRealm } from "@/lib/auth/realm";
import type { AuthRealm } from "@/lib/api/types";

type VerifyState = "loading" | "success" | "error";
const verificationRequests = new Map<string, Promise<void>>();

function verifyOnce(realm: AuthRealm, token: string) {
  const key = `${realm}:${token}`;
  let request = verificationRequests.get(key);
  if (!request) {
    request = authRequest(realm, "verify-email", {
      method: "POST",
      body: JSON.stringify({ token }),
    }).then(() => undefined);
    verificationRequests.set(key, request);
  }
  return request;
}

export function VerifyEmailCard({ token }: { token: string }) {
  const [state, setState] = useState<VerifyState>(token ? "loading" : "error");
  const [message, setMessage] = useState(token ? "Подтверждаем адрес…" : "В ссылке нет токена подтверждения");

  useEffect(() => {
    if (!token) return;
    const realm = currentAuthRealm();
    let active = true;
    verifyOnce(realm, token)
      .then(() => {
        if (!active) return;
        setState("success");
        setMessage("Email подтверждён. Аккаунт активирован.");
        window.history.replaceState({}, "", "/verify-email?status=success");
      })
      .catch((reason) => {
        if (!active) return;
        setState("error");
        setMessage(authErrorMessage(reason));
      });
    return () => {
      active = false;
    };
  }, [token]);

  return (
    <div className={`auth-success${state === "error" ? " auth-success--error" : ""}`} aria-live="polite">
      <span className={`auth-success__icon${state === "loading" ? " is-loading" : ""}`} aria-hidden="true">
        {state === "loading" ? "↻" : state === "success" ? "✓" : "!"}
      </span>
      <p className="auth-kicker">Подтверждение email</p>
      <h2>{state === "loading" ? "Одну секунду" : state === "success" ? "Всё готово" : "Ссылка не сработала"}</h2>
      <p>{message}</p>
      {state === "success" ? (
        <a className="button button--ink auth-submit" href="/login">Войти в кабинет →</a>
      ) : state === "error" ? (
        <a className="button button--outline auth-submit" href="/login">Вернуться ко входу</a>
      ) : null}
    </div>
  );
}
