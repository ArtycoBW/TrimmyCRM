"""Граница провайдера капчи с проверкой, запрещающей доступ при сбое."""

from __future__ import annotations

import ipaddress
from dataclasses import dataclass
from typing import Protocol

import httpx

from app.core.config import Settings


@dataclass(frozen=True, slots=True)
class CaptchaResult:
    valid: bool
    provider_available: bool = True
    reason: str | None = None


class CaptchaVerifier(Protocol):
    async def verify(
        self, token: str, *, remote_ip: str, action: str | None = None
    ) -> CaptchaResult: ...


class YandexSmartCaptchaVerifier:
    def __init__(
        self,
        *,
        secret: str,
        verify_url: str = "https://smartcaptcha.yandexcloud.net/validate",
        timeout_seconds: float = 3.0,
        client: httpx.AsyncClient | None = None,
    ) -> None:
        if not secret:
            raise ValueError("SmartCaptcha secret is required")
        self._secret = secret
        self._verify_url = verify_url
        self._owns_client = client is None
        self._client = client or httpx.AsyncClient(
            timeout=httpx.Timeout(timeout_seconds),
            follow_redirects=False,
        )

    async def verify(
        self, token: str, *, remote_ip: str, action: str | None = None
    ) -> CaptchaResult:
        del action  # Ответ SmartCaptcha на проверку основан на токене и IP-адресе.
        if not token or len(token) > 4096:
            return CaptchaResult(valid=False, reason="missing_or_invalid_token")
        try:
            ipaddress.ip_address(remote_ip)
        except ValueError:
            return CaptchaResult(valid=False, reason="invalid_remote_ip")
        try:
            response = await self._client.post(
                self._verify_url,
                data={"secret": self._secret, "token": token, "ip": remote_ip},
            )
            response.raise_for_status()
            payload = response.json()
        except (httpx.HTTPError, ValueError):
            # Сбой провайдера не должен позволять обойти обязательную капчу.
            return CaptchaResult(
                valid=False,
                provider_available=False,
                reason="provider_unavailable",
            )
        if not isinstance(payload, dict):
            return CaptchaResult(valid=False, reason="invalid_provider_response")
        valid = payload.get("status") == "ok"
        return CaptchaResult(
            valid=valid,
            reason=None if valid else str(payload.get("message") or "rejected"),
        )

    async def aclose(self) -> None:
        if self._owns_client:
            await self._client.aclose()


class DevelopmentCaptchaVerifier:
    """Явный обход только для разработки, который никогда не выбирается неявно."""

    def __init__(self, environment: str) -> None:
        if environment not in {"development", "test"}:
            raise ValueError("disabled captcha is development/test only")

    async def verify(
        self, token: str, *, remote_ip: str, action: str | None = None
    ) -> CaptchaResult:
        del token, remote_ip, action
        return CaptchaResult(valid=True)


def build_captcha_verifier(settings: Settings) -> CaptchaVerifier:
    if settings.captcha_provider == "disabled":
        return DevelopmentCaptchaVerifier(settings.environment)
    assert settings.captcha_secret is not None  # гарантируется проверкой Settings
    return YandexSmartCaptchaVerifier(
        secret=settings.captcha_secret.get_secret_value(),
        verify_url=str(settings.captcha_verify_url),
        timeout_seconds=settings.captcha_timeout_seconds,
    )
