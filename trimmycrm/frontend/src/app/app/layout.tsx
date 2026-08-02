import type { Metadata } from "next";

import { AppFrame } from "@/components/app/app-shell";
import { AppProvider } from "@/components/app/app-provider";

import "./app.css";

export const metadata: Metadata = {
  title: { default: "Кабинет", template: "%s · TrimmyCRM" },
  robots: { index: false, follow: false },
};

export default function OwnerAppLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <AppProvider>
      <AppFrame>{children}</AppFrame>
    </AppProvider>
  );
}
