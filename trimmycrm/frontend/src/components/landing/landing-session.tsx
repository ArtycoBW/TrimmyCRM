"use client";

import Link from "next/link";
import { createContext, useContext, useEffect, useState, type ReactNode } from "react";

import { Icon } from "@/components/ui/icons";
import { apiRequest } from "@/lib/api/client";
import type { MeResponse } from "@/lib/api/types";

type SessionState = "checking" | "anonymous" | "authenticated";

const LandingSessionContext = createContext<SessionState>("checking");

export function LandingSessionProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<SessionState>("checking");

  useEffect(() => {
    let active = true;
    apiRequest<MeResponse>("/auth/me", { realm: "platform" })
      .then(() => { if (active) setState("authenticated"); })
      .catch(() => { if (active) setState("anonymous"); });
    return () => { active = false; };
  }, []);

  return <LandingSessionContext.Provider value={state}>{children}</LandingSessionContext.Provider>;
}

export function useLandingSession() {
  return useContext(LandingSessionContext);
}

export function LandingHeaderActions() {
  const state = useLandingSession();

  if (state === "checking") {
    return <span className="landing-auth-placeholder" aria-label="Проверяем авторизацию" />;
  }
  if (state === "authenticated") {
    return (
      <Link className="button button--lime button--small" href="/app">
        Личный кабинет <Icon name="arrow" />
      </Link>
    );
  }
  return (
    <>
      <Link className="button button--ghost button--small" href="/login">Войти</Link>
      <Link className="button button--lime button--small" href="/register">
        Попробовать <Icon name="arrow" />
      </Link>
    </>
  );
}

export function LandingPrimaryAction({
  className,
  anonymousLabel,
  authenticatedLabel = "Перейти в кабинет",
  anonymousHref = "/register",
}: {
  className: string;
  anonymousLabel: string;
  authenticatedLabel?: string;
  anonymousHref?: "/register" | "/register?intent=custom-landing";
}) {
  const state = useLandingSession();
  if (state === "checking") {
    return <span className={`${className} landing-cta-placeholder`} aria-hidden="true">{anonymousLabel} <Icon name="arrow" /></span>;
  }
  return (
    <Link className={className} href={state === "authenticated" ? "/app" : anonymousHref}>
      {state === "authenticated" ? authenticatedLabel : anonymousLabel} <Icon name="arrow" />
    </Link>
  );
}

export function LandingFooterAccountLink() {
  const state = useLandingSession();
  if (state === "checking") return <span className="landing-footer-placeholder" aria-hidden="true" />;
  return <Link href={state === "authenticated" ? "/app" : "/login"}>{state === "authenticated" ? "Личный кабинет" : "Войти"}</Link>;
}
