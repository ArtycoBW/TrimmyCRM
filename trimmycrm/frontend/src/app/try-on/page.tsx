import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { LocalTryOn } from "@/features/local-tryon/local-tryon";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Локальная примерка причёски",
  description: "Примерная 2D-визуализация причёски прямо в браузере без отправки фото на сервер.",
  robots: { index: false, follow: false, noarchive: true, noimageindex: true },
};

export default function TryOnPage() {
  if (process.env.LOCAL_TRYON_ENABLED !== "true") notFound();
  return <LocalTryOn />;
}
