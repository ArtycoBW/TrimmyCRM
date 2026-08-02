import type { Metadata } from "next";

import { ScheduleWorkspace } from "@/components/app/schedule-workspace";

export const metadata: Metadata = { title: "Записи" };

export default function AppointmentsPage() {
  return <ScheduleWorkspace mode="list" />;
}
