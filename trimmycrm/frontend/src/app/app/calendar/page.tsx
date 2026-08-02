import type { Metadata } from "next";

import { ScheduleWorkspace } from "@/components/app/schedule-workspace";

export const metadata: Metadata = { title: "Календарь" };

export default function CalendarPage() {
  return <ScheduleWorkspace mode="calendar" />;
}
