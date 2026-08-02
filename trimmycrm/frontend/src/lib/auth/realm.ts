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

export function platformHosts() {
  const configured = process.env.NEXT_PUBLIC_PLATFORM_HOSTS;
  if (!configured) return defaultPlatformHosts;
  return new Set(
    configured
      .split(",")
      .map((host) => host.trim().toLowerCase())
      .filter(Boolean),
  );
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
