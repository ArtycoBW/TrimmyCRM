import type { Metadata } from "next";
import { headers } from "next/headers";

import { LandingPage } from "@/components/landing/landing-page";
import { PublicSalonSite } from "@/components/site/public-salon-site";
import { realmForHostname } from "@/lib/auth/realm";
import { fetchTenantPublicSite } from "@/lib/site/server-public-site";

function requestHost(value: string | null) {
  return (value || "").split(",", 1)[0].trim().toLowerCase();
}

function requestHostname(host: string) {
  return host.replace(/\.$/, "").replace(/:\d+$/, "");
}

export async function generateMetadata(): Promise<Metadata> {
  const requestHeaders = await headers();
  const host = requestHost(requestHeaders.get("x-forwarded-host") || requestHeaders.get("host"));
  if (realmForHostname(requestHostname(host)) === "tenant") {
    const site = await fetchTenantPublicSite(host);
    const name = site?.name || "Онлайн-запись в салон";
    const description = site?.description || "Выберите услугу, мастера и удобное время для записи в парикмахерскую или барбершоп онлайн.";
    return {
      title: { absolute: name },
      description,
      applicationName: name,
      openGraph: { title: name, description, siteName: name },
      robots: { index: true, follow: true },
    };
  }
  return {};
}

export default async function HomePage() {
  const requestHeaders = await headers();
  const host = requestHost(requestHeaders.get("x-forwarded-host") || requestHeaders.get("host"));
  if (realmForHostname(requestHostname(host)) === "tenant") {
    return <PublicSalonSite tryOnEnabled={process.env.LOCAL_TRYON_ENABLED === "true"} />;
  }
  const organization = {
    "@context": "https://schema.org",
    "@type": "SoftwareApplication",
    name: "TrimmyCRM",
    applicationCategory: "BusinessApplication",
    operatingSystem: "Web",
    inLanguage: "ru-RU",
    description: "Сайт, онлайн-запись и CRM для парикмахерской или барбершопа.",
    url: process.env.NEXT_PUBLIC_SITE_URL || "https://trimmycrm.ru",
  };
  return <><LandingPage /><script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(organization) }} /></>;
}
