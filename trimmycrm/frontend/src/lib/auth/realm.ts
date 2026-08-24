import type { AuthRealm } from "@/lib/api/types";

const defaultPlatformHosts = new Set([
  "localhost",
  "127.0.0.1",
  "trimmycrm.localhost",
  "www.trimmycrm.localhost",
  "admin.trimmycrm.localhost",
  "trimmycrm.ru",
  "www.trimmycrm.ru",
  "admin.trimmycrm.ru",
  "trimmycrm.ru",
  "www.trimmycrm.ru",
  "admin.trimmycrm.ru",
]);

function normalizeHosts(values: unknown[]): Set<string> {
  return new Set(
    values
      .filter((host): host is string => typeof host === "string")
      .map((host) => host.trim().toLowerCase().replace(/\.$/, ""))
      .filter(Boolean),
  );
}

export function platformHosts() {
  const configured = process.env.NEXT_PUBLIC_PLATFORM_HOSTS?.trim();
  if (!configured) return defaultPlatformHosts;

  try {
    const parsed = JSON.parse(configured);
    if (Array.isArray(parsed)) return normalizeHosts(parsed);
  } catch {
    // Local .env files also support a comma-separated host list.
  }

  return normalizeHosts(configured.split(","));
}

export function realmForHostname(hostname: string): AuthRealm {
  return platformHosts().has(hostname.trim().toLowerCase().replace(/\.$/, ""))
    ? "platform"
    : "tenant";
}

export function currentAuthRealm(): AuthRealm {
  if (typeof window === "undefined") return "platform";
  return realmForHostname(window.location.hostname);
}

export function authPrefix(realm: AuthRealm) {
  return realm === "tenant" ? "/t/auth" : "/auth";
}

export function safeNextPath(value: string | null | undefined, fallback: string) {
  if (!value || !value.startsWith("/") || value.startsWith("//") || value.includes("\\")) {
    return fallback;
  }
  return value;
}
