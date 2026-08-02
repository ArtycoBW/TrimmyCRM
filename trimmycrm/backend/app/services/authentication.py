from __future__ import annotations

import uuid
from datetime import UTC, datetime, timedelta
from typing import Literal

from fastapi import Request
from redis.asyncio import Redis
from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import Settings
from app.core.errors import (
    AuthenticationError,
    BadRequestError,
    ConflictError,
    RateLimitError,
    ServiceUnavailableError,
)
from app.core.rate_limit import AuthAbuseLimiter
from app.core.security import (
    AuthAudience,
    JWTService,
    PasswordService,
    TokenType,
    client_ip_from_request,
    generate_opaque_token,
    hash_opaque_token,
)
from app.integrations.captcha import build_captcha_verifier
from app.models import (
    AuthToken,
    AuthTokenType,
    AuthUserType,
    PlatformUser,
    PlatformUserStatus,
    RefreshToken,
    TenantUser,
    TenantUserStatus,
)

Realm = Literal["platform", "tenant"]


async def enforce_auth_rate_limit(
    request: Request,
    *,
    scope: str,
    principal: str | None,
    settings: Settings,
    captcha_token: str | None = None,
) -> tuple[AuthAbuseLimiter, str]:
    redis: Redis = request.app.state.redis
    client_ip = str(client_ip_from_request(request, settings.trusted_proxy_networks))
    token = captcha_token or request.headers.get("x-captcha-token")
    captcha_passed = False
    if token:
        verifier = build_captcha_verifier(settings)
        result = await verifier.verify(token, remote_ip=client_ip, action=scope)
        close = getattr(verifier, "aclose", None)
        if close is not None:
            await close()
        captcha_passed = result.valid
        if not result.provider_available:
            raise ServiceUnavailableError(
                "Сервис проверки временно недоступен", code="captcha_unavailable"
            )

    limiter = AuthAbuseLimiter.from_settings(redis, settings)
    decision = await limiter.check(
        scope=scope,
        client_ip=client_ip,
        principal=principal,
        captcha_passed=captcha_passed,
    )
    if not decision.backend_available:
        raise ServiceUnavailableError(
            "Защита авторизации временно недоступна", code="auth_guard_unavailable"
        )
    if not decision.allowed:
        raise RateLimitError(decision.retry_after or 1, captcha_required=decision.captcha_required)
    return limiter, client_ip


def create_one_time_token(
    session: AsyncSession,
    *,
    user_type: AuthUserType,
    user_id: uuid.UUID,
    token_type: AuthTokenType,
    settings: Settings,
    tenant_id: uuid.UUID | None = None,
) -> str:
    raw = generate_opaque_token()
    ttl = (
        getattr(settings, "email_verification_ttl_seconds", 86_400)
        if token_type is AuthTokenType.email_verify
        else getattr(settings, "password_reset_ttl_seconds", 3_600)
    )
    session.add(
        AuthToken(
            tenant_id=tenant_id,
            user_type=user_type,
            user_id=user_id,
            type=token_type,
            token_hash=hash_opaque_token(raw, settings.auth_token_pepper.get_secret_value()),
            expires_at=datetime.now(UTC) + timedelta(seconds=ttl),
        )
    )
    return raw


async def consume_one_time_token(
    session: AsyncSession,
    *,
    raw_token: str,
    user_type: AuthUserType,
    token_type: AuthTokenType,
    settings: Settings,
    tenant_id: uuid.UUID | None = None,
) -> AuthToken:
    digest = hash_opaque_token(raw_token, settings.auth_token_pepper.get_secret_value())
    token = await session.scalar(
        select(AuthToken)
        .where(
            AuthToken.token_hash == digest,
            AuthToken.user_type == user_type,
            AuthToken.type == token_type,
            AuthToken.tenant_id.is_(None)
            if tenant_id is None
            else AuthToken.tenant_id == tenant_id,
        )
        .with_for_update()
    )
    now = datetime.now(UTC)
    if token is None or token.used_at is not None or token.expires_at <= now:
        raise BadRequestError("Токен недействителен или истёк", code="invalid_auth_token")
    token.used_at = now
    return token


def issue_session_tokens(
    session: AsyncSession,
    *,
    jwt: JWTService,
    settings: Settings,
    user_id: uuid.UUID,
    realm: Realm,
    tenant_id: uuid.UUID | None = None,
    roles: tuple[str, ...] = (),
    family_id: uuid.UUID | None = None,
) -> tuple[str, str]:
    audience = AuthAudience.PLATFORM if realm == "platform" else AuthAudience.TENANT
    access = jwt.issue_access(
        subject=user_id,
        audience=audience,
        tenant_id=tenant_id,
        roles=roles,
    )
    refresh = jwt.issue_refresh(subject=user_id, audience=audience, tenant_id=tenant_id)
    session.add(
        RefreshToken(
            tenant_id=tenant_id,
            user_type=AuthUserType.platform if realm == "platform" else AuthUserType.tenant,
            user_id=user_id,
            jti=refresh.jti,
            family_id=family_id or uuid.uuid4(),
            token_hash=hash_opaque_token(
                refresh.token, settings.auth_token_pepper.get_secret_value()
            ),
            expires_at=refresh.expires_at,
        )
    )
    return access.token, refresh.token


async def rotate_refresh_token(
    session: AsyncSession,
    *,
    raw_token: str,
    realm: Realm,
    jwt: JWTService,
    settings: Settings,
) -> tuple[str, str]:
    audience = AuthAudience.PLATFORM if realm == "platform" else AuthAudience.TENANT
    try:
        claims = jwt.decode(raw_token, audience=audience, token_type=TokenType.REFRESH)
    except Exception as exc:
        raise AuthenticationError("Refresh-токен недействителен", code="invalid_refresh") from exc
    row = await session.scalar(
        select(RefreshToken).where(RefreshToken.jti == claims.jti).with_for_update()
    )
    digest = hash_opaque_token(raw_token, settings.auth_token_pepper.get_secret_value())
    now = datetime.now(UTC)
    if row is None or row.token_hash != digest or row.expires_at <= now:
        raise AuthenticationError("Refresh-токен недействителен", code="invalid_refresh")
    if row.revoked_at is not None:
        await session.execute(
            update(RefreshToken)
            .where(RefreshToken.family_id == row.family_id, RefreshToken.revoked_at.is_(None))
            .values(revoked_at=now)
        )
        # Этот защитный побочный эффект должен сохраниться после ответа 401 ниже.
        # Эндпоинты обновления токена до этого ничего не записывают, поэтому явный
        # фиксация безопасно сохраняет отзыв семейства токенов и освобождает блокировку
        # строки до того, как FastAPI завершит управляемую транзакцию.
        await session.commit()
        raise AuthenticationError("Обнаружено повторное использование сессии", code="refresh_reuse")

    roles: tuple[str, ...]
    if realm == "platform":
        platform_user = await session.get(PlatformUser, row.user_id)
        if platform_user is None or platform_user.status is not PlatformUserStatus.active:
            raise AuthenticationError("Учётная запись недоступна", code="account_unavailable")
        roles = (platform_user.role.value,)
    else:
        tenant_user = await session.get(TenantUser, row.user_id)
        if tenant_user is None or tenant_user.status is not TenantUserStatus.active:
            raise AuthenticationError("Учётная запись недоступна", code="account_unavailable")
        roles = ()

    access = jwt.issue_access(
        subject=row.user_id,
        audience=audience,
        tenant_id=row.tenant_id,
        roles=roles,
    )
    refresh = jwt.issue_refresh(subject=row.user_id, audience=audience, tenant_id=row.tenant_id)
    row.revoked_at = now
    row.replaced_by_jti = refresh.jti
    session.add(
        RefreshToken(
            tenant_id=row.tenant_id,
            user_type=row.user_type,
            user_id=row.user_id,
            jti=refresh.jti,
            family_id=row.family_id,
            token_hash=hash_opaque_token(
                refresh.token, settings.auth_token_pepper.get_secret_value()
            ),
            expires_at=refresh.expires_at,
        )
    )
    return access.token, refresh.token


async def revoke_refresh(
    session: AsyncSession,
    *,
    raw_token: str,
    realm: Realm,
    jwt: JWTService,
    settings: Settings,
) -> None:
    audience = AuthAudience.PLATFORM if realm == "platform" else AuthAudience.TENANT
    try:
        claims = jwt.decode(raw_token, audience=audience, token_type=TokenType.REFRESH)
    except Exception:
        return
    digest = hash_opaque_token(raw_token, settings.auth_token_pepper.get_secret_value())
    row = await session.scalar(
        select(RefreshToken).where(RefreshToken.jti == claims.jti).with_for_update()
    )
    if row is not None and row.token_hash == digest and row.revoked_at is None:
        row.revoked_at = datetime.now(UTC)


async def revoke_all_user_sessions(
    session: AsyncSession, *, user_type: AuthUserType, user_id: uuid.UUID
) -> None:
    await session.execute(
        update(RefreshToken)
        .where(
            RefreshToken.user_type == user_type,
            RefreshToken.user_id == user_id,
            RefreshToken.revoked_at.is_(None),
        )
        .values(revoked_at=datetime.now(UTC))
    )


def verify_password_or_raise(
    passwords: PasswordService,
    *,
    password_hash: str | None,
    candidate: str,
) -> None:
    if password_hash is None or not passwords.verify(password_hash, candidate):
        raise AuthenticationError("Неверный email или пароль", code="invalid_credentials")


def ensure_platform_login_allowed(user: PlatformUser) -> None:
    if user.status is PlatformUserStatus.blocked:
        raise AuthenticationError("Учётная запись заблокирована", code="account_blocked")
    if not user.email_verified or user.status is PlatformUserStatus.pending:
        raise AuthenticationError("Подтвердите email", code="email_not_verified")


def ensure_tenant_login_allowed(user: TenantUser) -> None:
    if user.status is TenantUserStatus.blocked:
        raise AuthenticationError("Учётная запись заблокирована", code="account_blocked")
    if not user.email_verified or user.status in {
        TenantUserStatus.pending,
        TenantUserStatus.crm_only,
    }:
        raise AuthenticationError("Подтвердите email", code="email_not_verified")


def duplicate_email_error() -> ConflictError:
    return ConflictError("Пользователь с таким email уже существует", code="email_exists")
