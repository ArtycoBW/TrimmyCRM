"use client";

import type { Route } from "next";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

import { BrandMark } from "@/components/ui/brand-mark";
import { apiRequest, ApiError, logout } from "@/lib/api/client";
import type { AuthRealm, MeResponse, UserView } from "@/lib/api/types";

type AccountEntryProps = { realm: AuthRealm };

export function AccountEntry({ realm }: AccountEntryProps) {
  const router = useRouter();
  const [user, setUser] = useState<UserView | null>(null);
  const [subscription, setSubscription] = useState<MeResponse["subscription"]>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    const path = realm === "platform" ? "/auth/me" : "/t/auth/me";
    apiRequest<MeResponse | UserView>(path, { realm })
      .then((response) => {
        if (!active) return;
        if ("user" in response) {
          setUser(response.user);
          setSubscription(response.subscription);
        } else {
          setUser(response);
        }
      })
      .catch((reason) => {
        if (!active) return;
        if (reason instanceof ApiError && reason.status === 401) {
          const next = realm === "platform" ? "/app" : "/client";
          router.replace(`/login?next=${encodeURIComponent(next)}` as Route);
          return;
        }
        setError(reason instanceof Error ? reason.message : "Не удалось открыть кабинет");
      });
    return () => {
      active = false;
    };
  }, [realm, router]);

  async function signOut() {
    await logout(realm);
    router.replace("/login" as Route);
  }

  if (error) {
    return (
      <main className="account-entry account-entry--error">
        <div className="account-entry__card">
          <BrandMark />
          <h1>Кабинет временно недоступен</h1>
          <p>{error}</p>
          <button className="button button--ink" onClick={() => window.location.reload()}>Попробовать снова</button>
        </div>
      </main>
    );
  }

  if (!user) {
    return (
      <main className="account-entry" aria-busy="true">
        <div className="account-entry__loader"><span /><p>Открываем кабинет…</p></div>
      </main>
    );
  }

  return (
    <main className="account-entry">
      <header className="account-entry__header">
        <BrandMark compact />
        <button className="button button--ghost button--small" type="button" onClick={signOut}>Выйти</button>
      </header>
      <section className="account-entry__welcome">
        <p className="eyebrow">Авторизация пройдена</p>
        <h1>{realm === "platform" ? "Добро пожаловать в TrimmyCRM" : "Ваш салон здесь"}</h1>
        <p>{user.email}</p>
        {subscription && (
          <span className="account-entry__plan">Тариф: {subscription.plan.name} · {subscription.status}</span>
        )}
        <div className="account-entry__next">
          <span>Следующий раздел</span>
          <strong>{realm === "platform" ? "Настройка салона и CRM-панель" : "Онлайн-запись и история визитов"}</strong>
        </div>
      </section>
    </main>
  );
}
