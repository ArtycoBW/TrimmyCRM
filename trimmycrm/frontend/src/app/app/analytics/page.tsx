import type { Metadata } from "next";

import { AnalyticsWorkspace } from "@/components/app/analytics-workspace";

export const metadata: Metadata = { title: "Аналитика" };

export default function AnalyticsPage() { return <AnalyticsWorkspace />; }
