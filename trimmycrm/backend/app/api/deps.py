from __future__ import annotations

import uuid
from collections.abc import AsyncIterator, Awaitable, Callable
from dataclasses import dataclass

from fastapi import Depends, Request, Security
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import Settings, get_settings
from app.core.errors import AuthenticationError, ForbiddenError, NotFoundError
from app.core.security import (
    AuthAudience,
    InvalidTokenError,
    JWTService,
    PasswordService,
    RefreshCookieManager,
    TokenClaims,
    bearer_token,
)
from app.db.session import AdminSession, RuntimeSession, set_rls_context
from app.models import (
    PlatformRole,
    PlatformUser,
    PlatformUserStatus,
    Site,
    Staff,
    TenantUser,
    TenantUserStatus,
)


@dataclass(frozen=True, slots=True)
class TenantContext:
    id: uuid.UUID
    host: str
    slug: str


access_token_scheme = HTTPBearer(
    auto_error=False,
    bearerFormat="JWT",
    scheme_name="BearerAuth",
    description="JWT access-токен платформы или клиента салона",
)


def settings_dep() -> Settings:
    return get_settings()


def jwt_service(settings: Settings = Depends(settings_dep)) -> JWTService:
    return JWTService(settings)


def password_service(settings: Settings = Depends(settings_dep)) -> PasswordService:
    return PasswordService.from_settings(settings)


def cookie_manager(settings: Settings = Depends(settings_dep)) -> RefreshCookieManager:
    return RefreshCookieManager(settings)


async def platform_db() -> AsyncIterator[AsyncSession]:
    async with RuntimeSession() as session:
        async with session.begin():
            await set_rls_context(session, None, platform_scope=True)
            yield session


def tenant_context(request: Request) -> TenantContext:
    tenant_id = getattr(request.state, "tenant_id", None)
    if tenant_id is None:
        raise NotFoundError("Салон не найден", code="tenant_not_found")
    return TenantContext(
        id=uuid.UUID(str(tenant_id)),
        host=str(getattr(request.state, "tenant_host", request.url.hostname or "")),
        slug=str(getattr(request.state, "tenant_slug", "")),
    )


async def tenant_db(
    context: TenantContext = Depends(tenant_context),
) -> AsyncIterator[AsyncSession]:
    async with RuntimeSession() as session:
        async with session.begin():
            await set_rls_context(session, context.id)
            yield session


def _claims(request: Request, service: JWTService, audience: AuthAudience) -> TokenClaims:
    try:
        return service.decode(bearer_token(request.headers), audience=audience)
    except InvalidTokenError as exc:
        raise AuthenticationError() from exc


def platform_claims(
    request: Request,
    service: JWTService = Depends(jwt_service),
    _credentials: HTTPAuthorizationCredentials | None = Security(access_token_scheme),
) -> TokenClaims:
    return _claims(request, service, AuthAudience.PLATFORM)


def tenant_claims(
    request: Request,
    context: TenantContext = Depends(tenant_context),
    service: JWTService = Depends(jwt_service),
    _credentials: HTTPAuthorizationCredentials | None = Security(access_token_scheme),
) -> TokenClaims:
    claims = _claims(request, service, AuthAudience.TENANT)
    if claims.tenant_id != context.id:
        raise ForbiddenError("Авторизация относится к другому салону", code="tenant_mismatch")
    return claims


async def current_platform_user(
    request: Request,
    claims: TokenClaims = Depends(platform_claims),
    session: AsyncSession = Depends(platform_db, scope="function"),
) -> PlatformUser:
    user = await session.get(PlatformUser, claims.subject)
    if user is None or user.status is not PlatformUserStatus.active:
        raise AuthenticationError("Учётная запись недоступна", code="account_unavailable")
    if claims.roles and user.role.value not in claims.roles:
        raise AuthenticationError("Права токена устарели", code="stale_token")
    request.state.audit_actor_id = user.id
    request.state.audit_actor_type = "platform_user"
    request.state.audit_actor_role = user.role.value
    return user


async def current_tenant_user(
    request: Request,
    claims: TokenClaims = Depends(tenant_claims),
    session: AsyncSession = Depends(tenant_db, scope="function"),
) -> TenantUser:
    user = await session.get(TenantUser, claims.subject)
    if user is None or user.status is not TenantUserStatus.active:
        raise AuthenticationError("Учётная запись недоступна", code="account_unavailable")
    request.state.audit_actor_id = user.id
    request.state.audit_actor_type = "tenant_user"
    request.state.audit_actor_role = "client"
    request.state.audit_tenant_id = user.tenant_id
    return user


def require_roles(*roles: PlatformRole) -> Callable[..., Awaitable[PlatformUser]]:
    async def dependency(user: PlatformUser = Depends(current_platform_user)) -> PlatformUser:
        if user.role not in roles:
            raise ForbiddenError()
        return user

    return dependency


require_owner = require_roles(PlatformRole.owner, PlatformRole.superadmin)
require_crm_actor = require_roles(PlatformRole.owner, PlatformRole.staff, PlatformRole.superadmin)
require_superadmin = require_roles(PlatformRole.superadmin)


async def actor_tenant_id(
    request: Request,
    user: PlatformUser = Depends(require_crm_actor),
) -> uuid.UUID:
    async with AdminSession() as session:
        if user.role in (PlatformRole.owner, PlatformRole.superadmin):
            value = await session.scalar(select(Site.id).where(Site.owner_id == user.id))
        else:
            value = await session.scalar(
                select(Staff.tenant_id).where(
                    Staff.user_id == user.id,
                    Staff.is_active.is_(True),
                )
            )
    if value is None:
        raise NotFoundError("Салон для пользователя не найден", code="tenant_membership_missing")
    request.state.audit_tenant_id = value
    return value


async def actor_tenant_db(
    tenant_id: uuid.UUID = Depends(actor_tenant_id),
) -> AsyncIterator[AsyncSession]:
    async with RuntimeSession() as session:
        async with session.begin():
            await set_rls_context(session, tenant_id)
            yield session


async def superadmin_db(
    _user: PlatformUser = Depends(require_superadmin),
) -> AsyncIterator[AsyncSession]:
    async with AdminSession() as session:
        async with session.begin():
            yield session
