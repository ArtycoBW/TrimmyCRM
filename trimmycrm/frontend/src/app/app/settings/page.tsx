import type { Metadata } from "next";

import { SettingsWorkspace } from "@/components/app/settings-workspace";

export const metadata: Metadata = { title: "Настройки" };

export default function SettingsPage() { return <SettingsWorkspace />; }
