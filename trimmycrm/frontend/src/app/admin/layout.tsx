import type { Metadata } from "next";

import { AppFrame } from "@/components/app/app-shell";
import { AppProvider } from "@/components/app/app-provider";

import "../app/app.css";
import "./admin.css";

export const metadata: Metadata = {
  title: "Панель администратора",
  robots: { index: false, follow: false },
};

export default function AdminLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <AppProvider>
      <AppFrame>{children}</AppFrame>
    </AppProvider>
  );
}
