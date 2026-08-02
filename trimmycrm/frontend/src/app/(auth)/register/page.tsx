import type { Metadata } from "next";

import { AuthShell } from "@/components/auth/auth-shell";
import { AnonymousOnly } from "@/components/auth/anonymous-only";
import { RegisterForm } from "@/components/auth/register-form";

export const metadata: Metadata = { title: "Регистрация" };

export default function RegisterPage() {
  return (
    <AuthShell
      eyebrow="Первый шаг"
      title={<>Салон начинается<br />с порядка<span>.</span></>}
      description="Создайте аккаунт, соберите сайт и откройте запись. На знакомство — 14 бесплатных дней."
    >
      <AnonymousOnly><RegisterForm /></AnonymousOnly>
    </AuthShell>
  );
}
