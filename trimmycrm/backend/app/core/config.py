"""Типизированная конфигурация приложения.

У секретов намеренно нет значений по умолчанию. Если при развёртывании забыли
передать ключ JWT, процесс должен завершиться при запуске, а не молча использовать
ключ для разработки.
"""

from __future__ import annotations

import ipaddress
from functools import lru_cache
from typing import Annotated, Literal
from urllib.parse import urlsplit

from pydantic import AnyHttpUrl, Field, SecretStr, field_validator, model_validator
from pydantic_settings import BaseSettings, NoDecode, SettingsConfigDict

Environment = Literal["development", "test", "staging", "production"]
StringList = Annotated[list[str], NoDecode]


class Settings(BaseSettings):
    """Общие для API и обработчиков настройки из переменных окружения."""

    model_config = SettingsConfigDict(
        env_file=(".env", ".env.local"),
        env_file_encoding="utf-8",
        env_ignore_empty=True,
        extra="ignore",
        case_sensitive=False,
    )

    app_name: str = "TrimmyCRM API"
    environment: Environment = "development"
    debug: bool = False
    api_v1_prefix: str = "/api/v1"
    api_host: str = "0.0.0.0"  # noqa: S104 - слушатель контейнера, не публичная привязка
    api_port: int = Field(default=8000, ge=1, le=65535)
    api_workers: int = Field(default=2, ge=1, le=64)
    public_base_url: AnyHttpUrl = AnyHttpUrl("http://localhost:3000")

    database_url: SecretStr
    # Отдельная роль приложения NOBYPASSRLS для поиска хостов с явной областью
    # и операций суперадминистратора. Запросы тенантов должны использовать database_url.
    admin_database_url: SecretStr | None = None
    redis_url: SecretStr
    celery_broker_url: SecretStr
    celery_result_backend: SecretStr
    internal_edge_token: SecretStr

    log_level: Literal["DEBUG", "INFO", "WARNING", "ERROR", "CRITICAL"] = "INFO"
    sentry_dsn: SecretStr | None = None
    otel_exporter_otlp_endpoint: AnyHttpUrl | None = None
    prometheus_enabled: bool = True

    # Два пространства аутентификации изолированы криптографически, а не только
    # утверждениями. Скомпрометированный ключ тенанта не создаст токен платформы.
    jwt_platform_secret: SecretStr
    jwt_tenant_secret: SecretStr
    jwt_platform_audience: str = "trimmycrm-platform"
    jwt_tenant_audience: str = "trimmycrm-tenant"
    jwt_issuer: str = "trimmycrm-api"
    jwt_algorithm: Literal["HS256", "HS384", "HS512"] = "HS256"
    access_token_ttl_seconds: int = Field(default=900, ge=60, le=3600)
    refresh_token_ttl_seconds: int = Field(default=2_592_000, ge=3600, le=7_776_000)
    auth_token_pepper: SecretStr
    email_verification_ttl_seconds: int = Field(default=86_400, ge=300, le=604_800)
    password_reset_ttl_seconds: int = Field(default=3600, ge=300, le=86_400)

    password_min_length: int = Field(default=10, ge=10, le=64)
    password_max_length: int = Field(default=128, ge=64, le=1024)

    refresh_cookie_name: str = "trimmycrm_refresh"
    refresh_csrf_cookie_name: str = "trimmycrm_refresh_csrf"
    refresh_csrf_header_name: str = "X-CSRF-Token"
    refresh_cookie_path: str = "/api/v1"
    refresh_cookie_domain: str | None = None
    refresh_cookie_secure: bool = True
    refresh_cookie_samesite: Literal["lax", "strict", "none"] = "lax"
    csrf_enforce_origin: bool = True
    csrf_double_submit: bool = True
    csrf_trusted_origins: StringList = Field(default_factory=list)
    allowed_origins: StringList = Field(default_factory=lambda: ["http://localhost:3000"])

    trusted_proxy_networks: StringList = Field(default_factory=list)
    platform_hosts: StringList = Field(default_factory=lambda: ["trimmycrm.ru", "www.trimmycrm.ru"])
    tenant_base_domains: StringList = Field(default_factory=lambda: ["trimmycrm.ru"])
    reserved_tenant_slugs: StringList = Field(
        default_factory=lambda: ["www", "api", "admin", "app", "static", "media"]
    )
    tenant_host_cache_ttl_seconds: int = Field(default=300, ge=5, le=86_400)
    tenant_host_negative_cache_ttl_seconds: int = Field(default=30, ge=1, le=600)

    rate_limit_auth_requests: int = Field(default=10, ge=1, le=1000)
    rate_limit_auth_window_seconds: int = Field(default=60, ge=1, le=3600)
    auth_failure_window_seconds: int = Field(default=900, ge=60, le=86_400)
    auth_captcha_after_failures: int = Field(default=3, ge=1, le=100)
    auth_block_after_failures: int = Field(default=10, ge=2, le=1000)
    auth_block_seconds: int = Field(default=900, ge=30, le=86_400)
    auth_rate_limit_fail_closed: bool = True

    trial_days: int = Field(default=14, ge=0, le=90)
    grace_period_days: int = Field(default=7, ge=0, le=90)
    cancellation_cutoff_hours: int = Field(default=2, ge=0, le=168)
    preview_token_ttl_seconds: int = Field(default=1800, ge=60, le=86_400)

    captcha_provider: Literal["yandex", "disabled"] = "disabled"
    captcha_secret: SecretStr | None = None
    captcha_verify_url: AnyHttpUrl = AnyHttpUrl("https://smartcaptcha.yandexcloud.net/validate")
    captcha_timeout_seconds: float = Field(default=3.0, gt=0, le=15)

    payment_provider: Literal["yookassa", "mock"] = "yookassa"
    mock_payment_auto_succeed: bool = False
    yookassa_shop_id: SecretStr | None = None
    yookassa_secret_key: SecretStr | None = None
    yookassa_api_url: AnyHttpUrl = AnyHttpUrl("https://api.yookassa.ru/v3")
    yookassa_webhook_source_networks: StringList = Field(default_factory=list)
    payment_timeout_seconds: float = Field(default=10.0, gt=0, le=60)

    s3_endpoint_url: AnyHttpUrl
    s3_region: str = "ru-central1"
    s3_bucket: str = "trimmycrm-media"
    s3_access_key: SecretStr | None = None
    s3_secret_key: SecretStr | None = None
    s3_presign_ttl_seconds: int = Field(default=600, ge=60, le=3600)
    upload_max_bytes: int = Field(default=10 * 1024 * 1024, ge=1024)
    upload_allowed_mime_types: StringList = Field(
        default_factory=lambda: [
            "image/jpeg",
            "image/png",
            "image/webp",
            "application/pdf",
        ]
    )
    clamav_host: str | None = "clamav"
    clamav_port: int = Field(default=3310, ge=1, le=65535)
    clamav_timeout_seconds: float = Field(default=15.0, gt=0, le=120)
    malware_scan_fail_closed: bool = True

    smtp_host: str | None = None
    smtp_port: int = Field(default=587, ge=1, le=65535)
    smtp_username: str | None = None
    smtp_password: SecretStr | None = None
    smtp_from_email: str = "no-reply@trimmycrm.ru"
    smtp_from_name: str = "TrimmyCRM"
    smtp_starttls: bool = True
    smtp_use_ssl: bool = False
    smtp_timeout_seconds: float = Field(default=10.0, gt=0, le=60)

    smsc_login: str | None = None
    smsc_password: SecretStr | None = None
    smsc_sender: str | None = None
    smsc_api_url: AnyHttpUrl = AnyHttpUrl("https://smsc.ru/sys/send.php")
    telegram_bot_token: SecretStr | None = None
    telegram_api_url: AnyHttpUrl = AnyHttpUrl("https://api.telegram.org")
    notification_timeout_seconds: float = Field(default=10.0, gt=0, le=60)

    @field_validator(
        "allowed_origins",
        "csrf_trusted_origins",
        "trusted_proxy_networks",
        "platform_hosts",
        "tenant_base_domains",
        "reserved_tenant_slugs",
        "yookassa_webhook_source_networks",
        "upload_allowed_mime_types",
        mode="before",
    )
    @classmethod
    def _parse_lists(cls, value: object) -> object:
        """Принимать массивы JSON и удобные значения через запятую.

        Обычно pydantic-settings декодирует сложные значения окружения из JSON.
        Валидатор сохраняет удобство прямого создания и значений dotenv в версиях
        и конфигурациях, где до модели доходит исходная строка.
        """

        if isinstance(value, str):
            stripped = value.strip()
            if stripped.startswith("["):
                import json

                return json.loads(stripped)
            return [item.strip() for item in stripped.split(",") if item.strip()]
        return value

    @model_validator(mode="after")
    def _security_invariants(self) -> Settings:
        platform_secret = self.jwt_platform_secret.get_secret_value()
        tenant_secret = self.jwt_tenant_secret.get_secret_value()
        pepper = self.auth_token_pepper.get_secret_value()

        if platform_secret == tenant_secret:
            raise ValueError("platform and tenant JWT secrets must be different")
        for name, value in (
            ("jwt_platform_secret", platform_secret),
            ("jwt_tenant_secret", tenant_secret),
            ("auth_token_pepper", pepper),
            ("internal_edge_token", self.internal_edge_token.get_secret_value()),
        ):
            if len(value.encode("utf-8")) < 32:
                raise ValueError(f"{name} must contain at least 32 bytes")
        if self.jwt_platform_audience == self.jwt_tenant_audience:
            raise ValueError("platform and tenant JWT audiences must be different")
        if self.refresh_cookie_samesite == "none" and not self.refresh_cookie_secure:
            raise ValueError("SameSite=None refresh cookies must be Secure")
        if self.smtp_starttls and self.smtp_use_ssl:
            raise ValueError("SMTP STARTTLS and implicit SSL are mutually exclusive")
        if not self.tenant_base_domains:
            raise ValueError("at least one tenant base domain is required")
        if any(origin == "*" for origin in self.allowed_origins):
            raise ValueError("wildcard CORS origins are not permitted with credentials")
        try:
            for network in (*self.trusted_proxy_networks, *self.yookassa_webhook_source_networks):
                ipaddress.ip_network(network, strict=False)
        except ValueError as exc:
            raise ValueError("invalid trusted proxy/payment source network") from exc

        if self.environment in {"staging", "production"}:
            if not self.refresh_cookie_secure:
                raise ValueError("refresh cookies must be Secure outside local development")
            if urlsplit(str(self.public_base_url)).scheme != "https":
                raise ValueError("public_base_url must use HTTPS outside development")
            if self.captcha_provider == "disabled":
                raise ValueError("captcha cannot be disabled in staging/production")
            if not self.clamav_host or not self.malware_scan_fail_closed:
                raise ValueError("malware scanning must be fail-closed outside development")

        if self.captcha_provider == "yandex" and self.captcha_secret is None:
            raise ValueError("captcha_secret is required for Yandex SmartCaptcha")
        if self.captcha_provider == "disabled" and self.environment not in {
            "development",
            "test",
        }:
            raise ValueError("disabled captcha is only allowed in development/test")

        if self.payment_provider == "mock" and self.environment not in {
            "development",
            "test",
        }:
            raise ValueError("mock payments are only allowed in development/test")
        if self.mock_payment_auto_succeed and self.payment_provider != "mock":
            raise ValueError("mock_payment_auto_succeed requires the mock payment provider")
        if self.payment_provider == "yookassa" and (
            self.yookassa_shop_id is None or self.yookassa_secret_key is None
        ):
            raise ValueError("YooKassa credentials are required")
        if self.payment_provider == "yookassa" and self.environment in {
            "staging",
            "production",
        }:
            if urlsplit(str(self.yookassa_api_url)).hostname != "api.yookassa.ru":
                raise ValueError(
                    "production YooKassa credentials may only be sent to api.yookassa.ru"
                )
        if self.environment in {"staging", "production"} and not (
            self.yookassa_webhook_source_networks
        ):
            raise ValueError("YooKassa webhook source allowlist must not be empty")

        return self

    @property
    def is_development(self) -> bool:
        return self.environment in {"development", "test"}


@lru_cache(maxsize=1)
def get_settings() -> Settings:
    """Создать общий для процесса объект настроек, условно считающийся неизменяемым."""

    # Обязательные значения pydantic-settings получает из окружения и файла .env.
    return Settings()
