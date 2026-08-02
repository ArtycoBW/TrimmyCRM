from __future__ import annotations

from datetime import UTC, datetime

from fastapi import APIRouter, BackgroundTasks, Depends, Request, Response, status
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import (
    TenantContext,
    cookie_manager,
    current_tenant_user,
    jwt_service,
    password_service,
    settings_dep,
    tenant_context,
    tenant_db,
)
from app.core.config import Settings
from app.core.errors import BadRequestError, ServiceUnavailableError
from app.core.legal import LEGAL_DOCUMENT_VERSION
from app.core.security import JWTService, PasswordService, RefreshCookieManager
from app.integrations.storage import StorageError
from app.models import (
    AuthTokenType,
    AuthUserType,
    Site,
    TenantUser,
    TenantUserStatus,
)
from app.schemas import (
    AuthResponse,
    ChangePassword,
    EmailRequest,
    Login,
    Message,
    Registration,
    ResetPassword,
    TokenRequest,
    UserView,
)
from app.services.access import lock_tenant_quota, plan_access_for_tenant
from app.services.authentication import (
    consume_one_time_token,
    create_one_time_token,
    duplicate_email_error,
    enforce_auth_rate_limit,
    ensure_tenant_login_allowed,
    issue_session_tokens,
    revoke_all_user_sessions,
    revoke_refresh,
    rotate_refresh_token,
    verify_password_or_raise,
)
from app.services.privacy import (
    anonymize_tenant_user,
    erase_tenant_user_media,
    tenant_user_media_keys,
)
from app.tasks.jobs import enqueue_auth_email

router = APIRouter(prefix="/t/auth", tags=["tenant auth"])


@router.post("/register", status_code=status.HTTP_201_CREATED)
async def register(
    payload: Registration,
    request: Request,
    background: BackgroundTasks,
    context: TenantContext = Depends(tenant_context),
    session: AsyncSession = Depends(tenant_db, scope="function"),
    passwords: PasswordService = Depends(password_service),
    settings: Settings = Depends(settings_dep),
) -> dict[str, object]:
    email = str(payload.email).strip().lower()
    await enforce_auth_rate_limit(
        request,
        scope="tenant_register",
        principal=f"{context.id}:{email}",
        settings=settings,
    )
    user = await session.scalar(
        select(TenantUser).where(TenantUser.tenant_id == context.id, TenantUser.email == email)
    )
    if user is not None and not (
        user.status is TenantUserStatus.crm_only and user.password_hash is None
    ):
        raise duplicate_email_error()
    if user is None:
        await lock_tenant_quota(session, context.id, "clients")
        access = await plan_access_for_tenant(session, context.id)
        limit = access.limit("clients")
        count = int(
            await session.scalar(
                select(func.count())
                .select_from(TenantUser)
                .where(TenantUser.tenant_id == context.id)
            )
            or 0
        )
        if limit is not None and count >= limit:
            from app.core.errors import ConflictError

            raise ConflictError(
                "Салон достиг лимита клиентских профилей",
                code="client_limit_reached",
            )
        user = TenantUser(tenant_id=context.id, email=email)
        session.add(user)
    user.password_hash = passwords.hash(payload.password, email=email)
    user.phone = payload.phone
    user.status = TenantUserStatus.pending
    user.email_verified = False
    user.personal_data_consent_at = datetime.now(UTC)
    user.personal_data_consent_version = LEGAL_DOCUMENT_VERSION
    await session.flush()
    token = create_one_time_token(
        session,
        user_type=AuthUserType.tenant,
        user_id=user.id,
        token_type=AuthTokenType.email_verify,
        settings=settings,
        tenant_id=context.id,
    )
    tenant_name = await session.scalar(select(Site.name).where(Site.id == context.id))
    background.add_task(
        enqueue_auth_email, "tenant_verify", email, token, context.host, tenant_name
    )
    return {"id": user.id, "email": user.email, "status": user.status.value}


@router.post("/verify-email", response_model=Message)
async def verify_email(
    payload: TokenRequest,
    context: TenantContext = Depends(tenant_context),
    session: AsyncSession = Depends(tenant_db, scope="function"),
    settings: Settings = Depends(settings_dep),
) -> Message:
    token = await consume_one_time_token(
        session,
        raw_token=payload.token,
        user_type=AuthUserType.tenant,
        token_type=AuthTokenType.email_verify,
        settings=settings,
        tenant_id=context.id,
    )
    user = await session.get(TenantUser, token.user_id, with_for_update=True)
    if user is None:
        raise BadRequestError("Токен недействителен", code="invalid_auth_token")
    user.email_verified = True
    user.status = TenantUserStatus.active
    return Message(message="Email подтверждён")


@router.post("/resend-verification", response_model=Message)
async def resend_verification(
    payload: EmailRequest,
    request: Request,
    background: BackgroundTasks,
    context: TenantContext = Depends(tenant_context),
    session: AsyncSession = Depends(tenant_db, scope="function"),
    settings: Settings = Depends(settings_dep),
) -> Message:
    email = str(payload.email).strip().lower()
    await enforce_auth_rate_limit(
        request,
        scope="tenant_resend",
        principal=f"{context.id}:{email}",
        settings=settings,
    )
    user = await session.scalar(
        select(TenantUser).where(TenantUser.tenant_id == context.id, TenantUser.email == email)
    )
    if user is not None and not user.email_verified and user.status is TenantUserStatus.pending:
        token = create_one_time_token(
            session,
            user_type=AuthUserType.tenant,
            user_id=user.id,
            token_type=AuthTokenType.email_verify,
            settings=settings,
            tenant_id=context.id,
        )
        tenant_name = await session.scalar(select(Site.name).where(Site.id == context.id))
        background.add_task(
            enqueue_auth_email, "tenant_verify", email, token, context.host, tenant_name
        )
    return Message(message="Если аккаунт существует, письмо будет отправлено")


@router.post("/login", response_model=AuthResponse)
async def login(
    payload: Login,
    request: Request,
    response: Response,
    context: TenantContext = Depends(tenant_context),
    session: AsyncSession = Depends(tenant_db, scope="function"),
    passwords: PasswordService = Depends(password_service),
    jwt: JWTService = Depends(jwt_service),
    cookies: RefreshCookieManager = Depends(cookie_manager),
    settings: Settings = Depends(settings_dep),
) -> AuthResponse:
    email = str(payload.email).strip().lower()
    principal = f"{context.id}:{email}"
    limiter, client_ip = await enforce_auth_rate_limit(
        request,
        scope="tenant_login",
        principal=principal,
        settings=settings,
        captcha_token=payload.captchaToken,
    )
    user = await session.scalar(
        select(TenantUser).where(TenantUser.tenant_id == context.id, TenantUser.email == email)
    )
    try:
        if user is None:
            from app.core.errors import AuthenticationError

            raise AuthenticationError("Неверный email или пароль", code="invalid_credentials")
        verify_password_or_raise(
            passwords, password_hash=user.password_hash, candidate=payload.password
        )
        ensure_tenant_login_allowed(user)
    except Exception as exc:
        from app.core.errors import AuthenticationError

        if not isinstance(exc, AuthenticationError):
            raise
        await limiter.record_failure(scope="tenant_login", client_ip=client_ip, principal=principal)
        raise
    user.last_login_at = datetime.now(UTC)
    access, refresh = issue_session_tokens(
        session,
        jwt=jwt,
        settings=settings,
        user_id=user.id,
        realm="tenant",
        tenant_id=context.id,
    )
    cookies.set(response, refresh)
    await limiter.record_success(scope="tenant_login", principal=principal)
    return AuthResponse(accessToken=access, expiresIn=settings.access_token_ttl_seconds)


@router.post("/refresh", response_model=AuthResponse)
async def refresh(
    request: Request,
    response: Response,
    session: AsyncSession = Depends(tenant_db, scope="function"),
    jwt: JWTService = Depends(jwt_service),
    cookies: RefreshCookieManager = Depends(cookie_manager),
    settings: Settings = Depends(settings_dep),
) -> AuthResponse:
    cookies.validate_request(request)
    access, new_refresh = await rotate_refresh_token(
        session,
        raw_token=cookies.refresh_token(request),
        realm="tenant",
        jwt=jwt,
        settings=settings,
    )
    cookies.set(response, new_refresh)
    return AuthResponse(accessToken=access, expiresIn=settings.access_token_ttl_seconds)


@router.post("/logout", response_model=Message)
async def logout(
    request: Request,
    response: Response,
    session: AsyncSession = Depends(tenant_db, scope="function"),
    jwt: JWTService = Depends(jwt_service),
    cookies: RefreshCookieManager = Depends(cookie_manager),
    settings: Settings = Depends(settings_dep),
) -> Message:
    cookies.validate_request(request)
    raw = request.cookies.get(cookies.name)
    if raw:
        await revoke_refresh(session, raw_token=raw, realm="tenant", jwt=jwt, settings=settings)
    cookies.clear(response)
    return Message(message="Сессия завершена")


@router.post("/forgot-password", response_model=Message)
async def forgot_password(
    payload: EmailRequest,
    request: Request,
    background: BackgroundTasks,
    context: TenantContext = Depends(tenant_context),
    session: AsyncSession = Depends(tenant_db, scope="function"),
    settings: Settings = Depends(settings_dep),
) -> Message:
    email = str(payload.email).strip().lower()
    await enforce_auth_rate_limit(
        request,
        scope="tenant_forgot",
        principal=f"{context.id}:{email}",
        settings=settings,
    )
    user = await session.scalar(
        select(TenantUser).where(TenantUser.tenant_id == context.id, TenantUser.email == email)
    )
    if user is not None and user.password_hash and user.status is not TenantUserStatus.blocked:
        token = create_one_time_token(
            session,
            user_type=AuthUserType.tenant,
            user_id=user.id,
            token_type=AuthTokenType.password_reset,
            settings=settings,
            tenant_id=context.id,
        )
        tenant_name = await session.scalar(select(Site.name).where(Site.id == context.id))
        background.add_task(
            enqueue_auth_email, "tenant_reset", email, token, context.host, tenant_name
        )
    return Message(message="Если аккаунт существует, письмо будет отправлено")


@router.post("/reset-password", response_model=Message)
async def reset_password(
    payload: ResetPassword,
    context: TenantContext = Depends(tenant_context),
    session: AsyncSession = Depends(tenant_db, scope="function"),
    passwords: PasswordService = Depends(password_service),
    settings: Settings = Depends(settings_dep),
) -> Message:
    token = await consume_one_time_token(
        session,
        raw_token=payload.token,
        user_type=AuthUserType.tenant,
        token_type=AuthTokenType.password_reset,
        settings=settings,
        tenant_id=context.id,
    )
    user = await session.get(TenantUser, token.user_id, with_for_update=True)
    if user is None or user.status is TenantUserStatus.blocked or user.email is None:
        raise BadRequestError("Токен недействителен", code="invalid_auth_token")
    user.password_hash = passwords.hash(payload.password, email=user.email)
    await revoke_all_user_sessions(session, user_type=AuthUserType.tenant, user_id=user.id)
    return Message(message="Пароль изменён")


@router.post("/change-password", response_model=Message)
async def change_password(
    payload: ChangePassword,
    user: TenantUser = Depends(current_tenant_user),
    session: AsyncSession = Depends(tenant_db, scope="function"),
    passwords: PasswordService = Depends(password_service),
) -> Message:
    verify_password_or_raise(
        passwords, password_hash=user.password_hash, candidate=payload.oldPassword
    )
    user.password_hash = passwords.hash(payload.newPassword, email=user.email)
    await revoke_all_user_sessions(session, user_type=AuthUserType.tenant, user_id=user.id)
    return Message(message="Пароль изменён; активные сессии завершены")


@router.get("/me", response_model=UserView)
async def me(user: TenantUser = Depends(current_tenant_user)) -> UserView:
    return UserView.model_validate(
        {
            **user.__dict__,
            "role": None,
            "tenant_id": user.tenant_id,
        }
    )


@router.delete("/me", response_model=Message)
async def delete_personal_data(
    request: Request,
    user: TenantUser = Depends(current_tenant_user),
    session: AsyncSession = Depends(tenant_db, scope="function"),
) -> Message:
    storage = getattr(request.app.state, "storage", None)
    if storage is None:
        raise ServiceUnavailableError(
            "Хранилище медиа временно недоступно", code="media_storage_unavailable"
        )
    try:
        await erase_tenant_user_media(
            storage,
            tenant_id=user.tenant_id,
            keys=await tenant_user_media_keys(session, user),
        )
    except (StorageError, ValueError) as exc:
        raise ServiceUnavailableError(
            "Хранилище медиа временно недоступно", code="media_storage_unavailable"
        ) from exc
    await anonymize_tenant_user(session, user)
    await revoke_all_user_sessions(session, user_type=AuthUserType.tenant, user_id=user.id)
    return Message(message="Персональные данные обезличены")
