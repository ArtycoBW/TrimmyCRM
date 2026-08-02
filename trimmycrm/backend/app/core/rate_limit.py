"""Ограничение частоты через Redis и усиление защиты аутентификации и капчи."""

from __future__ import annotations

import hashlib
import logging
import re
from collections.abc import Awaitable
from dataclasses import dataclass
from enum import StrEnum
from typing import Any, Protocol, cast

from redis.asyncio import Redis
from redis.exceptions import RedisError

from app.core.config import Settings

logger = logging.getLogger(__name__)
_SCOPE_RE = re.compile(r"^[a-z0-9:_-]{1,64}$")


class FailureMode(StrEnum):
    OPEN = "open"
    CLOSED = "closed"


@dataclass(frozen=True, slots=True)
class Limit:
    requests: int
    window_seconds: int

    def __post_init__(self) -> None:
        if self.requests < 1 or self.window_seconds < 1:
            raise ValueError("rate limit values must be positive")


@dataclass(frozen=True, slots=True)
class RateLimitDecision:
    allowed: bool
    retry_after: int = 0
    remaining: int = 0
    captcha_required: bool = False
    backend_available: bool = True
    reason: str | None = None


class RateLimiter(Protocol):
    async def hit(self, key: str, limit: Limit) -> RateLimitDecision: ...


_FIXED_WINDOW_SCRIPT = """
local current = redis.call('INCR', KEYS[1])
if current == 1 then
  redis.call('EXPIRE', KEYS[1], ARGV[1])
end
local ttl = redis.call('TTL', KEYS[1])
return {current, ttl}
"""


class RedisRateLimiter:
    """Атомарный ограничитель с фиксированным окном и явной политикой при сбое."""

    def __init__(
        self,
        redis: Redis,
        *,
        namespace: str = "trimmycrm:rl",
        failure_mode: FailureMode = FailureMode.OPEN,
    ) -> None:
        self.redis = redis
        self.namespace = namespace.rstrip(":")
        self.failure_mode = failure_mode

    async def hit(self, key: str, limit: Limit) -> RateLimitDecision:
        safe_key = _safe_fragment(key)
        redis_key = f"{self.namespace}:{safe_key}"
        try:
            result = await cast(
                Awaitable[Any],
                self.redis.eval(
                    _FIXED_WINDOW_SCRIPT,
                    1,
                    redis_key,
                    str(limit.window_seconds),
                ),
            )
            count, ttl = int(result[0]), max(1, int(result[1]))
            return RateLimitDecision(
                allowed=count <= limit.requests,
                retry_after=0 if count <= limit.requests else ttl,
                remaining=max(0, limit.requests - count),
                reason=None if count <= limit.requests else "rate_limited",
            )
        except RedisError:
            logger.exception("rate_limit_backend_unavailable", extra={"event": "redis_error"})
            allowed = self.failure_mode is FailureMode.OPEN
            return RateLimitDecision(
                allowed=allowed,
                retry_after=1 if not allowed else 0,
                backend_available=False,
                reason="limiter_unavailable",
            )


class AuthAbuseLimiter:
    """Ограничитель по IP и учётной записи с накопительным усилением защиты.

    По умолчанию аутентификация запрещает доступ при сбое: недоступность Redis
    не оставляет вход, регистрацию и сброс пароля без защиты. Вызывающая сторона
    должна преобразовать ``limiter_unavailable`` в статус 503, а не 429, и вызывать
    ``record_failure`` только после ошибки учётных данных или токена.
    """

    def __init__(
        self,
        redis: Redis,
        *,
        request_limit: Limit,
        failure_window_seconds: int,
        captcha_after: int,
        block_after: int,
        block_seconds: int,
        fail_closed: bool = True,
        namespace: str = "trimmycrm:auth",
    ) -> None:
        if captcha_after >= block_after:
            raise ValueError("captcha threshold must be below block threshold")
        self.redis = redis
        self.request_limit = request_limit
        self.failure_window = failure_window_seconds
        self.captcha_after = captcha_after
        self.block_after = block_after
        self.block_seconds = block_seconds
        self.fail_closed = fail_closed
        self.namespace = namespace.rstrip(":")
        self._requests = RedisRateLimiter(
            redis,
            namespace=f"{self.namespace}:requests",
            failure_mode=FailureMode.CLOSED if fail_closed else FailureMode.OPEN,
        )

    @classmethod
    def from_settings(cls, redis: Redis, settings: Settings) -> AuthAbuseLimiter:
        return cls(
            redis,
            request_limit=Limit(
                settings.rate_limit_auth_requests,
                settings.rate_limit_auth_window_seconds,
            ),
            failure_window_seconds=settings.auth_failure_window_seconds,
            captcha_after=settings.auth_captcha_after_failures,
            block_after=settings.auth_block_after_failures,
            block_seconds=settings.auth_block_seconds,
            fail_closed=settings.auth_rate_limit_fail_closed,
        )

    async def check(
        self,
        *,
        scope: str,
        client_ip: str,
        principal: str | None = None,
        captcha_passed: bool = False,
    ) -> RateLimitDecision:
        _validate_scope(scope)
        ip_key = _identity(client_ip)
        principal_key = _identity(_normalize_principal(principal)) if principal else None
        try:
            blocked_ttls = await self._blocked_ttls(scope, ip_key, principal_key)
            if blocked_ttls:
                return RateLimitDecision(
                    allowed=False,
                    retry_after=max(blocked_ttls),
                    remaining=0,
                    captcha_required=True,
                    reason="temporarily_blocked",
                )

            # Ограничиваются оба измерения. Смена почтовых адресов не позволяет
            # обойти лимит по IP, а атаки на учётную запись с разных IP также
            # остаются ограниченными.
            ip_decision = await self._requests.hit(f"{scope}:ip:{ip_key}", self.request_limit)
            if not ip_decision.backend_available:
                return ip_decision
            if not ip_decision.allowed:
                return ip_decision
            principal_decision = None
            if principal_key:
                principal_decision = await self._requests.hit(
                    f"{scope}:principal:{principal_key}", self.request_limit
                )
                if not principal_decision.backend_available or not principal_decision.allowed:
                    return principal_decision

            failures = await self._failure_count(scope, ip_key, principal_key)
            captcha_required = failures >= self.captcha_after
            if captcha_required and not captcha_passed:
                return RateLimitDecision(
                    allowed=False,
                    retry_after=0,
                    remaining=min(
                        ip_decision.remaining,
                        (
                            principal_decision.remaining
                            if principal_decision
                            else ip_decision.remaining
                        ),
                    ),
                    captcha_required=True,
                    reason="captcha_required",
                )
            return RateLimitDecision(
                allowed=True,
                remaining=min(
                    ip_decision.remaining,
                    principal_decision.remaining if principal_decision else ip_decision.remaining,
                ),
                captcha_required=captcha_required,
            )
        except RedisError:
            return self._backend_failure()

    async def record_failure(
        self, *, scope: str, client_ip: str, principal: str | None = None
    ) -> int:
        _validate_scope(scope)
        ip_key = _identity(client_ip)
        principal_key = _identity(_normalize_principal(principal)) if principal else None
        keys = [self._failure_key(scope, "ip", ip_key)]
        if principal_key:
            keys.append(self._failure_key(scope, "principal", principal_key))
        try:
            pipe = self.redis.pipeline(transaction=True)
            for key in keys:
                pipe.incr(key)
                pipe.expire(key, self.failure_window, nx=True)
            raw = await pipe.execute()
            counts = [int(raw[index]) for index in range(0, len(raw), 2)]
            highest = max(counts, default=0)
            if highest >= self.block_after:
                block_pipe = self.redis.pipeline(transaction=True)
                for key in keys:
                    block_key = key.replace(":fail:", ":block:", 1)
                    block_pipe.set(block_key, "1", ex=self.block_seconds)
                await block_pipe.execute()
            return highest
        except RedisError:
            logger.exception("auth_failure_counter_unavailable", extra={"event": "redis_error"})
            if self.fail_closed:
                raise
            return 0

    async def record_success(self, *, scope: str, principal: str | None = None) -> None:
        """Сбросить ошибки учётной записи, сохранив ошибки IP против перебора паролей."""

        if not principal:
            return
        _validate_scope(scope)
        principal_key = _identity(_normalize_principal(principal))
        try:
            await self.redis.delete(
                self._failure_key(scope, "principal", principal_key),
                self._block_key(scope, "principal", principal_key),
            )
        except RedisError:
            logger.exception("auth_success_counter_cleanup_failed", extra={"event": "redis_error"})

    async def _blocked_ttls(self, scope: str, ip_key: str, principal_key: str | None) -> list[int]:
        keys = [self._block_key(scope, "ip", ip_key)]
        if principal_key:
            keys.append(self._block_key(scope, "principal", principal_key))
        pipe = self.redis.pipeline(transaction=False)
        for key in keys:
            pipe.ttl(key)
        values = await pipe.execute()
        return [max(1, int(ttl)) for ttl in values if int(ttl) > 0]

    async def _failure_count(self, scope: str, ip_key: str, principal_key: str | None) -> int:
        keys = [self._failure_key(scope, "ip", ip_key)]
        if principal_key:
            keys.append(self._failure_key(scope, "principal", principal_key))
        values = await self.redis.mget(keys)
        return max((int(value or 0) for value in values), default=0)

    def _failure_key(self, scope: str, dimension: str, identity: str) -> str:
        return f"{self.namespace}:fail:{scope}:{dimension}:{identity}"

    def _block_key(self, scope: str, dimension: str, identity: str) -> str:
        return f"{self.namespace}:block:{scope}:{dimension}:{identity}"

    def _backend_failure(self) -> RateLimitDecision:
        logger.exception("auth_limiter_unavailable", extra={"event": "redis_error"})
        return RateLimitDecision(
            allowed=not self.fail_closed,
            retry_after=1 if self.fail_closed else 0,
            backend_available=False,
            reason="limiter_unavailable",
        )


def _normalize_principal(value: str | None) -> str:
    return (value or "").strip().casefold()


def _identity(value: str) -> str:
    return hashlib.sha256(value.encode("utf-8")).hexdigest()[:32]


def _safe_fragment(value: str) -> str:
    # Значения иногда содержат знаки пунктуации UUID или IP. Хеширование исключает
    # внедрение в ключ и ограничивает размер ключей Redis.
    return hashlib.sha256(value.encode("utf-8")).hexdigest()


def _validate_scope(scope: str) -> None:
    if not _SCOPE_RE.fullmatch(scope):
        raise ValueError("invalid rate-limit scope")
