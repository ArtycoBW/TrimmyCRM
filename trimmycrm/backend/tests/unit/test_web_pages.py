from __future__ import annotations

import asyncio

from starlette.requests import Request

from app.web_pages import (
    _endpoint,
    _json_for_script,
    reset_password_page,
    verify_email_page,
)


def _request(tenant_id: str | None) -> Request:
    request = Request({"type": "http", "method": "GET", "path": "/", "headers": []})
    request.state.tenant_id = tenant_id
    return request


def test_platform_auth_page_uses_platform_api() -> None:
    assert _endpoint(_request(None), "verify-email") == "/api/v1/auth/verify-email"


def test_tenant_auth_page_uses_tenant_api() -> None:
    assert _endpoint(_request("tenant-id"), "reset-password") == "/api/v1/t/auth/reset-password"


def test_script_value_escapes_html_start() -> None:
    assert "<" not in _json_for_script("</script>")


def test_verify_page_contains_platform_endpoint_and_csp() -> None:
    response = asyncio.run(verify_email_page(_request(None), "A" * 24))

    assert b"/api/v1/auth/verify-email" in response.body
    assert response.headers["cache-control"] == "no-store"
    assert "script-src 'nonce-" in response.headers["content-security-policy"]


def test_reset_page_contains_tenant_endpoint() -> None:
    response = asyncio.run(reset_password_page(_request("tenant-id"), "B" * 24))

    assert b"/api/v1/t/auth/reset-password" in response.body
