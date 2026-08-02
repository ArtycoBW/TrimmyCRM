import type { MetadataRoute } from "next";
import { headers } from "next/headers";

import { realmForHostname } from "@/lib/auth/realm";
import { fetchTenantPublicSite } from "@/lib/site/server-public-site";

function requestHost(value: string | null) {
  return (value || "").split(",", 1)[0].trim().toLowerCase();
}

function requestHostname(host: string) {
  return host.replace(/\.$/, "").replace(/:\d+$/, "");
}

export default async function manifest(): Promise<MetadataRoute.Manifest> {
  let host = "";
  try {
    const requestHeaders = await headers();
    host = requestHost(requestHeaders.get("x-forwarded-host") || requestHeaders.get("host"));
  } catch {
    // Unit tests and build-time inspection have no request host and use the platform manifest.
  }
  const tenant = host && realmForHostname(requestHostname(host)) === "tenant"
    ? await fetchTenantPublicSite(host)
    : null;
  const name = tenant?.name || "TrimmyCRM — CRM для парикмахерской";
  const logo = tenant?.logoUrl;

  return {
    name,
    short_name: tenant?.name || "TrimmyCRM",
    description: tenant?.description || "Сайт, онлайн-запись и CRM для парикмахерской или барбершопа.",
    start_url: "/",
    display: "standalone",
    background_color: "#ffffff",
    theme_color: "#d15022",
    lang: "ru",
    categories: ["business", "productivity"],
    icons: logo
      ? [{ src: logo, sizes: "any", purpose: "any" }]
      : tenant
        ? [
          { src: "/site-icon", sizes: "any", type: "image/svg+xml", purpose: "any" },
          { src: "/site-icon", sizes: "any", type: "image/svg+xml", purpose: "maskable" },
        ]
      : [
        { src: "/brand/trimmy-mark-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
        { src: "/brand/trimmy-mark-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
        { src: "/brand/trimmy-mark-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
      ],
  };
}
