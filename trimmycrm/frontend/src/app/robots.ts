import type { MetadataRoute } from "next";

export default function robots(): MetadataRoute.Robots {
  const baseUrl = process.env.NEXT_PUBLIC_SITE_URL || "https://trimmycrm.ru";
  return {
    rules: { userAgent: "*", allow: "/", disallow: ["/app/", "/api/", "/client/"] },
    sitemap: `${baseUrl}/sitemap.xml`,
    host: baseUrl,
  };
}
