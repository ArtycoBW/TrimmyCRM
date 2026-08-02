import type { Metadata } from "next";

import { Dashboard } from "@/components/app/dashboard";

export const metadata: Metadata = { title: "Обзор" };

export default function OwnerAppPage() {
  return <Dashboard />;
}
