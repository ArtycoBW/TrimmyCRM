import type { Metadata } from "next";

import { AuthShell } from "@/components/auth/auth-shell";
import { ForgotPasswordForm } from "@/components/auth/forgot-password-form";

export const metadata: Metadata = { title: "Восстановление пароля" };

export default function ForgotPasswordPage() {
  return (
    <AuthShell
      eyebrow="Такое случается"
      title={<>Доступ можно<br />вернуть<span>.</span></>}
      description="Одно письмо — и вы снова в кабинете. Никаких звонков в поддержку и контрольных вопросов."
    >
      <ForgotPasswordForm />
    </AuthShell>
  );
}
