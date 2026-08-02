from types import SimpleNamespace

import pytest
from pydantic import SecretStr
from starlette.requests import Request

from app.core.security import CSRFError, RefreshCookieManager


def request_with_headers(headers: dict[str, str]) -> Request:
    return Request(
        {
            "type": "http",
            "method": "POST",
            "path": "/api/v1/t/auth/refresh",
            "headers": [(name.encode(), value.encode()) for name, value in headers.items()],
        }
    )


def cookie_manager() -> RefreshCookieManager:
    return RefreshCookieManager(
        SimpleNamespace(
            refresh_cookie_name="trimmycrm_refresh",
            refresh_csrf_cookie_name="trimmycrm_refresh_csrf",
            refresh_csrf_header_name="X-CSRF-Token",
            refresh_cookie_path="/api/v1",
            refresh_cookie_domain=None,
            refresh_cookie_secure=True,
            refresh_cookie_samesite="lax",
            refresh_token_ttl_seconds=2_592_000,
            csrf_enforce_origin=True,
            csrf_double_submit=True,
            csrf_trusted_origins=[],
            internal_edge_token=SecretStr("i" * 32),
        )
    )


def test_refresh_accepts_the_original_host_from_the_authenticated_bff() -> None:
    request = request_with_headers(
        {
            "host": "api:8000",
            "origin": "https://lapki-i-nozhnitsy.trimmycrm.ru",
            "x-forwarded-host": "lapki-i-nozhnitsy.trimmycrm.ru",
            "x-internal-edge-token": "i" * 32,
            "cookie": "trimmycrm_refresh_csrf=csrf-value",
            "x-csrf-token": "csrf-value",
        }
    )

    cookie_manager().validate_request(request)


def test_refresh_rejects_an_untrusted_forwarded_host() -> None:
    request = request_with_headers(
        {
            "host": "api:8000",
            "origin": "https://lapki-i-nozhnitsy.trimmycrm.ru",
            "x-forwarded-host": "lapki-i-nozhnitsy.trimmycrm.ru",
            "cookie": "trimmycrm_refresh_csrf=csrf-value",
            "x-csrf-token": "csrf-value",
        }
    )

    with pytest.raises(CSRFError, match="Origin is not allowed"):
        cookie_manager().validate_request(request)
