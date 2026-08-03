import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { LocalTryOn } from "@/features/local-tryon/local-tryon";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Примерка причёски",
  description: "Подберите форму причёски и подготовьте образ для консультации с мастером.",
  robots: { index: false, follow: false, noarchive: true, noimageindex: true },
};

export default function TryOnPage() {
  if (process.env.LOCAL_TRYON_ENABLED !== "true") notFound();
  return <LocalTryOn />;
}
