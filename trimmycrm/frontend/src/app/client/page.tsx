import type { Metadata } from "next";
import { Suspense } from "react";

import { ClientPortal } from "@/components/client/client-portal";

export const metadata: Metadata = { title: "Кабинет клиента" };

export default function ClientAppPage() {
  return (
    <Suspense fallback={<main className="salon-site-state">Загружаем кабинет…</main>}>
      <ClientPortal />
    </Suspense>
  );
}
