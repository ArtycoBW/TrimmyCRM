from __future__ import annotations

import os
from pathlib import Path
from types import SimpleNamespace
from typing import Any

import pytest

for key, value in {
    "DATABASE_URL": "postgresql+asyncpg://trimmycrm:trimmycrm@localhost/trimmycrm_test",
    "REDIS_URL": "redis://localhost:6379/0",
    "CELERY_BROKER_URL": "redis://localhost:6379/1",
    "CELERY_RESULT_BACKEND": "redis://localhost:6379/2",
    "S3_ENDPOINT_URL": "https://storage.yandexcloud.net",
    "INTERNAL_EDGE_TOKEN": "edge-token-1111111111111111111111111111",
    "JWT_PLATFORM_SECRET": "platform-secret-111111111111111111111111",
    "JWT_TENANT_SECRET": "tenant-secret-22222222222222222222222222",
    "AUTH_TOKEN_PEPPER": "token-pepper-333333333333333333333333333",
    "ENVIRONMENT": "test",
    "PAYMENT_PROVIDER": "mock",
}.items():
    os.environ[key] = value

from app.main import app  # noqa: E402
from app.tasks.jobs import _auth_email, _tenant_origin  # noqa: E402


def _settings(public_base_url: str, *, development: bool = True) -> Any:
    return SimpleNamespace(public_base_url=public_base_url, is_development=development)


def test_tenant_auth_origin_inherits_public_development_port() -> None:
    origin = _tenant_origin(
        _settings("http://trimmycrm.localhost:8080"),
        "salon.trimmycrm.localhost",
    )

    assert origin == "http://salon.trimmycrm.localhost:8080"


def test_tenant_auth_origin_keeps_explicit_host_port() -> None:
    origin = _tenant_origin(
        _settings("http://trimmycrm.localhost:8080"),
        "salon.trimmycrm.localhost:9090",
    )

    assert origin == "http://salon.trimmycrm.localhost:9090"


@pytest.mark.parametrize(
    ("kind", "path"),
    [
        ("tenant_verify", "/verify-email"),
        ("tenant_reset", "/reset-password"),
    ],
)
def test_tenant_auth_email_links_keep_development_edge_port(kind: str, path: str) -> None:
    message = _auth_email(
        _settings("http://trimmycrm.localhost:8080"),
        kind,
        "client@example.com",
        "raw-token",
        "salon.trimmycrm.localhost",
    )
    expected_link = f"http://salon.trimmycrm.localhost:8080{path}?token=raw-token"

    assert expected_link in message.text
    assert expected_link in message.html


def test_tenant_auth_email_uses_salon_display_name() -> None:
    message = _auth_email(
        _settings("https://trimmycrm.ru"),
        "tenant_verify",
        "client@example.com",
        "raw-token",
        "lapki.trimmycrm.ru",
        "Лапки и ножницы",
    )

    assert message.from_name == "Лапки и ножницы"
    assert message.subject == "Подтвердите email в Лапки и ножницы"


@pytest.mark.parametrize(
    "tenant_host",
    [
        "https://salon.trimmycrm.localhost",
        "user@salon.trimmycrm.localhost",
        "salon.trimmycrm.localhost/path",
        "salon.trimmycrm.localhost:invalid",
    ],
)
def test_tenant_auth_origin_rejects_ambiguous_hosts(tenant_host: str) -> None:
    with pytest.raises(ValueError, match="invalid tenant host"):
        _tenant_origin(_settings("http://trimmycrm.localhost:8080"), tenant_host)


def test_openapi_declares_bearer_auth_for_protected_routes() -> None:
    schema = app.openapi()

    assert schema["components"]["securitySchemes"]["BearerAuth"] == {
        "type": "http",
        "description": "JWT access-токен платформы или клиента салона",
        "scheme": "bearer",
        "bearerFormat": "JWT",
    }
    assert schema["paths"]["/api/v1/auth/me"]["get"]["security"] == [{"BearerAuth": []}]
    assert schema["paths"]["/api/v1/auth/dashboard-tour/claim"]["post"]["security"] == [
        {"BearerAuth": []}
    ]
    assert schema["paths"]["/api/v1/t/auth/me"]["get"]["security"] == [{"BearerAuth": []}]
    assert "security" not in schema["paths"]["/api/v1/auth/login"]["post"]


def test_nginx_preserves_request_authority_for_api_proxying() -> None:
    repository_root = Path(__file__).resolve().parents[3]
    template = (repository_root / "deploy/infra/nginx/templates/default.conf.template").read_text()
    api_part = template.split("location ^~ /_dev/mail/", maxsplit=1)[0]

    host_headers = api_part.count("proxy_set_header Host $http_host;")
    forwarded_host_headers = api_part.count("proxy_set_header X-Forwarded-Host $http_host;")

    assert host_headers >= 5
    assert forwarded_host_headers == host_headers
    assert "proxy_set_header Host $host;" not in api_part


def test_nginx_uses_a_separate_limiter_for_safe_public_reads() -> None:
    repository_root = Path(__file__).resolve().parents[3]
    template = (repository_root / "deploy/infra/nginx/templates/default.conf.template").read_text()

    assert "zone=public_read_limit:10m rate=120r/s" in template
    public_read_location = (
        "location ~ "
        "^/api/v1/(?:plans|public/(?:site|services|staff|reviews|promotions|media))(?:/|$)"
    )
    assert public_read_location in template
    assert "limit_req zone=public_read_limit burst=240 nodelay;" in template
    assert "location ~ ^/api/v1/booking(?:/|$)" in template
    assert "limit_req zone=booking_limit burst=20 nodelay;" in template
    assert "location @rate_limited" in template
    assert 'add_header Retry-After "1" always;' in template


def test_runtime_examples_and_edge_config_use_trimmycrm_domain() -> None:
    repository_root = Path(__file__).resolve().parents[3]
    paths = (
        repository_root / "frontend/.env.example",
        repository_root / "deploy/infra/.env.example",
        repository_root / "deploy/infra/nginx/templates/default.conf.template",
    )
    content = "\n".join(path.read_text(encoding="utf-8") for path in paths)

    assert "groomcrm" not in content.lower()
    assert "/pets/" not in content.lower()
    assert "trimmycrm_refresh_csrf" in content
