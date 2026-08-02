import { NextRequest, NextResponse } from "next/server";

import type { AuthRealm } from "@/lib/api/types";

export const dynamic = "force-dynamic";

const allowedRealms = new Set<AuthRealm>(["platform", "tenant"]);
const allowedActions = new Set(["refresh", "logout"]);

function publicOrigin(request: NextRequest) {
  const forwardedProto = request.headers.get("x-forwarded-proto")?.split(",")[0]?.trim();
  const forwardedHost = request.headers.get("x-forwarded-host")?.split(",")[0]?.trim();
  const host = forwardedHost || request.headers.get("host");
  const protocol = forwardedProto || request.nextUrl.protocol.replace(":", "") || "https";
  return host ? `${protocol}://${host}` : request.nextUrl.origin;
}

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ realm: string; action: string }> },
) {
  const { realm: rawRealm, action } = await context.params;
  if (!allowedRealms.has(rawRealm as AuthRealm) || !allowedActions.has(action)) {
    return NextResponse.json({ message: "Маршрут не найден" }, { status: 404 });
  }

  const realm = rawRealm as AuthRealm;
  const csrfCookieName = process.env.REFRESH_CSRF_COOKIE_NAME || "trimmycrm_refresh_csrf";
  const csrfToken = request.cookies.get(csrfCookieName)?.value;
  const cookie = request.headers.get("cookie");
  if (!csrfToken || !cookie) {
    return NextResponse.json(
      { statusCode: 401, error: "Unauthorized", message: "Сессия не найдена", code: "session_missing" },
      { status: 401, headers: { "Cache-Control": "no-store" } },
    );
  }

  const apiBase = (process.env.INTERNAL_API_BASE_URL || "http://api:8000/api/v1").replace(/\/$/, "");
  const internalEdgeToken = process.env.INTERNAL_EDGE_TOKEN;
  if (!internalEdgeToken) {
    return NextResponse.json(
      { statusCode: 503, error: "ServiceUnavailable", message: "Auth proxy is not configured", code: "auth_proxy_misconfigured" },
      { status: 503, headers: { "Cache-Control": "no-store" } },
    );
  }
  const prefix = realm === "tenant" ? "/t/auth" : "/auth";
  const origin = request.headers.get("origin") || publicOrigin(request);
  const host = request.headers.get("x-forwarded-host") || request.headers.get("host");
  const headers = new Headers({
    Accept: "application/json",
    Cookie: cookie,
    Origin: origin,
    "X-CSRF-Token": csrfToken,
  });
  if (host) {
    headers.set("Host", host);
    headers.set("X-Forwarded-Host", host);
  }
  headers.set("X-Forwarded-Proto", new URL(origin).protocol.replace(":", ""));
  headers.set("X-Internal-Edge-Token", internalEdgeToken);

  try {
    const upstream = await fetch(`${apiBase}${prefix}/${action}`, {
      method: "POST",
      headers,
      cache: "no-store",
      redirect: "manual",
    });
    const body = await upstream.arrayBuffer();
    const responseHeaders = new Headers({
      "Cache-Control": "no-store",
      "Content-Type": upstream.headers.get("content-type") || "application/json",
    });
    const getSetCookie = (upstream.headers as Headers & { getSetCookie?: () => string[] }).getSetCookie;
    const cookies = getSetCookie ? getSetCookie.call(upstream.headers) : [];
    cookies.forEach((value) => responseHeaders.append("Set-Cookie", value));
    return new NextResponse(body, { status: upstream.status, headers: responseHeaders });
  } catch {
    return NextResponse.json(
      { statusCode: 503, error: "ServiceUnavailable", message: "Сервис авторизации временно недоступен", code: "auth_upstream_unavailable" },
      { status: 503, headers: { "Cache-Control": "no-store" } },
    );
  }
}
