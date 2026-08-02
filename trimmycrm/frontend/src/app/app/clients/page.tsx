import type { Metadata } from "next";

import { ClientsWorkspace } from "@/components/app/clients-workspace";

export const metadata: Metadata = { title: "Клиенты" };

export default function ClientsPage() {
  return <ClientsWorkspace />;
}
