from __future__ import annotations

from datetime import UTC, datetime, timedelta

from fastapi import APIRouter, BackgroundTasks, Depends, Request, Response, status
from sqlalchemy import desc, select, update
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import (
    cookie_manager,
    current_platform_user,
    jwt_service,
    password_service,
    platform_db,
    settings_dep,
)
from app.core.config import Settings
from app.core.errors import AuthenticationError, BadRequestError, ConflictError
from app.core.legal import LEGAL_DOCUMENT_VERSION
from app.core.security import JWTService, PasswordService, RefreshCookieManager
from app.db.session import AdminSession
from app.models import (
    AuthTokenType,
    AuthUserType,
    Plan,
    PlatformRole,
    PlatformUser,
    PlatformUserStatus,
    Site,
    SiteStatus,
    Staff,
    Subscription,
    SubscriptionStatus,
)
from app.schemas import (
    AuthResponse,
    ChangePassword,
    DashboardTourClaim,
    EmailRequest,
    Login,
    MeResponse,
    Message,
    PlatformRegistration,
    ResetPassword,
    SubscriptionView,
    TokenRequest,
    UserView,
)
from app.services.authentication import (
    consume_one_time_token,
    create_one_time_token,
    duplicate_email_error,
    enforce_auth_rate_limit,
    ensure_platform_login_allowed,
    issue_session_tokens,
    revoke_all_user_sessions,
    revoke_refresh,
    rotate_refresh_token,
    verify_password_or_raise,
)
from app.services.sites import salon_profile_defaults, unique_slug
from app.tasks.jobs import enqueue_auth_email

router = APIRouter(prefix="/auth", tags=["platform auth"])


@router.post("/register", status_code=status.HTTP_201_CREATED)
async def register(
    payload: PlatformRegistration,
    request: Request,
    background: BackgroundTasks,
    session: AsyncSession = Depends(platform_db, scope="function"),
    passwords: PasswordService = Depends(password_service),
    settings: Settings = Depends(settings_dep),
) -> dict[str, object]:
    await enforce_auth_rate_limit(
        request, scope="platform_register", principal=str(payload.email), settings=settings
    )
    email = str(payload.email).strip().lower()
    if await session.scalar(select(PlatformUser.id).where(PlatformUser.email == email)):
        raise duplicate_email_error()
    try:
        now = datetime.now(UTC)
        user = PlatformUser(
            email=email,
            phone=payload.phone,
            password_hash=passwords.hash(payload.password, email=email),
            role=PlatformRole.owner,
            status=PlatformUserStatus.pending,
            email_verified=False,
            personal_data_consent_at=now,
            personal_data_consent_version=LEGAL_DOCUMENT_VERSION,
            terms_accepted_at=now,
            terms_version=LEGAL_DOCUMENT_VERSION,
            data_processing_instruction_accepted_at=now,
            data_processing_instruction_version=LEGAL_DOCUMENT_VERSION,
        )
        session.add(user)
        await session.flush()
        profile = salon_profile_defaults(payload.salonType)
        site = Site(
            owner_id=user.id,
            name=payload.salonName,
            slug=await unique_slug(
                session,
                payload.salonName,
                reserved=set(settings.reserved_tenant_slugs),
            ),
            salon_type=payload.salonType,
            service_focuses=profile["service_focuses"],
            locale="ru-RU",
            currency="RUB",
            city=payload.city,
            timezone=payload.timezone,
            status=SiteStatus.draft,
            work_hours={},
            socials={},
            theme=profile["theme"],
            template_key=profile["template_key"],
        )
        session.add(site)
        await session.flush()
        plan = await session.scalar(
            select(Plan).where(Plan.code == "start", Plan.is_active.is_(True))
        )
        if plan is None:
            raise BadRequestError("Тариф Start не настроен", code="plan_not_configured")
        session.add(
            Subscription(
                owner_id=user.id,
                plan_id=plan.id,
                status=SubscriptionStatus.trialing,
                current_period_start=now,
                current_period_end=now + timedelta(days=getattr(settings, "trial_days", 14)),
                auto_renew=True,
            )
        )
        token = create_one_time_token(
            session,
            user_type=AuthUserType.platform,
            user_id=user.id,
            token_type=AuthTokenType.email_verify,
            settings=settings,
        )
        background.add_task(enqueue_auth_email, "platform_verify", email, token, None)
        return {
            "id": user.id,
            "email": user.email,
            "status": user.status.value,
            "siteId": site.id,
            "salonType": site.salon_type.value,
        }
    except IntegrityError as exc:
        raise duplicate_email_error() from exc


@router.post("/verify-email", response_model=Message)
async def verify_email(
    payload: TokenRequest,
    session: AsyncSession = Depends(platform_db, scope="function"),
    settings: Settings = Depends(settings_dep),
) -> Message:
    token = await consume_one_time_token(
        session,
        raw_token=payload.token,
        user_type=AuthUserType.platform,
        token_type=AuthTokenType.email_verify,
        settings=settings,
    )
    user = await session.get(PlatformUser, token.user_id, with_for_update=True)
    if user is None:
        raise BadRequestError("Токен недействителен", code="invalid_auth_token")
    user.email_verified = True
    user.status = PlatformUserStatus.active
    return Message(message="Email подтверждён")


@router.post("/resend-verification", response_model=Message)
async def resend_verification(
    payload: EmailRequest,
    request: Request,
    background: BackgroundTasks,
    session: AsyncSession = Depends(platform_db, scope="function"),
    settings: Settings = Depends(settings_dep),
) -> Message:
    await enforce_auth_rate_limit(
        request, scope="platform_resend", principal=str(payload.email), settings=settings
    )
    user = await session.scalar(
        select(PlatformUser).where(PlatformUser.email == str(payload.email))
    )
    if user is not None and not user.email_verified and user.status is PlatformUserStatus.pending:
        token = create_one_time_token(
            session,
            user_type=AuthUserType.platform,
            user_id=user.id,
            token_type=AuthTokenType.email_verify,
            settings=settings,
        )
        background.add_task(enqueue_auth_email, "platform_verify", user.email, token, None)
    return Message(message="Если аккаунт существует, письмо будет отправлено")


@router.post("/login", response_model=AuthResponse)
async def login(
    payload: Login,
    request: Request,
    response: Response,
    session: AsyncSession = Depends(platform_db, scope="function"),
    passwords: PasswordService = Depends(password_service),
    jwt: JWTService = Depends(jwt_service),
    cookies: RefreshCookieManager = Depends(cookie_manager),
    settings: Settings = Depends(settings_dep),
) -> AuthResponse:
    email = str(payload.email).strip().lower()
    limiter, client_ip = await enforce_auth_rate_limit(
        request,
        scope="platform_login",
        principal=email,
        settings=settings,
        captcha_token=payload.captchaToken,
    )
    user = await session.scalar(select(PlatformUser).where(PlatformUser.email == email))
    try:
        if user is None:
            raise AuthenticationError("Неверный email или пароль", code="invalid_credentials")
        verify_password_or_raise(
            passwords, password_hash=user.password_hash, candidate=payload.password
        )
        ensure_platform_login_allowed(user)
    except AuthenticationError:
        await limiter.record_failure(scope="platform_login", client_ip=client_ip, principal=email)
        raise
    user.last_login_at = datetime.now(UTC)
    access, refresh = issue_session_tokens(
        session,
        jwt=jwt,
        settings=settings,
        user_id=user.id,
        realm="platform",
        roles=(user.role.value,),
    )
    cookies.set(response, refresh)
    await limiter.record_success(scope="platform_login", principal=email)
    return AuthResponse(accessToken=access, expiresIn=settings.access_token_ttl_seconds)


@router.post("/refresh", response_model=AuthResponse)
async def refresh(
    request: Request,
    response: Response,
    session: AsyncSession = Depends(platform_db, scope="function"),
    jwt: JWTService = Depends(jwt_service),
    cookies: RefreshCookieManager = Depends(cookie_manager),
    settings: Settings = Depends(settings_dep),
) -> AuthResponse:
    cookies.validate_request(request)
    raw = cookies.refresh_token(request)
    access, new_refresh = await rotate_refresh_token(
        session, raw_token=raw, realm="platform", jwt=jwt, settings=settings
    )
    cookies.set(response, new_refresh)
    return AuthResponse(accessToken=access, expiresIn=settings.access_token_ttl_seconds)


@router.post("/logout", response_model=Message)
async def logout(
    request: Request,
    response: Response,
    session: AsyncSession = Depends(platform_db, scope="function"),
    jwt: JWTService = Depends(jwt_service),
    cookies: RefreshCookieManager = Depends(cookie_manager),
    settings: Settings = Depends(settings_dep),
) -> Message:
    cookies.validate_request(request)
    raw = request.cookies.get(cookies.name)
    if raw:
        await revoke_refresh(session, raw_token=raw, realm="platform", jwt=jwt, settings=settings)
    cookies.clear(response)
    return Message(message="Сессия завершена")


@router.post("/forgot-password", response_model=Message)
async def forgot_password(
    payload: EmailRequest,
    request: Request,
    background: BackgroundTasks,
    session: AsyncSession = Depends(platform_db, scope="function"),
    settings: Settings = Depends(settings_dep),
) -> Message:
    await enforce_auth_rate_limit(
        request, scope="platform_forgot", principal=str(payload.email), settings=settings
    )
    user = await session.scalar(
        select(PlatformUser).where(PlatformUser.email == str(payload.email))
    )
    if user is not None and user.status is not PlatformUserStatus.blocked:
        token = create_one_time_token(
            session,
            user_type=AuthUserType.platform,
            user_id=user.id,
            token_type=AuthTokenType.password_reset,
            settings=settings,
        )
        background.add_task(enqueue_auth_email, "platform_reset", user.email, token, None)
    return Message(message="Если аккаунт существует, письмо будет отправлено")


@router.post("/reset-password", response_model=Message)
async def reset_password(
    payload: ResetPassword,
    session: AsyncSession = Depends(platform_db, scope="function"),
    passwords: PasswordService = Depends(password_service),
    settings: Settings = Depends(settings_dep),
) -> Message:
    token = await consume_one_time_token(
        session,
        raw_token=payload.token,
        user_type=AuthUserType.platform,
        token_type=AuthTokenType.password_reset,
        settings=settings,
    )
    user = await session.get(PlatformUser, token.user_id, with_for_update=True)
    if user is None or user.status is PlatformUserStatus.blocked:
        raise BadRequestError("Токен недействителен", code="invalid_auth_token")
    user.password_hash = passwords.hash(payload.password, email=user.email)
    if user.role is PlatformRole.staff and user.status is PlatformUserStatus.pending:
        # В приглашении сотрудника используется одноразовая ссылка для задания
        # пароля; владение ссылкой также подтверждает доступ к указанной почте.
        user.email_verified = True
        user.status = PlatformUserStatus.active
    await revoke_all_user_sessions(session, user_type=AuthUserType.platform, user_id=user.id)
    return Message(message="Пароль изменён")


@router.post("/change-password", response_model=Message)
async def change_password(
    payload: ChangePassword,
    user: PlatformUser = Depends(current_platform_user),
    session: AsyncSession = Depends(platform_db, scope="function"),
    passwords: PasswordService = Depends(password_service),
) -> Message:
    verify_password_or_raise(
        passwords, password_hash=user.password_hash, candidate=payload.oldPassword
    )
    user.password_hash = passwords.hash(payload.newPassword, email=user.email)
    await revoke_all_user_sessions(session, user_type=AuthUserType.platform, user_id=user.id)
    return Message(message="Пароль изменён; активные сессии завершены")


@router.get("/me", response_model=MeResponse)
async def me(
    user: PlatformUser = Depends(current_platform_user),
    session: AsyncSession = Depends(platform_db, scope="function"),
) -> MeResponse:
    row = (
        await session.execute(
            select(Subscription, Plan)
            .join(Plan, Plan.id == Subscription.plan_id)
            .where(Subscription.owner_id == user.id)
            .order_by(desc(Subscription.created_at))
            .limit(1)
        )
    ).one_or_none()
    subscription = None
    if row is not None:
        sub, plan = row
        subscription = SubscriptionView.model_validate(
            {
                **sub.__dict__,
                "grace_until": sub.grace_period_end,
                "plan": plan,
            }
        )
    return MeResponse(user=UserView.model_validate(user), subscription=subscription)


@router.post("/dashboard-tour/claim", response_model=DashboardTourClaim)
async def claim_dashboard_tour(
    user: PlatformUser = Depends(current_platform_user),
    session: AsyncSession = Depends(platform_db, scope="function"),
) -> DashboardTourClaim:
    """Atomically reserve the one-time dashboard tour for this account."""
    result = await session.execute(
        update(PlatformUser)
        .where(
            PlatformUser.id == user.id,
            PlatformUser.dashboard_tour_completed_at.is_(None),
        )
        .values(dashboard_tour_completed_at=datetime.now(UTC))
    )
    return DashboardTourClaim(shouldShow=bool(getattr(result, "rowcount", 0)))


@router.delete("/me", response_model=Message)
async def delete_personal_data(
    request: Request,
    background: BackgroundTasks,
    user: PlatformUser = Depends(current_platform_user),
    session: AsyncSession = Depends(platform_db, scope="function"),
) -> Message:
    if user.role is PlatformRole.superadmin:
        raise ConflictError(
            "Нельзя удалить активного суперадминистра", code="superadmin_delete_forbidden"
        )
    marker = f"deleted-{user.id}@anonymized.invalid"
    user.email = marker
    user.full_name = None
    user.phone = None
    user.password_hash = "!anonymized"  # noqa: S105 - необратимая метка удаления
    user.personal_data_consent_at = None
    user.status = PlatformUserStatus.blocked
    site = await session.scalar(select(Site).where(Site.owner_id == user.id))
    if site is not None:
        from app.models import SiteStatus

        site.status = SiteStatus.suspended
        settings = request.app.state.settings
        hosts = [f"{site.slug}.{base_domain}" for base_domain in settings.tenant_base_domains]
        if site.custom_domain:
            hosts.append(str(site.custom_domain).lower())
        background.add_task(request.app.state.tenant_resolver.invalidate, *hosts)
    if user.role is PlatformRole.staff:
        async with AdminSession() as admin_session:
            async with admin_session.begin():
                staff_rows = (
                    await admin_session.scalars(
                        select(Staff).where(Staff.user_id == user.id).with_for_update()
                    )
                ).all()
                for staff in staff_rows:
                    staff.user_id = None
                    staff.name = "Удалённый сотрудник"
                    staff.specialization = None
                    staff.photo_url = None
                    staff.schedule = {}
                    staff.is_active = False
    await revoke_all_user_sessions(session, user_type=AuthUserType.platform, user_id=user.id)
    return Message(message="Персональные данные обезличены")
