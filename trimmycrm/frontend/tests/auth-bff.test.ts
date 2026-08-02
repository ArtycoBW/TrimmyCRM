import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

import { POST } from "../src/app/api/v1/frontend-auth/[realm]/[action]/route";

const originalInternalEdgeToken = process.env.INTERNAL_EDGE_TOKEN;

beforeEach(() => {
  process.env.INTERNAL_EDGE_TOKEN = "test-internal-edge-token";
});

afterEach(() => {
  vi.unstubAllGlobals();
  if (originalInternalEdgeToken === undefined) delete process.env.INTERNAL_EDGE_TOKEN;
  else process.env.INTERNAL_EDGE_TOKEN = originalInternalEdgeToken;
});

describe("auth refresh BFF", () => {
  it("rejects refresh without the path-scoped session cookies", async () => {
    const request = new NextRequest(
      "https://trimmycrm.ru/api/v1/frontend-auth/platform/refresh",
      { method: "POST" },
    );

    const response = await POST(request, {
      params: Promise.resolve({ realm: "platform", action: "refresh" }),
    });

    expect(response.status).toBe(401);
  });

  it("forwards tenant cookies, CSRF and public origin to the backend", async () => {
    const upstreamFetch = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({
        accessToken: "rotated-access",
        tokenType: "bearer",
        expiresIn: 900,
      }), {
        status: 200,
        headers: {
          "content-type": "application/json",
          "set-cookie": "trimmycrm_refresh=rotated; Path=/api/v1; HttpOnly",
        },
      }),
    );
    vi.stubGlobal("fetch", upstreamFetch);

    const request = new NextRequest(
      "https://lapushka.trimmycrm.ru/api/v1/frontend-auth/tenant/refresh",
      {
        method: "POST",
        headers: {
          cookie: "trimmycrm_refresh=secret; trimmycrm_refresh_csrf=csrf-token",
          host: "lapushka.trimmycrm.ru",
          origin: "https://lapushka.trimmycrm.ru",
        },
      },
    );

    const response = await POST(request, {
      params: Promise.resolve({ realm: "tenant", action: "refresh" }),
    });

    expect(response.status).toBe(200);
    expect(upstreamFetch).toHaveBeenCalledOnce();
    const [url, init] = upstreamFetch.mock.calls[0] as [string, RequestInit];
    const headers = new Headers(init.headers);
    expect(url).toBe("http://api:8000/api/v1/t/auth/refresh");
    expect(headers.get("cookie")).toContain("trimmycrm_refresh=secret");
    expect(headers.get("x-csrf-token")).toBe("csrf-token");
    expect(headers.get("origin")).toBe("https://lapushka.trimmycrm.ru");
    expect(headers.get("host")).toBe("lapushka.trimmycrm.ru");
    expect(headers.get("x-forwarded-host")).toBe("lapushka.trimmycrm.ru");
    expect(headers.get("x-forwarded-proto")).toBe("https");
    expect(headers.get("x-internal-edge-token")).toBe("test-internal-edge-token");
    expect(response.headers.get("set-cookie")).toContain("trimmycrm_refresh=rotated");
  });
});
