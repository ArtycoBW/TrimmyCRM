import type { Metadata } from "next";
import { Suspense } from "react";

import { AuthShell } from "@/components/auth/auth-shell";
import { AnonymousOnly } from "@/components/auth/anonymous-only";
import { LoginForm } from "@/components/auth/login-form";

export const metadata: Metadata = { title: "Вход" };

export default function LoginPage() {
  return (
    <AuthShell
      eyebrow="Порядок начинается здесь"
      title={<>Больше времени<br />на клиентов<span>.</span></>}
      description="Вернитесь к расписанию, клиентам и сайту — всё осталось на своих местах."
    >
      <Suspense fallback={<div className="auth-form-skeleton" aria-label="Загрузка формы" />}>
        <AnonymousOnly><LoginForm /></AnonymousOnly>
      </Suspense>
    </AuthShell>
  );
}
