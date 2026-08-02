"""Примитивы защиты аутентификации, паролей и браузерных куки."""

from __future__ import annotations

import hashlib
import hmac
import ipaddress
import re
import secrets
import unicodedata
import uuid
from collections.abc import Mapping, Sequence
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from enum import StrEnum
from typing import Any
from urllib.parse import urlsplit

import jwt
from argon2 import PasswordHasher
from argon2.exceptions import InvalidHashError, VerificationError
from argon2.low_level import Type
from fastapi import Request, Response

from app.core.config import Settings


class AuthAudience(StrEnum):
    PLATFORM = "platform"
    TENANT = "tenant"


class TokenType(StrEnum):
    ACCESS = "access"
    REFRESH = "refresh"


class SecurityError(ValueError):
    """Базовое исключение, которое безопасно перехватывать при аутентификации."""


class InvalidTokenError(SecurityError):
    pass


class PasswordPolicyError(SecurityError):
    def __init__(self, violations: Sequence[str]) -> None:
        self.violations = tuple(violations)
        super().__init__("; ".join(self.violations))


class CSRFError(SecurityError):
    pass


@dataclass(frozen=True, slots=True)
class TokenClaims:
    subject: uuid.UUID
    audience: AuthAudience
    token_type: TokenType
    jti: uuid.UUID
    issued_at: datetime
    expires_at: datetime
    tenant_id: uuid.UUID | None = None
    roles: tuple[str, ...] = ()


@dataclass(frozen=True, slots=True)
class IssuedToken:
    token: str
    jti: uuid.UUID
    expires_at: datetime


class PasswordService:
    """Хеширование Argon2id и явная политика паролей.

    Ошибки политики следует возвращать только при выборе нового пароля. Вход всегда
    возвращает общую ошибку аутентификации, чтобы не раскрывать наличие учётной записи.
    """

    _COMMON = frozenset(
        {
            "password",
            "password1",
            "qwerty123",
            "1234567890",
            "trimmycrm",
            "пароль123",
        }
    )

    def __init__(
        self,
        *,
        min_length: int = 10,
        max_length: int = 128,
        hasher: PasswordHasher | None = None,
    ) -> None:
        self.min_length = min_length
        self.max_length = max_length
        self._hasher = hasher or PasswordHasher(
            time_cost=3,
            memory_cost=65_536,
            parallelism=4,
            hash_len=32,
            salt_len=16,
            type=Type.ID,
        )

    @classmethod
    def from_settings(cls, settings: Settings) -> PasswordService:
        return cls(
            min_length=settings.password_min_length,
            max_length=settings.password_max_length,
        )

    def policy_violations(self, password: str, *, email: str | None = None) -> list[str]:
        violations: list[str] = []
        if len(password) < self.min_length:
            violations.append(f"Пароль должен содержать минимум {self.min_length} символов")
        if len(password) > self.max_length:
            violations.append(f"Пароль должен содержать не более {self.max_length} символов")
        if password != password.strip() or any(unicodedata.category(c) == "Cc" for c in password):
            violations.append(
                "Пароль не должен начинаться/заканчиваться "
                "пробелом "
                "или содержать управляющие символы"
            )
        if not any(c.islower() for c in password):
            violations.append("Добавьте строчную букву")
        if not any(c.isupper() for c in password):
            violations.append("Добавьте заглавную букву")
        if not any(c.isdigit() for c in password):
            violations.append("Добавьте цифру")
        if not any(unicodedata.category(c)[0] in {"P", "S"} for c in password):
            violations.append("Добавьте специальный символ")
        folded = password.casefold()
        if folded in self._COMMON:
            violations.append("Выберите менее распространённый пароль")
        if email:
            local_part = email.partition("@")[0].strip().casefold()
            if len(local_part) >= 3 and local_part in folded:
                violations.append("Пароль не должен содержать email")
        return violations

    def validate(self, password: str, *, email: str | None = None) -> None:
        violations = self.policy_violations(password, email=email)
        if violations:
            raise PasswordPolicyError(violations)

    def hash(self, password: str, *, email: str | None = None) -> str:
        self.validate(password, email=email)
        return self._hasher.hash(password)

    def verify(self, password_hash: str, candidate: str) -> bool:
        try:
            return self._hasher.verify(password_hash, candidate)
        except (VerificationError, InvalidHashError):
            return False

    def needs_rehash(self, password_hash: str) -> bool:
        try:
            return self._hasher.check_needs_rehash(password_hash)
        except (InvalidHashError, VerificationError):
            return True


class JWTService:
    """Выпускает и проверяет JWT пространства со строгими алгоритмами и утверждениями."""

    def __init__(self, settings: Settings) -> None:
        self._algorithm = settings.jwt_algorithm
        self._issuer = settings.jwt_issuer
        self._access_ttl = settings.access_token_ttl_seconds
        self._refresh_ttl = settings.refresh_token_ttl_seconds
        self._secrets = {
            AuthAudience.PLATFORM: settings.jwt_platform_secret.get_secret_value(),
            AuthAudience.TENANT: settings.jwt_tenant_secret.get_secret_value(),
        }
        self._audiences = {
            AuthAudience.PLATFORM: settings.jwt_platform_audience,
            AuthAudience.TENANT: settings.jwt_tenant_audience,
        }

    def issue_access(
        self,
        *,
        subject: uuid.UUID | str,
        audience: AuthAudience,
        tenant_id: uuid.UUID | str | None = None,
        roles: Sequence[str] = (),
        now: datetime | None = None,
    ) -> IssuedToken:
        return self._issue(
            subject=subject,
            audience=audience,
            token_type=TokenType.ACCESS,
            ttl_seconds=self._access_ttl,
            tenant_id=tenant_id,
            roles=roles,
            now=now,
        )

    def issue_refresh(
        self,
        *,
        subject: uuid.UUID | str,
        audience: AuthAudience,
        tenant_id: uuid.UUID | str | None = None,
        now: datetime | None = None,
    ) -> IssuedToken:
        return self._issue(
            subject=subject,
            audience=audience,
            token_type=TokenType.REFRESH,
            ttl_seconds=self._refresh_ttl,
            tenant_id=tenant_id,
            roles=(),
            now=now,
        )

    def _issue(
        self,
        *,
        subject: uuid.UUID | str,
        audience: AuthAudience,
        token_type: TokenType,
        ttl_seconds: int,
        tenant_id: uuid.UUID | str | None,
        roles: Sequence[str],
        now: datetime | None,
    ) -> IssuedToken:
        issued_at = (now or datetime.now(UTC)).astimezone(UTC)
        expires_at = issued_at + timedelta(seconds=ttl_seconds)
        jti = uuid.uuid4()
        payload: dict[str, Any] = {
            "sub": str(subject),
            "aud": self._audiences[audience],
            "iss": self._issuer,
            "iat": issued_at,
            "nbf": issued_at,
            "exp": expires_at,
            "jti": str(jti),
            "typ": token_type.value,
        }
        if tenant_id is not None:
            payload["tenant_id"] = str(tenant_id)
        if roles:
            payload["roles"] = list(dict.fromkeys(roles))
        token = jwt.encode(payload, self._secrets[audience], algorithm=self._algorithm)
        return IssuedToken(token=token, jti=jti, expires_at=expires_at)

    def decode(
        self,
        token: str,
        *,
        audience: AuthAudience,
        token_type: TokenType = TokenType.ACCESS,
    ) -> TokenClaims:
        try:
            payload = jwt.decode(
                token,
                self._secrets[audience],
                algorithms=[self._algorithm],
                audience=self._audiences[audience],
                issuer=self._issuer,
                options={"require": ["sub", "aud", "iss", "iat", "nbf", "exp", "jti", "typ"]},
            )
            if not hmac.compare_digest(str(payload.get("typ", "")), token_type.value):
                raise InvalidTokenError("wrong token type")
            tenant_id = _optional_uuid(payload.get("tenant_id"), "tenant_id")
            if audience is AuthAudience.TENANT and tenant_id is None:
                raise InvalidTokenError("tenant token has no tenant_id")
            roles_value = payload.get("roles", [])
            if not isinstance(roles_value, list) or not all(
                isinstance(role, str) for role in roles_value
            ):
                raise InvalidTokenError("invalid roles claim")
            return TokenClaims(
                subject=_required_uuid(payload.get("sub"), "sub"),
                audience=audience,
                token_type=token_type,
                jti=_required_uuid(payload.get("jti"), "jti"),
                issued_at=_timestamp(payload.get("iat"), "iat"),
                expires_at=_timestamp(payload.get("exp"), "exp"),
                tenant_id=tenant_id,
                roles=tuple(roles_value),
            )
        except InvalidTokenError:
            raise
        except (jwt.PyJWTError, TypeError, ValueError, OverflowError) as exc:
            raise InvalidTokenError("invalid or expired token") from exc


def generate_opaque_token(num_bytes: int = 32) -> str:
    if num_bytes < 32:
        raise ValueError("opaque security tokens need at least 256 bits")
    return secrets.token_urlsafe(num_bytes)


def hash_opaque_token(token: str, pepper: str | bytes) -> str:
    """Односторонний дайджест для хранения токенов аутентификации и обновления."""

    pepper_bytes = pepper.encode() if isinstance(pepper, str) else pepper
    return hmac.new(pepper_bytes, token.encode("utf-8"), hashlib.sha256).hexdigest()


def opaque_token_matches(token: str, expected_hash: str, pepper: str | bytes) -> bool:
    return hmac.compare_digest(hash_opaque_token(token, pepper), expected_hash)


class RefreshCookieManager:
    """Устанавливает куки обновления и проверяет Origin и двойную отправку CSRF."""

    def __init__(self, settings: Settings) -> None:
        self.name = settings.refresh_cookie_name
        self.csrf_name = settings.refresh_csrf_cookie_name
        self.csrf_header = settings.refresh_csrf_header_name
        self.path = settings.refresh_cookie_path
        self.domain = settings.refresh_cookie_domain
        self.secure = settings.refresh_cookie_secure
        self.samesite = settings.refresh_cookie_samesite
        self.max_age = settings.refresh_token_ttl_seconds
        self.enforce_origin = settings.csrf_enforce_origin
        self.double_submit = settings.csrf_double_submit
        self.internal_edge_token = settings.internal_edge_token.get_secret_value()
        self.trusted_cross_origins = frozenset(
            _normalize_origin(value) for value in settings.csrf_trusted_origins
        )

    def set(self, response: Response, refresh_token: str) -> str:
        csrf_token = generate_opaque_token(32)
        common: dict[str, Any] = {
            "max_age": self.max_age,
            "path": self.path,
            "domain": self.domain,
            "secure": self.secure,
            "samesite": self.samesite,
        }
        response.set_cookie(self.name, refresh_token, httponly=True, **common)
        response.set_cookie(self.csrf_name, csrf_token, httponly=False, **common)
        return csrf_token

    def clear(self, response: Response) -> None:
        for name in (self.name, self.csrf_name):
            response.delete_cookie(
                name,
                path=self.path,
                domain=self.domain,
                secure=self.secure,
                httponly=name == self.name,
                samesite=self.samesite,
            )

    def refresh_token(self, request: Request) -> str:
        value = request.cookies.get(self.name)
        if not value:
            raise InvalidTokenError("refresh token cookie is missing")
        return value

    def validate_request(self, request: Request) -> None:
        if self.enforce_origin:
            origin = request.headers.get("origin")
            if not origin:
                raise CSRFError("Origin header is required")
            try:
                normalized = _normalize_origin(origin)
            except ValueError as exc:
                raise CSRFError("invalid Origin") from exc
            if not self._same_request_origin(request, normalized) and (
                normalized not in self.trusted_cross_origins
            ):
                raise CSRFError("Origin is not allowed")
        if self.double_submit:
            cookie_value = request.cookies.get(self.csrf_name, "")
            header_value = request.headers.get(self.csrf_header, "")
            if (
                not cookie_value
                or not header_value
                or not hmac.compare_digest(cookie_value, header_value)
            ):
                raise CSRFError("CSRF token mismatch")

    def _same_request_origin(self, request: Request, normalized_origin: str) -> bool:
        parsed = urlsplit(normalized_origin)
        if self.secure and parsed.scheme != "https":
            return False
        host = request.headers.get("host", "")
        forwarded_host = request.headers.get("x-forwarded-host")
        edge_token = request.headers.get("x-internal-edge-token", "")
        # The Next.js BFF connects to the API by its Docker hostname.  It sends the
        # original host together with a shared internal token, so only that trusted
        # hop may use the forwarded host for the same-origin CSRF comparison.
        if (
            forwarded_host
            and "," not in forwarded_host
            and edge_token
            and hmac.compare_digest(edge_token, self.internal_edge_token)
        ):
            host = forwarded_host
        if not host or any(char in host for char in "\r\n,/@\\"):
            return False
        try:
            request_origin = _normalize_origin(f"{parsed.scheme}://{host}")
        except ValueError:
            return False
        return hmac.compare_digest(request_origin, normalized_origin)


def client_ip_from_request(
    request: Request, trusted_proxy_networks: Sequence[str] = ()
) -> ipaddress.IPv4Address | ipaddress.IPv6Address:
    """Вернуть IP-адрес клиента, который нельзя подменить.

    Перенаправленные заголовки учитываются, только если непосредственный узел TCP
    принадлежит настроенной доверенной сети прокси. Прокси должен перезаписывать
    X-Forwarded-For, а не добавлять к пользовательскому вводу. Доверенные переходы
    обходятся справа налево.
    """

    if request.client is None:
        raise SecurityError("request peer address is unavailable")
    try:
        peer = ipaddress.ip_address(request.client.host)
        trusted = tuple(
            ipaddress.ip_network(value, strict=False) for value in trusted_proxy_networks
        )
    except ValueError as exc:
        raise SecurityError("invalid network configuration or peer address") from exc
    if not any(peer in network for network in trusted):
        return peer

    raw = request.headers.get("x-forwarded-for", "")
    if not raw or "\r" in raw or "\n" in raw:
        return peer
    try:
        chain = [ipaddress.ip_address(part.strip()) for part in raw.split(",") if part.strip()]
    except ValueError:
        return peer
    current = peer
    for candidate in reversed(chain):
        if not any(current in network for network in trusted):
            break
        current = candidate
    return current


def _normalize_origin(raw: str) -> str:
    if any(char in raw for char in "\r\n,"):
        raise ValueError("invalid origin")
    parsed = urlsplit(raw.strip())
    if parsed.scheme not in {"http", "https"} or not parsed.hostname:
        raise ValueError("invalid origin")
    if (
        parsed.username
        or parsed.password
        or parsed.path not in {"", "/"}
        or parsed.query
        or parsed.fragment
    ):
        raise ValueError("invalid origin")
    host = parsed.hostname.encode("idna").decode("ascii").lower().rstrip(".")
    default_port = 443 if parsed.scheme == "https" else 80
    port = parsed.port
    port_part = "" if port in {None, default_port} else f":{port}"
    if ":" in host:
        host = f"[{host}]"
    return f"{parsed.scheme}://{host}{port_part}"


def _required_uuid(value: object, claim: str) -> uuid.UUID:
    parsed = _optional_uuid(value, claim)
    if parsed is None:
        raise InvalidTokenError(f"missing {claim}")
    return parsed


def _optional_uuid(value: object, claim: str) -> uuid.UUID | None:
    if value is None:
        return None
    try:
        return uuid.UUID(str(value))
    except (ValueError, TypeError, AttributeError) as exc:
        raise InvalidTokenError(f"invalid {claim}") from exc


def _timestamp(value: object, claim: str) -> datetime:
    if not isinstance(value, (int, float)):
        raise InvalidTokenError(f"invalid {claim}")
    return datetime.fromtimestamp(value, tz=UTC)


_BEARER_RE = re.compile(r"^Bearer\s+(\S+)$", re.IGNORECASE)


def bearer_token(headers: Mapping[str, str]) -> str:
    match = _BEARER_RE.fullmatch(headers.get("authorization", ""))
    if not match:
        raise InvalidTokenError("Bearer token is required")
    return match.group(1)
