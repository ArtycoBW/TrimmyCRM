"use client";

import type { Route } from "next";
import { useRouter } from "next/navigation";
import { useEffect, useState, type ReactNode } from "react";

import { useAuthRealm } from "@/components/auth/use-auth-realm";
import { apiRequest } from "@/lib/api/client";
import type { MeResponse, UserView } from "@/lib/api/types";

export function AnonymousOnly({ children }: { children: ReactNode }) {
  const realm = useAuthRealm();
  const router = useRouter();
  const [checking, setChecking] = useState(true);

  useEffect(() => {
    let active = true;
    const path = realm === "platform" ? "/auth/me" : "/t/auth/me";
    apiRequest<MeResponse | UserView>(path, { realm })
      .then(() => {
        if (!active) return;
        router.replace((realm === "platform" ? "/app" : "/client") as Route);
      })
      .catch(() => { if (active) setChecking(false); });
    return () => { active = false; };
  }, [realm, router]);

  if (checking) return <div className="auth-form-skeleton" aria-label="Проверяем авторизацию" />;
  return children;
}
