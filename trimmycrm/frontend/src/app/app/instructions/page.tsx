import type { Metadata } from "next";

import { DashboardInstructions } from "@/components/app/dashboard-instructions";

export const metadata: Metadata = { title: "Инструкция" };

export default function InstructionsPage() {
  return <DashboardInstructions />;
}
