from __future__ import annotations

import ipaddress
import re
import secrets
from datetime import UTC, datetime
from urllib.parse import urlsplit, urlunsplit
from uuid import UUID

import dns.asyncresolver
from fastapi import APIRouter, BackgroundTasks, Depends, Query, Request, status
from sqlalchemy import delete, desc, func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import (
    TenantContext,
    actor_tenant_db,
    actor_tenant_id,
    platform_db,
    require_owner,
    settings_dep,
    tenant_context,
    tenant_db,
)
from app.core.config import Settings
from app.core.errors import BadRequestError, ConflictError, NotFoundError
from app.db.session import set_rls_context
from app.models import (
    DomainVerificationStatus,
    PlatformUser,
    Site,
    SiteBlock,
    SiteStatus,
    SiteVersion,
    SiteVersionStatus,
    TLSStatus,
)
from app.schemas import (
    BlockCatalogItem,
    BlocksUpdate,
    DomainChallenge,
    DomainRequest,
    PreviewResponse,
    PublishResponse,
    SiteBlockInput,
    SiteBlockView,
    SiteCreate,
    SiteUpdate,
    SiteView,
)
from app.services.access import plan_access_for_owner, plan_access_for_tenant
from app.services.site_builder import (
    BlockValidationError,
    block_catalog_for,
    public_snapshot_for_access,
    validate_blocks,
)
from app.services.sites import (
    build_site_snapshot,
    create_preview,
    current_version_no,
    publish_version,
    read_preview,
    salon_profile_defaults,
    save_version,
    unique_slug,
)

router = APIRouter(tags=["sites"])


async def _owner_site(session: AsyncSession, owner_id: UUID, *, lock: bool = False) -> Site:
    query = select(Site).where(Site.owner_id == owner_id)
    if lock:
        query = query.with_for_update()
    site = await session.scalar(query)
    if site is None:
        raise NotFoundError("Сайт ещё не создан", code="site_not_found")
    return site


async def _site_view(session: AsyncSession, site: Site) -> SiteView:
    await set_rls_context(session, site.id)
    current = await current_version_no(session, site.id)
    published = await session.scalar(
        select(func.max(SiteVersion.version_no)).where(
            SiteVersion.tenant_id == site.id,
            SiteVersion.status == SiteVersionStatus.published,
        )
    )
    return SiteView.model_validate(
        {
            **site.__dict__,
            "draft_version": current,
            "published_version": published,
            "timezone": getattr(site, "timezone", "Europe/Moscow"),
        }
    )


async def _invalidate_host_cache(request: Request, site: Site) -> None:
    settings = request.app.state.settings
    hosts = [f"{site.slug}.{base_domain}" for base_domain in settings.tenant_base_domains]
    if site.custom_domain:
        hosts.append(str(site.custom_domain).lower())
    await request.app.state.tenant_resolver.invalidate(*hosts)


def _schedule_host_cache_invalidation(
    background: BackgroundTasks, request: Request, site: Site
) -> None:
    settings = request.app.state.settings
    hosts = [f"{site.slug}.{base_domain}" for base_domain in settings.tenant_base_domains]
    if site.custom_domain:
        hosts.append(str(site.custom_domain).lower())
    # Фоновые задачи выполняются после фиксации зависимостей запроса, устраняя
    # небольшую гонку между удалением и фиксацией при немедленной инвалидации.
    background.add_task(request.app.state.tenant_resolver.invalidate, *hosts)


@router.get("/sites/mine", response_model=SiteView)
async def get_mine(
    user: PlatformUser = Depends(require_owner),
    session: AsyncSession = Depends(platform_db, scope="function"),
) -> SiteView:
    return await _site_view(session, await _owner_site(session, user.id))


@router.post("/sites", response_model=SiteView, status_code=status.HTTP_201_CREATED)
async def create_site(
    payload: SiteCreate,
    request: Request,
    background: BackgroundTasks,
    user: PlatformUser = Depends(require_owner),
    session: AsyncSession = Depends(platform_db, scope="function"),
    settings: Settings = Depends(settings_dep),
) -> SiteView:
    if await session.scalar(select(Site.id).where(Site.owner_id == user.id)):
        raise ConflictError("У владельца уже есть сайт", code="site_already_exists")
    requested = payload.slug or payload.name
    slug = await unique_slug(session, requested, reserved=set(settings.reserved_tenant_slugs))
    profile = salon_profile_defaults(payload.salonType)
    site = Site(
        owner_id=user.id,
        name=payload.name,
        slug=slug,
        salon_type=payload.salonType,
        service_focuses=payload.serviceFocuses or profile["service_focuses"],
        locale=payload.locale,
        currency=payload.currency,
        city=payload.city,
        timezone=payload.timezone,
        status=SiteStatus.draft,
        work_hours={},
        socials={},
        theme=profile["theme"],
        template_key=profile["template_key"],
    )
    session.add(site)
    try:
        await session.flush()
    except IntegrityError as exc:
        raise ConflictError("Поддомен уже занят", code="slug_taken") from exc
    await _invalidate_host_cache(request, site)
    _schedule_host_cache_invalidation(background, request, site)
    return await _site_view(session, site)


@router.patch("/sites/mine", response_model=SiteView)
async def update_site(
    payload: SiteUpdate,
    request: Request,
    background: BackgroundTasks,
    user: PlatformUser = Depends(require_owner),
    session: AsyncSession = Depends(platform_db, scope="function"),
) -> SiteView:
    site = await _owner_site(session, user.id, lock=True)
    key_map = {
        "workHours": "work_hours",
        "logoUrl": "logo_url",
        "salonType": "salon_type",
        "serviceFocuses": "service_focuses",
    }
    values = {
        key_map.get(key, key): value
        for key, value in payload.model_dump(exclude_unset=True).items()
    }
    if "theme" in values:
        theme = values["theme"] or {}
        color = theme.get("color")
        if color is not None and not re.fullmatch(r"#[0-9A-Fa-f]{6}", str(color)):
            raise BadRequestError("Цвет темы должен быть в формате #RRGGBB", code="invalid_theme")
        if len(str(theme.get("font", ""))) > 80:
            raise BadRequestError("Некорректный шрифт", code="invalid_theme")
    for key, value in values.items():
        setattr(site, key, value)
    await session.flush()
    await set_rls_context(session, site.id)
    await save_version(session, site=site, actor_id=user.id, status=SiteVersionStatus.draft)
    await session.refresh(site)
    await _invalidate_host_cache(request, site)
    _schedule_host_cache_invalidation(background, request, site)
    return await _site_view(session, site)


@router.get("/sites/slug-available")
async def slug_available(
    slug: str = Query(
        min_length=3, max_length=63, pattern=r"^[a-z0-9](?:[a-z0-9-]{1,61}[a-z0-9])$"
    ),
    _user: PlatformUser = Depends(require_owner),
    session: AsyncSession = Depends(platform_db, scope="function"),
    settings: Settings = Depends(settings_dep),
) -> dict[str, bool]:
    available = slug not in settings.reserved_tenant_slugs and not bool(
        await session.scalar(select(Site.id).where(Site.slug == slug.lower()))
    )
    return {"available": available}


@router.get("/sites/mine/blocks", response_model=list[SiteBlockView])
async def get_blocks(
    _user: PlatformUser = Depends(require_owner),
    tenant_id: UUID = Depends(actor_tenant_id),
    session: AsyncSession = Depends(actor_tenant_db, scope="function"),
) -> list[SiteBlockView]:
    blocks = (
        await session.scalars(
            select(SiteBlock).where(SiteBlock.tenant_id == tenant_id).order_by(SiteBlock.position)
        )
    ).all()
    return [SiteBlockView.model_validate(block) for block in blocks]


@router.get("/sites/mine/block-catalog", response_model=list[BlockCatalogItem])
async def block_catalog(
    user: PlatformUser = Depends(require_owner),
    session: AsyncSession = Depends(platform_db, scope="function"),
) -> list[BlockCatalogItem]:
    access = await plan_access_for_owner(session, user.id)
    return [
        BlockCatalogItem.model_validate(item)
        for item in block_catalog_for(set(access.features), access.limits)
    ]


@router.put("/sites/mine/blocks", response_model=list[SiteBlockView])
async def put_blocks(
    payload: BlocksUpdate,
    user: PlatformUser = Depends(require_owner),
    tenant_id: UUID = Depends(actor_tenant_id),
    session: AsyncSession = Depends(actor_tenant_db, scope="function"),
) -> list[SiteBlockView]:
    access = await plan_access_for_owner(session, user.id)
    if payload.expectedVersion is not None:
        current = await current_version_no(session, tenant_id)
        if current != payload.expectedVersion:
            raise ConflictError("Черновик был изменён в другой сессии", code="version_conflict")
    try:
        normalized = validate_blocks(
            payload.blocks, features=set(access.features), limits=access.limits
        )
    except BlockValidationError as exc:
        raise BadRequestError(str(exc), code="invalid_site_blocks") from exc
    await session.execute(delete(SiteBlock).where(SiteBlock.tenant_id == tenant_id))
    rows = [
        SiteBlock(
            tenant_id=tenant_id,
            type=block.type,
            position=block.position,
            config=block.config,
            enabled=block.enabled,
        )
        for block in normalized
    ]
    session.add_all(rows)
    await session.flush()
    site = await session.get(Site, tenant_id)
    assert site is not None
    await save_version(session, site=site, actor_id=user.id, status=SiteVersionStatus.draft)
    return [SiteBlockView.model_validate(row) for row in rows]


@router.post("/sites/mine/preview", response_model=PreviewResponse)
async def preview(
    request: Request,
    user: PlatformUser = Depends(require_owner),
    tenant_id: UUID = Depends(actor_tenant_id),
    session: AsyncSession = Depends(actor_tenant_db, scope="function"),
    settings: Settings = Depends(settings_dep),
) -> PreviewResponse:
    site = await session.get(Site, tenant_id)
    assert site is not None
    access = await plan_access_for_owner(session, user.id)
    snapshot = public_snapshot_for_access(
        await build_site_snapshot(session, site),
        features=set(access.features),
        limits=access.limits,
    )
    raw, expires_at = await create_preview(
        request.app.state.redis,
        snapshot,
        settings.preview_token_ttl_seconds,
    )
    public = urlsplit(str(settings.public_base_url))
    port = f":{public.port}" if public.port else ""
    preview_host = f"{site.slug}.{settings.tenant_base_domains[0]}{port}"
    preview_url = urlunsplit((public.scheme, preview_host, "/preview", f"token={raw}", ""))
    return PreviewResponse(
        previewToken=raw,
        previewUrl=preview_url,
        expiresAt=expires_at,
    )


@router.post("/sites/mine/publish", response_model=PublishResponse)
async def publish(
    request: Request,
    background: BackgroundTasks,
    user: PlatformUser = Depends(require_owner),
    tenant_id: UUID = Depends(actor_tenant_id),
    session: AsyncSession = Depends(actor_tenant_db, scope="function"),
    settings: Settings = Depends(settings_dep),
) -> PublishResponse:
    site = await session.get(Site, tenant_id, with_for_update=True)
    if site is None:
        raise NotFoundError("Сайт не найден")
    access = await plan_access_for_owner(session, user.id)
    blocks = (
        await session.scalars(
            select(SiteBlock).where(SiteBlock.tenant_id == tenant_id).order_by(SiteBlock.position)
        )
    ).all()
    try:
        validated = validate_blocks(
            [SiteBlockInput.model_validate(block) for block in blocks],
            features=set(access.features),
            limits=access.limits,
        )
    except BlockValidationError as exc:
        raise BadRequestError(str(exc), code="invalid_site_blocks") from exc
    if not any(block.enabled for block in validated):
        raise BadRequestError("Добавьте хотя бы один блок", code="site_has_no_blocks")
    version = await publish_version(session, site=site, actor_id=user.id)
    site.status = SiteStatus.published
    site.published_at = version.published_at
    await _invalidate_host_cache(request, site)
    _schedule_host_cache_invalidation(background, request, site)
    base_domain = settings.tenant_base_domains[0]
    public = urlsplit(str(settings.public_base_url))
    port = f":{public.port}" if public.port else ""
    public_host = f"{site.slug}.{base_domain}{port}"
    return PublishResponse(
        url=urlunsplit((public.scheme, public_host, "", "", "")),
        version=version.version_no,
        publishedAt=version.published_at or datetime.now(UTC),
    )


def _normalize_domain(raw: str, settings: Settings) -> str:
    value = raw.strip().lower().rstrip(".")
    if "://" in value or "/" in value or "@" in value or ":" in value:
        raise BadRequestError("Укажите только доменное имя", code="invalid_domain")
    try:
        ipaddress.ip_address(value)
    except ValueError:
        pass
    else:
        raise BadRequestError("IP-адрес нельзя использовать как домен", code="invalid_domain")
    try:
        value = value.encode("idna").decode("ascii")
    except UnicodeError as exc:
        raise BadRequestError("Некорректный домен", code="invalid_domain") from exc
    if len(value) > 253 or not re.fullmatch(
        r"(?=.{4,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}", value
    ):
        raise BadRequestError("Некорректный домен", code="invalid_domain")
    if any(value == base or value.endswith(f".{base}") for base in settings.tenant_base_domains):
        raise BadRequestError("Используйте настройку поддомена платформы", code="platform_domain")
    return value


@router.post("/sites/mine/domain", response_model=DomainChallenge)
async def connect_domain(
    payload: DomainRequest,
    request: Request,
    background: BackgroundTasks,
    user: PlatformUser = Depends(require_owner),
    session: AsyncSession = Depends(platform_db, scope="function"),
    settings: Settings = Depends(settings_dep),
) -> DomainChallenge:
    access = await plan_access_for_owner(session, user.id)
    access.require("custom_domain")
    site = await _owner_site(session, user.id, lock=True)
    domain = _normalize_domain(payload.domain, settings)
    collision = await session.scalar(
        select(Site.id).where(Site.custom_domain == domain, Site.id != site.id)
    )
    if collision:
        raise ConflictError("Домен уже используется", code="domain_taken")
    await _invalidate_host_cache(request, site)
    _schedule_host_cache_invalidation(background, request, site)
    site.custom_domain = domain
    site.domain_verified = False
    site.domain_verification_status = DomainVerificationStatus.pending
    site.domain_verification_token = secrets.token_urlsafe(24)
    site.domain_verification_requested_at = datetime.now(UTC)
    site.tls_status = TLSStatus.not_requested
    await _invalidate_host_cache(request, site)
    _schedule_host_cache_invalidation(background, request, site)
    return DomainChallenge(
        domain=domain,
        recordName=f"_trimmycrm-verification.{domain}",
        recordValue=site.domain_verification_token,
        verified=False,
    )


@router.post("/sites/mine/domain/verify", response_model=DomainChallenge)
async def verify_domain(
    request: Request,
    background: BackgroundTasks,
    user: PlatformUser = Depends(require_owner),
    session: AsyncSession = Depends(platform_db, scope="function"),
) -> DomainChallenge:
    access = await plan_access_for_owner(session, user.id)
    access.require("custom_domain")
    site = await _owner_site(session, user.id, lock=True)
    if not site.custom_domain or not site.domain_verification_token:
        raise BadRequestError("Сначала подключите домен", code="domain_not_configured")
    record_name = f"_trimmycrm-verification.{site.custom_domain}"
    site.domain_last_checked_at = datetime.now(UTC)
    try:
        answers = await dns.asyncresolver.resolve(record_name, "TXT", lifetime=5.0)
        values = {
            b"".join(getattr(answer, "strings", ())).decode("utf-8", "ignore") for answer in answers
        }
    except Exception as exc:
        site.domain_verification_status = DomainVerificationStatus.failed
        site.domain_verification_error = "TXT-запись не найдена"
        await session.commit()
        raise BadRequestError(
            "TXT-запись подтверждения не найдена", code="domain_not_verified"
        ) from exc
    if site.domain_verification_token not in values:
        site.domain_verification_status = DomainVerificationStatus.failed
        site.domain_verification_error = "Значение TXT-записи не совпало"
        await session.commit()
        raise BadRequestError("Значение TXT-записи не совпало", code="domain_not_verified")
    site.domain_verified = True
    site.domain_verification_status = DomainVerificationStatus.verified
    site.domain_verified_at = datetime.now(UTC)
    site.domain_verification_error = None
    site.tls_status = TLSStatus.pending
    await _invalidate_host_cache(request, site)
    _schedule_host_cache_invalidation(background, request, site)
    return DomainChallenge(
        domain=str(site.custom_domain),
        recordName=record_name,
        recordValue=site.domain_verification_token,
        verified=True,
    )


@router.get("/public/site")
async def public_site(
    request: Request,
    previewToken: str | None = Query(default=None, min_length=32, max_length=256),
    context: TenantContext = Depends(tenant_context),
    session: AsyncSession = Depends(tenant_db, scope="function"),
) -> dict[str, object]:
    access = await plan_access_for_tenant(session, context.id)
    if previewToken:
        preview_data = await read_preview(request.app.state.redis, previewToken)
        if preview_data is None or preview_data.get("id") != str(context.id):
            raise NotFoundError("Предпросмотр недоступен", code="preview_not_found")
        return public_snapshot_for_access(
            preview_data,
            features=set(access.features),
            limits=access.limits,
        )
    site = await session.get(Site, context.id)
    if site is None or site.status is not SiteStatus.published:
        raise NotFoundError("Сайт не опубликован", code="site_not_published")
    version = await session.scalar(
        select(SiteVersion)
        .where(
            SiteVersion.tenant_id == context.id,
            SiteVersion.status == SiteVersionStatus.published,
        )
        .order_by(desc(SiteVersion.version_no))
        .limit(1)
    )
    if version is None:
        raise NotFoundError("Опубликованная версия не найдена", code="site_version_missing")
    snapshot = public_snapshot_for_access(
        version.snapshot,
        features=set(access.features),
        limits=access.limits,
    )
    return {**snapshot, "version": version.version_no, "publishedAt": version.published_at}
