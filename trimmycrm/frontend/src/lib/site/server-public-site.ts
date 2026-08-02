import type { PublicSiteSnapshot } from "@/lib/api/types";

export async function fetchTenantPublicSite(host: string): Promise<PublicSiteSnapshot | null> {
  const edgeToken = process.env.INTERNAL_EDGE_TOKEN;
  if (!host || !edgeToken) return null;

  const apiBase = (process.env.INTERNAL_API_BASE_URL || "http://api:8000/api/v1").replace(/\/$/, "");
  try {
    const response = await fetch(`${apiBase}/public/site`, {
      headers: {
        Accept: "application/json",
        "X-Forwarded-Host": host,
        "X-Internal-Edge-Token": edgeToken,
      },
      cache: "no-store",
    });
    if (!response.ok) return null;
    return await response.json() as PublicSiteSnapshot;
  } catch {
    return null;
  }
}
