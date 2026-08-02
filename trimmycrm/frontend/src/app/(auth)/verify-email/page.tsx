import type { Metadata } from "next";

import { AuthShell } from "@/components/auth/auth-shell";
import { VerifyEmailCard } from "@/components/auth/verify-email-card";

export const metadata: Metadata = { title: "Подтверждение email" };

export default async function VerifyEmailPage({
  searchParams,
}: {
  searchParams: Promise<{ token?: string }>;
}) {
  const { token = "" } = await searchParams;
  return (
    <AuthShell
      eyebrow="Последний штрих"
      title={<>Подтвердим<br />ваш email<span>.</span></>}
      description="Так мы понимаем, что адрес действительно ваш, и защищаем кабинет от чужого доступа."
    >
      <VerifyEmailCard token={token} />
    </AuthShell>
  );
}
