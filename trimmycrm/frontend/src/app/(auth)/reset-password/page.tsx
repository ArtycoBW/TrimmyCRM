import type { Metadata } from "next";

import { AuthShell } from "@/components/auth/auth-shell";
import { ResetPasswordForm } from "@/components/auth/reset-password-form";

export const metadata: Metadata = { title: "Новый пароль" };

export default async function ResetPasswordPage({
  searchParams,
}: {
  searchParams: Promise<{ token?: string }>;
}) {
  const { token = "" } = await searchParams;
  return (
    <AuthShell
      eyebrow="Почти вернулись"
      title={<>Новый ключ<br />от кабинета<span>.</span></>}
      description="Надёжный пароль защищает расписание, клиентов и данные питомцев."
    >
      <ResetPasswordForm token={token} />
    </AuthShell>
  );
}
