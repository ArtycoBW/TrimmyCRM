import type { Metadata, Viewport } from "next";
import { headers } from "next/headers";

import { PwaRegister } from "@/components/pwa-register";
import { realmForHostname } from "@/lib/auth/realm";
import { fetchTenantPublicSite } from "@/lib/site/server-public-site";

import "./theme.css";
import "./globals.css";

const platformMetadata: Metadata = {
  metadataBase: new URL(process.env.NEXT_PUBLIC_SITE_URL || "https://trimmycrm.ru"),
  title: {
    default: "TrimmyCRM — сайт, онлайн-запись и CRM для парикмахерской",
    template: "%s · TrimmyCRM",
  },
  description:
    "Соберите сайт парикмахерской или барбершопа, откройте онлайн-запись и ведите клиентов и расписание в одной CRM.",
  applicationName: "TrimmyCRM",
  category: "business",
  keywords: ["CRM для парикмахерской", "CRM для барбершопа", "онлайн-запись", "сайт салона", "управление салоном"],
  authors: [{ name: "TrimmyCRM" }],
  creator: "TrimmyCRM",
  publisher: "TrimmyCRM",
  formatDetection: { telephone: false, address: false, email: false },
  manifest: "/manifest.webmanifest",
  icons: {
    icon: [
      { url: "/brand/trimmy-mark-64.png", sizes: "64x64", type: "image/png" },
      { url: "/brand/trimmy-mark-192.png", sizes: "192x192", type: "image/png" },
      { url: "/brand/trimmy-mark-512.png", sizes: "512x512", type: "image/png" },
    ],
    shortcut: ["/brand/trimmy-mark-64.png"],
    apple: [{ url: "/brand/trimmy-mark-180.png", sizes: "180x180", type: "image/png" }],
  },
  openGraph: {
    title: "TrimmyCRM — меньше рутины, больше точных записей",
    description: "Сайт, онлайн-запись и CRM для парикмахерской или барбершопа в одном сервисе.",
    type: "website",
    locale: "ru_RU",
    siteName: "TrimmyCRM",
  },
  robots: { index: true, follow: true, googleBot: { index: true, follow: true, "max-image-preview": "large", "max-snippet": -1, "max-video-preview": -1 } },
};

function requestHost(value: string | null) {
  return (value || "").split(",", 1)[0].trim().toLowerCase();
}

function requestHostname(host: string) {
  return host.replace(/\.$/, "").replace(/:\d+$/, "");
}

export async function generateMetadata(): Promise<Metadata> {
  const requestHeaders = await headers();
  const host = requestHost(requestHeaders.get("x-forwarded-host") || requestHeaders.get("host"));
  if (realmForHostname(requestHostname(host)) !== "tenant") return platformMetadata;

  const site = await fetchTenantPublicSite(host);
  const name = site?.name || "Кабинет клиента";
  const logo = site?.logoUrl || undefined;
  return {
    title: { default: name, template: "%s" },
    description: site?.description || "Онлайн-запись в салон.",
    applicationName: name,
    icons: logo
      ? { icon: [{ url: logo }], apple: [{ url: logo }] }
      : { icon: [{ url: "/site-icon", type: "image/svg+xml" }] },
    openGraph: {
      title: name,
      description: site?.description || "Онлайн-запись в салон.",
      type: "website",
      locale: "ru_RU",
      siteName: name,
      images: logo ? [{ url: logo }] : undefined,
    },
  };
}

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: "#d15022",
  colorScheme: "light",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="ru" data-scroll-behavior="smooth">
      <body>
        <PwaRegister />
        {children}
      </body>
    </html>
  );
}
