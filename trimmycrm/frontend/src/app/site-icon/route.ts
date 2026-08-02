import { headers } from "next/headers";

import { fetchTenantPublicSite } from "@/lib/site/server-public-site";

function requestHost(value: string | null) {
  return (value || "").split(",", 1)[0].trim().toLowerCase();
}

function escapeXml(value: string) {
  return value.replace(/[&<>"']/g, (character) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&apos;",
  })[character] || character);
}

/** A neutral, salon-specific PWA/fav icon until the owner uploads a logo. */
export async function GET() {
  const requestHeaders = await headers();
  const site = await fetchTenantPublicSite(
    requestHost(requestHeaders.get("x-forwarded-host") || requestHeaders.get("host")),
  );
  const name = site?.name?.trim() || "Салон";
  const initial = Array.from(name)[0]?.toLocaleUpperCase("ru-RU") || "С";
  const label = escapeXml(initial);
  const title = escapeXml(name);

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" role="img" aria-labelledby="title"><title id="title">${title}</title><rect width="512" height="512" rx="112" fill="#dfff4f"/><rect x="28" y="28" width="456" height="456" rx="92" fill="#fffdf7" stroke="#111" stroke-width="16"/><text x="256" y="330" text-anchor="middle" font-family="Arial, sans-serif" font-size="250" font-weight="700" fill="#111">${label}</text></svg>`;

  return new Response(svg, {
    headers: {
      "Content-Type": "image/svg+xml; charset=utf-8",
      "Cache-Control": "public, max-age=300",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
