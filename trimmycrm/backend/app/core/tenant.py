"""Безопасное определение тенанта по хосту и локальный контекст запроса."""

from __future__ import annotations

import contextvars
import hashlib
import hmac
import ipaddress
import json
import re
import uuid
from collections.abc import Sequence
from dataclasses import asdict, dataclass
from typing import Protocol, cast
from urllib.parse import urlsplit

from fastapi import Request
from redis.asyncio import Redis
from redis.exceptions import RedisError

_DNS_LABEL = re.compile(r"^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$")
_current_tenant: contextvars.ContextVar[TenantIdentity | None] = contextvars.ContextVar(
    "current_tenant", default=None
)


class InvalidHostError(ValueError):
    pass


class TenantNotFoundError(LookupError):
    pass


@dataclass(frozen=True, slots=True)
class TenantIdentity:
    id: uuid.UUID
    slug: str
    canonical_host: str
    status: str
    custom_domain: str | None = None

    @property
    def is_available(self) -> bool:
        return self.status in {"published", "draft"}


class TenantLookup(Protocol):
    """Граница репозитория, реализованная сервисом хранения сайтов."""

    async def find_by_slug(self, slug: str) -> TenantIdentity | None: ...

    async def find_by_custom_domain(self, domain: str) -> TenantIdentity | None: ...


def normalize_host(raw_host: str, *, allow_ip: bool = False) -> str:
    """Канонизировать значение Host и отклонить неоднозначные или внедряемые формы."""

    raw = raw_host.strip()
    if not raw or len(raw) > 512 or any(c in raw for c in "\r\n,/\\@#?"):
        raise InvalidHostError("invalid Host header")
    if "://" in raw or raw.count("[") != raw.count("]"):
        raise InvalidHostError("invalid Host header")
    try:
        parsed = urlsplit(f"//{raw}")
        # Обращение к .port выполняет строгую проверку целого числа и диапазона.
        _ = parsed.port
        hostname = parsed.hostname
    except ValueError as exc:
        raise InvalidHostError("invalid Host header") from exc
    if not hostname or parsed.username or parsed.password:
        raise InvalidHostError("invalid Host header")
    try:
        normalized = hostname.rstrip(".").encode("idna").decode("ascii").lower()
    except UnicodeError as exc:
        raise InvalidHostError("invalid internationalized host") from exc
    if not normalized or len(normalized) > 253:
        raise InvalidHostError("invalid host length")
    try:
        address = ipaddress.ip_address(normalized)
    except ValueError:
        address = None
    if address is not None:
        if not allow_ip:
            raise InvalidHostError("IP hosts are not accepted")
        return address.compressed
    if normalized == "localhost":
        if allow_ip:
            return normalized
        raise InvalidHostError("localhost is not accepted")
    labels = normalized.split(".")
    if len(labels) < 2 or any(not _DNS_LABEL.fullmatch(label) for label in labels):
        raise InvalidHostError("invalid DNS host")
    return normalized


def effective_host_from_request(
    request: Request,
    *,
    trusted_proxy_networks: Sequence[str] = (),
    internal_edge_token: str | None = None,
    edge_token_header: str = "X-Internal-Edge-Token",  # noqa: S107 - имя заголовка
    allow_ip: bool = False,
) -> str:
    """Выбрать Host, не доверяя переданным клиентом заголовкам перенаправления.

    ``X-Forwarded-Host`` используется только для доверенного непосредственного узла.
    Если настроен пограничный токен, он также должен совпасть; Nginx или Caddy должны
    перезаписывать этот заголовок. Несколько перенаправленных хостов отклоняются.
    """

    direct_host = request.headers.get("host", "")
    candidate = direct_host
    peer_is_trusted = False
    if request.client is not None:
        try:
            peer = ipaddress.ip_address(request.client.host)
            peer_is_trusted = any(
                peer in ipaddress.ip_network(network, strict=False)
                for network in trusted_proxy_networks
            )
        except ValueError as exc:
            raise InvalidHostError("invalid proxy network or peer") from exc
    if peer_is_trusted:
        token_ok = internal_edge_token is None or hmac.compare_digest(
            request.headers.get(edge_token_header, ""), internal_edge_token
        )
        forwarded = request.headers.get("x-forwarded-host")
        if forwarded and token_ok:
            if "," in forwarded:
                raise InvalidHostError("multiple forwarded hosts are not accepted")
            candidate = forwarded
    return normalize_host(candidate, allow_ip=allow_ip)


class TenantResolver:
    """Определять проверенные сопоставления хостов с ускорением через Redis.

    Redis используется только как кэш: при сбое запрос идёт в доверенный репозиторий.
    Записи кэша создаются исключительно из результатов репозитория, а входные данные
    поиска нормализуются до формирования ключа, чтобы исключить отравление кэша.
    """

    _NEGATIVE = b"-"

    def __init__(
        self,
        lookup: TenantLookup,
        redis: Redis,
        *,
        base_domains: Sequence[str],
        platform_hosts: Sequence[str] = (),
        reserved_slugs: Sequence[str] = (),
        cache_ttl_seconds: int = 300,
        negative_ttl_seconds: int = 30,
        allow_ip_hosts: bool = False,
    ) -> None:
        self.lookup = lookup
        self.redis = redis
        self.allow_ip_hosts = allow_ip_hosts
        self.base_domains = tuple(
            sorted(
                {normalize_host(host, allow_ip=allow_ip_hosts) for host in base_domains},
                key=len,
                reverse=True,
            )
        )
        self.platform_hosts = frozenset(
            normalize_host(host, allow_ip=allow_ip_hosts) for host in platform_hosts
        )
        self.reserved_slugs = frozenset(slug.strip().lower() for slug in reserved_slugs)
        self.cache_ttl = cache_ttl_seconds
        self.negative_ttl = negative_ttl_seconds

    async def resolve(self, raw_host: str) -> TenantIdentity | None:
        host = normalize_host(raw_host, allow_ip=self.allow_ip_hosts)
        if host in self.platform_hosts or host in self.base_domains:
            return None
        cached = await self._cache_get(host)
        if cached is not _CACHE_MISS:
            return cast(TenantIdentity | None, cached)

        slug = self._subdomain_slug(host)
        if slug is not None:
            if slug in self.reserved_slugs:
                await self._cache_put(host, None)
                return None
            tenant = await self.lookup.find_by_slug(slug)
            if tenant is not None:
                if tenant.slug.casefold() != slug:
                    raise RuntimeError("tenant repository returned a mismatched slug")
                # Один салон может обслуживаться на нескольких настроенных базовых
                # доменах. Доверенный поиск определяет сайт, а нормализованный запрос
                # предоставляет канонический псевдоним хоста.
                tenant = TenantIdentity(
                    id=tenant.id,
                    slug=tenant.slug,
                    canonical_host=host,
                    status=tenant.status,
                    custom_domain=tenant.custom_domain,
                )
            tenant = self._verify_repository_result(tenant, host=host)
        else:
            tenant = await self.lookup.find_by_custom_domain(host)
            tenant = self._verify_repository_result(tenant, host=host, expected_custom_domain=host)
        await self._cache_put(host, tenant)
        return tenant

    async def require(self, raw_host: str) -> TenantIdentity:
        tenant = await self.resolve(raw_host)
        if tenant is None:
            raise TenantNotFoundError("tenant host is unknown")
        return tenant

    async def invalidate(self, *hosts: str) -> None:
        keys = [
            self._cache_key(normalize_host(host, allow_ip=self.allow_ip_hosts)) for host in hosts
        ]
        if not keys:
            return
        try:
            await self.redis.delete(*keys)
        except RedisError:
            # Инвалидация кэша выполняется по возможности. Короткий TTL и доверенные
            # проверки БД при промахах ограничивают время жизни устаревшего сопоставления.
            return

    def _subdomain_slug(self, host: str) -> str | None:
        for base_domain in self.base_domains:
            suffix = f".{base_domain}"
            if host.endswith(suffix):
                prefix = host[: -len(suffix)]
                # Продукт обещает адрес строго вида slug.trimmycrm.ru. Вложенные имена
                # под контролем злоумышленника не обрезаются молча до слага тенанта.
                if prefix and "." not in prefix and _DNS_LABEL.fullmatch(prefix):
                    return prefix
                return None
        return None

    def _verify_repository_result(
        self,
        tenant: TenantIdentity | None,
        *,
        host: str,
        expected_slug: str | None = None,
        expected_custom_domain: str | None = None,
    ) -> TenantIdentity | None:
        if tenant is None:
            return None
        if expected_slug is not None and tenant.slug.casefold() != expected_slug:
            raise RuntimeError("tenant repository returned a mismatched slug")
        if expected_custom_domain is not None:
            if (
                not tenant.custom_domain
                or normalize_host(tenant.custom_domain, allow_ip=self.allow_ip_hosts)
                != expected_custom_domain
            ):
                raise RuntimeError("tenant repository returned an unverified domain mapping")
        if normalize_host(tenant.canonical_host, allow_ip=self.allow_ip_hosts) != host:
            raise RuntimeError("tenant repository returned a mismatched canonical host")
        return tenant

    async def _cache_get(self, host: str) -> object:
        try:
            raw = await self.redis.get(self._cache_key(host))
        except RedisError:
            return _CACHE_MISS
        if raw is None:
            return _CACHE_MISS
        if raw in {self._NEGATIVE, self._NEGATIVE.decode()}:
            return None
        try:
            data = json.loads(raw)
            tenant = TenantIdentity(
                id=uuid.UUID(data["id"]),
                slug=str(data["slug"]),
                canonical_host=str(data["canonical_host"]),
                status=str(data["status"]),
                custom_domain=data.get("custom_domain"),
            )
            return self._verify_repository_result(tenant, host=host)
        except (KeyError, TypeError, ValueError, json.JSONDecodeError, RuntimeError):
            try:
                await self.redis.delete(self._cache_key(host))
            except RedisError:
                return _CACHE_MISS
            return _CACHE_MISS

    async def _cache_put(self, host: str, tenant: TenantIdentity | None) -> None:
        value: str | bytes
        ttl: int
        if tenant is None:
            value, ttl = self._NEGATIVE, self.negative_ttl
        else:
            payload = asdict(tenant)
            payload["id"] = str(tenant.id)
            value = json.dumps(payload, separators=(",", ":"))
            ttl = self.cache_ttl
        try:
            await self.redis.set(self._cache_key(host), value, ex=ttl)
        except RedisError:
            return

    @staticmethod
    def _cache_key(host: str) -> str:
        digest = hashlib.sha256(host.encode("ascii")).hexdigest()
        return f"trimmycrm:tenant-host:{digest}"


_CACHE_MISS = object()


def set_current_tenant(
    tenant: TenantIdentity | None,
) -> contextvars.Token[TenantIdentity | None]:
    return _current_tenant.set(tenant)


def reset_current_tenant(token: contextvars.Token[TenantIdentity | None]) -> None:
    _current_tenant.reset(token)


def get_current_tenant(*, required: bool = True) -> TenantIdentity | None:
    tenant = _current_tenant.get()
    if tenant is None and required:
        raise TenantNotFoundError("tenant context is not set")
    return tenant
