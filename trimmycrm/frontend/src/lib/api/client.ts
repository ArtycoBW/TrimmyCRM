import { authPrefix } from "@/lib/auth/realm";
import { getAccessToken, setAccessToken } from "@/lib/auth/session";
import type { ApiErrorPayload, AuthRealm, AuthResponse } from "@/lib/api/types";

const browserApiBase = process.env.NEXT_PUBLIC_API_BASE_URL || "/api/v1";

type ApiRequestOptions = Omit<RequestInit, "headers"> & {
  headers?: HeadersInit;
  realm?: AuthRealm | false;
  retryAuth?: boolean;
};

const refreshRequests: Partial<Record<AuthRealm, Promise<string | null>>> = {};

export class ApiError extends Error {
  readonly status: number;
  readonly code: string | null;
  readonly details: unknown;
  readonly requestId: string | null;

  constructor(status: number, payload: ApiErrorPayload | null) {
    const rawMessage = payload?.message;
    const message =
      typeof rawMessage === "string"
        ? rawMessage
        : rawMessage?.map((item) => item.message).filter(Boolean).join(". ") ||
          "Не удалось выполнить запрос";
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.code = payload?.code || null;
    this.details = payload?.details;
    this.requestId = payload?.requestId || null;
  }
}

async function responsePayload(response: Response): Promise<unknown> {
  if (response.status === 204) return undefined;
  const contentType = response.headers.get("content-type") || "";
  if (contentType.includes("application/json")) {
    return response.json().catch(() => null);
  }
  return response.text().catch(() => "");
}

export async function refreshAccessToken(realm: AuthRealm): Promise<string | null> {
  if (refreshRequests[realm]) return refreshRequests[realm]!;

  const request = (async () => {
    try {
      const response = await fetch(`${browserApiBase}/frontend-auth/${realm}/refresh`, {
        method: "POST",
        credentials: "include",
        cache: "no-store",
        headers: { Accept: "application/json" },
      });
      if (!response.ok) {
        setAccessToken(realm, null);
        return null;
      }
      const payload = (await response.json()) as AuthResponse;
      if (!payload.accessToken) return null;
      setAccessToken(realm, payload.accessToken);
      return payload.accessToken;
    } catch {
      setAccessToken(realm, null);
      return null;
    }
  })();

  refreshRequests[realm] = request;
  try {
    return await request;
  } finally {
    delete refreshRequests[realm];
  }
}

export async function logout(realm: AuthRealm) {
  try {
    await fetch(`${browserApiBase}/frontend-auth/${realm}/logout`, {
      method: "POST",
      credentials: "include",
      cache: "no-store",
      headers: { Accept: "application/json" },
    });
  } finally {
    setAccessToken(realm, null);
  }
}

export async function apiRequest<T>(path: string, options: ApiRequestOptions = {}): Promise<T> {
  const { realm = false, retryAuth = true, ...requestOptions } = options;
  const headers = new Headers(options.headers);
  headers.set("Accept", "application/json");
  if (requestOptions.body && !(requestOptions.body instanceof FormData)) {
    headers.set("Content-Type", "application/json");
  }
  if (realm) {
    const token = getAccessToken(realm);
    if (token) headers.set("Authorization", `Bearer ${token}`);
  }

  const response = await fetch(`${browserApiBase}${path}`, {
    ...requestOptions,
    headers,
    credentials: "include",
    cache: requestOptions.cache || "no-store",
  });

  if (response.status === 401 && realm && retryAuth) {
    const token = await refreshAccessToken(realm);
    if (token) {
      return apiRequest<T>(path, { ...options, retryAuth: false });
    }
  }

  const payload = await responsePayload(response);
  if (!response.ok) {
    throw new ApiError(response.status, payload as ApiErrorPayload | null);
  }
  return payload as T;
}

function responseFilename(response: Response, fallback: string) {
  const disposition = response.headers.get("content-disposition") || "";
  const encoded = disposition.match(/filename\*=UTF-8''([^;]+)/i)?.[1];
  const plain = disposition.match(/filename="?([^";]+)"?/i)?.[1];
  if (encoded) {
    try {
      return decodeURIComponent(encoded);
    } catch {
      return fallback;
    }
  }
  return plain || fallback;
}

export async function downloadApiFile(
  path: string,
  fallbackFilename: string,
  realm: AuthRealm = "platform",
  retryAuth = true,
): Promise<void> {
  const headers = new Headers({ Accept: "*/*" });
  const token = getAccessToken(realm);
  if (token) headers.set("Authorization", `Bearer ${token}`);

  const response = await fetch(`${browserApiBase}${path}`, {
    headers,
    credentials: "include",
    cache: "no-store",
  });

  if (response.status === 401 && retryAuth) {
    const refreshed = await refreshAccessToken(realm);
    if (refreshed) return downloadApiFile(path, fallbackFilename, realm, false);
  }

  if (!response.ok) {
    const payload = await responsePayload(response);
    throw new ApiError(response.status, payload as ApiErrorPayload | null);
  }

  const objectUrl = URL.createObjectURL(await response.blob());
  const anchor = document.createElement("a");
  anchor.href = objectUrl;
  anchor.download = responseFilename(response, fallbackFilename);
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(objectUrl);
}

export async function authRequest<T>(
  realm: AuthRealm,
  action: string,
  options: Omit<ApiRequestOptions, "realm"> = {},
) {
  return apiRequest<T>(`${authPrefix(realm)}/${action}`, { ...options, realm: false });
}
