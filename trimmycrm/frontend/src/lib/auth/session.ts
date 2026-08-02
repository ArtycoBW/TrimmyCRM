import type { AuthRealm } from "@/lib/api/types";

const accessTokens: Record<AuthRealm, string | null> = {
  platform: null,
  tenant: null,
};

const listeners = new Set<() => void>();

export function getAccessToken(realm: AuthRealm) {
  return accessTokens[realm];
}

export function setAccessToken(realm: AuthRealm, token: string | null) {
  if (accessTokens[realm] === token) return;
  accessTokens[realm] = token;
  listeners.forEach((listener) => listener());
}

export function subscribeToSession(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
