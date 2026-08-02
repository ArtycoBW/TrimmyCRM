from __future__ import annotations

import secrets
from datetime import UTC, datetime, timedelta
from uuid import UUID

from fastapi import APIRouter, BackgroundTasks, Depends, Query, Request, Response, status
from sqlalchemy import delete, func, or_, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import (
    TenantContext,
    actor_tenant_db,
    actor_tenant_id,
    password_service,
    require_crm_actor,
    require_owner,
    settings_dep,
    tenant_context,
    tenant_db,
)
from app.core.config import Settings
from app.core.errors import BadRequestError, ConflictError, NotFoundError, ServiceUnavailableError
from app.core.security import PasswordService
from app.db.session import AdminSession, RuntimeSession, set_rls_context
from app.integrations.storage import StorageError
from app.models import (
    Appointment,
    AppointmentItem,
    AuthToken,
    AuthTokenType,
    AuthUserType,
    ClientHairProfile,
    PlatformRole,
    PlatformUser,
    PlatformUserStatus,
    ScheduleException,
    ScheduleExceptionType,
    Service,
    ServiceAddon,
    ServiceCategory,
    ServicePriceType,
    ServiceVariant,
    Staff,
    StaffService,
    TenantUser,
    TenantUserStatus,
)
from app.schemas import (
    ClientAppointmentSummary,
    ClientCreate,
    ClientDetailsView,
    ClientHairProfileUpdate,
    ClientHairProfileView,
    ClientUpdate,
    ClientView,
    Paginated,
    Pagination,
    PublicServiceView,
    PublicStaffView,
    ScheduleExceptionCreate,
    ScheduleExceptionUpdate,
    ScheduleExceptionView,
    ServiceAddonCreate,
    ServiceAddonUpdate,
    ServiceAddonView,
    ServiceCategoryCreate,
    ServiceCategoryUpdate,
    ServiceCategoryView,
    ServiceCreate,
    ServiceUpdate,
    ServiceVariantCreate,
    ServiceVariantUpdate,
    ServiceVariantView,
    ServiceView,
    StaffCreate,
    StaffUpdate,
    StaffView,
)
from app.services.access import lock_tenant_quota, plan_access_for_tenant
from app.services.authentication import create_one_time_token
from app.services.privacy import (
    anonymize_tenant_user,
    erase_tenant_user_media,
    tenant_user_media_keys,
)
from app.tasks.jobs import enqueue_auth_email

router = APIRouter(tags=["CRM"])


def _apply(model: object, payload: object, mapping: dict[str, str] | None = None) -> None:
    mapping = mapping or {}
    for key, value in payload.model_dump(exclude_unset=True).items():  # type: ignore[attr-defined]
        setattr(model, mapping.get(key, key), value)


async def _service_or_404(session: AsyncSession, tenant_id: UUID, service_id: UUID) -> Service:
    value = await session.scalar(
        select(Service).where(Service.tenant_id == tenant_id, Service.id == service_id)
    )
    if value is None:
        raise NotFoundError("Услуга не найдена")
    return value


async def _category_or_404(
    session: AsyncSession, tenant_id: UUID, category_id: UUID
) -> ServiceCategory:
    value = await session.scalar(
        select(ServiceCategory).where(
            ServiceCategory.tenant_id == tenant_id,
            ServiceCategory.id == category_id,
        )
    )
    if value is None:
        raise NotFoundError("Категория услуг не найдена")
    return value


def _service_payload_mapping() -> dict[str, str]:
    return {
        "categoryId": "category_id",
        "maxPrice": "max_price",
        "priceType": "price_type",
        "durationMin": "duration_min",
        "bufferBeforeMin": "buffer_before_min",
        "bufferAfterMin": "buffer_after_min",
        "requiresConsultation": "requires_consultation",
        "requiresPatchTest": "requires_patch_test",
        "allowOnlineBooking": "allow_online_booking",
        "variantSelectionRequired": "variant_selection_required",
        "preparationText": "preparation_text",
        "aftercareText": "aftercare_text",
        "sortOrder": "sort_order",
        "isActive": "is_active",
    }


def _validate_service_pricing(row: Service) -> None:
    if row.price_type is ServicePriceType.range and row.max_price is None:
        raise BadRequestError(
            "Для диапазона цены укажите максимальную цену",
            code="service_max_price_required",
        )
    if row.max_price is not None and row.max_price < row.price:
        raise BadRequestError(
            "Максимальная цена не может быть ниже базовой",
            code="invalid_service_price_range",
        )


async def _service_views(
    session: AsyncSession,
    rows: list[Service],
    *,
    public: bool = False,
) -> list[ServiceView] | list[PublicServiceView]:
    if not rows:
        return []
    tenant_id = rows[0].tenant_id
    service_ids = [row.id for row in rows]
    category_ids = {row.category_id for row in rows if row.category_id is not None}

    variant_query = select(ServiceVariant).where(
        ServiceVariant.tenant_id == tenant_id,
        ServiceVariant.service_id.in_(service_ids),
    )
    addon_query = select(ServiceAddon).where(
        ServiceAddon.tenant_id == tenant_id,
        ServiceAddon.service_id.in_(service_ids),
    )
    if public:
        variant_query = variant_query.where(ServiceVariant.is_active.is_(True))
        addon_query = addon_query.where(ServiceAddon.is_active.is_(True))
    variants = (
        await session.scalars(
            variant_query.order_by(ServiceVariant.sort_order, ServiceVariant.label)
        )
    ).all()
    addons = (
        await session.scalars(addon_query.order_by(ServiceAddon.sort_order, ServiceAddon.name))
    ).all()
    category_names: dict[UUID, str] = {}
    if category_ids:
        categories = (
            await session.scalars(
                select(ServiceCategory).where(
                    ServiceCategory.tenant_id == tenant_id,
                    ServiceCategory.id.in_(category_ids),
                )
            )
        ).all()
        category_names = {category.id: category.name for category in categories}

    variants_by_service: dict[UUID, list[ServiceVariant]] = {}
    for variant in variants:
        variants_by_service.setdefault(variant.service_id, []).append(variant)
    addons_by_service: dict[UUID, list[ServiceAddon]] = {}
    for addon in addons:
        addons_by_service.setdefault(addon.service_id, []).append(addon)

    payloads = [
        {
            **row.__dict__,
            "category_name": (
                category_names.get(row.category_id) if row.category_id is not None else None
            )
            or row.category,
            "variants": variants_by_service.get(row.id, []),
            "addons": addons_by_service.get(row.id, []),
        }
        for row in rows
    ]
    if public:
        return [PublicServiceView.model_validate(payload) for payload in payloads]
    return [ServiceView.model_validate(payload) for payload in payloads]


async def _service_view(session: AsyncSession, row: Service) -> ServiceView:
    values = await _service_views(session, [row])
    return values[0]  # type: ignore[return-value]


@router.get("/service-categories", response_model=list[ServiceCategoryView])
async def list_service_categories(
    include_inactive: bool = False,
    _actor: PlatformUser = Depends(require_crm_actor),
    tenant_id: UUID = Depends(actor_tenant_id),
    session: AsyncSession = Depends(actor_tenant_db, scope="function"),
) -> list[ServiceCategoryView]:
    query = select(ServiceCategory).where(ServiceCategory.tenant_id == tenant_id)
    if not include_inactive:
        query = query.where(ServiceCategory.is_active.is_(True))
    rows = (
        await session.scalars(
            query.order_by(ServiceCategory.sort_order, ServiceCategory.name).limit(200)
        )
    ).all()
    return [ServiceCategoryView.model_validate(row) for row in rows]


@router.post(
    "/service-categories",
    response_model=ServiceCategoryView,
    status_code=status.HTTP_201_CREATED,
)
async def create_service_category(
    payload: ServiceCategoryCreate,
    _owner: PlatformUser = Depends(require_owner),
    tenant_id: UUID = Depends(actor_tenant_id),
    session: AsyncSession = Depends(actor_tenant_db, scope="function"),
) -> ServiceCategoryView:
    row = ServiceCategory(
        tenant_id=tenant_id,
        name=payload.name,
        slug=payload.slug,
        audience=payload.audience,
        sort_order=payload.sortOrder,
        is_active=payload.isActive,
    )
    try:
        async with session.begin_nested():
            session.add(row)
            await session.flush()
    except IntegrityError as exc:
        raise ConflictError(
            "Категория с таким идентификатором уже существует",
            code="service_category_slug_conflict",
        ) from exc
    return ServiceCategoryView.model_validate(row)


@router.patch("/service-categories/{category_id}", response_model=ServiceCategoryView)
async def update_service_category(
    category_id: UUID,
    payload: ServiceCategoryUpdate,
    _owner: PlatformUser = Depends(require_owner),
    tenant_id: UUID = Depends(actor_tenant_id),
    session: AsyncSession = Depends(actor_tenant_db, scope="function"),
) -> ServiceCategoryView:
    row = await _category_or_404(session, tenant_id, category_id)
    _apply(row, payload, {"sortOrder": "sort_order", "isActive": "is_active"})
    try:
        async with session.begin_nested():
            await session.flush()
    except IntegrityError as exc:
        raise ConflictError(
            "Категория с таким идентификатором уже существует",
            code="service_category_slug_conflict",
        ) from exc
    await session.refresh(row)
    return ServiceCategoryView.model_validate(row)


@router.delete("/service-categories/{category_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_service_category(
    category_id: UUID,
    _owner: PlatformUser = Depends(require_owner),
    tenant_id: UUID = Depends(actor_tenant_id),
    session: AsyncSession = Depends(actor_tenant_db, scope="function"),
) -> Response:
    row = await _category_or_404(session, tenant_id, category_id)
    has_services = bool(
        await session.scalar(
            select(Service.id)
            .where(Service.tenant_id == tenant_id, Service.category_id == category_id)
            .limit(1)
        )
    )
    if has_services:
        row.is_active = False
    else:
        await session.delete(row)
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.get("/services", response_model=list[ServiceView])
async def list_services(
    include_inactive: bool = False,
    limit: int = Query(default=200, ge=1, le=500),
    _actor: PlatformUser = Depends(require_crm_actor),
    tenant_id: UUID = Depends(actor_tenant_id),
    session: AsyncSession = Depends(actor_tenant_db, scope="function"),
) -> list[ServiceView]:
    query = select(Service).where(Service.tenant_id == tenant_id)
    if not include_inactive:
        query = query.where(Service.is_active.is_(True))
    rows = (
        await session.scalars(
            query.order_by(Service.sort_order, Service.category, Service.name).limit(limit)
        )
    ).all()
    values = await _service_views(session, list(rows))
    return values  # type: ignore[return-value]


@router.post("/services", response_model=ServiceView, status_code=status.HTTP_201_CREATED)
async def create_service(
    payload: ServiceCreate,
    _owner: PlatformUser = Depends(require_owner),
    tenant_id: UUID = Depends(actor_tenant_id),
    session: AsyncSession = Depends(actor_tenant_db, scope="function"),
) -> ServiceView:
    category = (
        await _category_or_404(session, tenant_id, payload.categoryId)
        if payload.categoryId is not None
        else None
    )
    row = Service(
        tenant_id=tenant_id,
        name=payload.name,
        description=payload.description,
        category_id=payload.categoryId,
        price=payload.price,
        max_price=payload.maxPrice,
        price_type=payload.priceType,
        currency=payload.currency,
        duration_min=payload.durationMin,
        buffer_before_min=payload.bufferBeforeMin,
        buffer_after_min=payload.bufferAfterMin,
        category=category.name if category is not None else payload.category,
        requires_consultation=payload.requiresConsultation,
        requires_patch_test=payload.requiresPatchTest,
        allow_online_booking=payload.allowOnlineBooking,
        variant_selection_required=payload.variantSelectionRequired,
        preparation_text=payload.preparationText,
        aftercare_text=payload.aftercareText,
        sort_order=payload.sortOrder,
        is_active=payload.isActive,
    )
    _validate_service_pricing(row)
    session.add(row)
    await session.flush()
    return await _service_view(session, row)


@router.get("/services/{service_id}", response_model=ServiceView)
async def get_service(
    service_id: UUID,
    _actor: PlatformUser = Depends(require_crm_actor),
    tenant_id: UUID = Depends(actor_tenant_id),
    session: AsyncSession = Depends(actor_tenant_db, scope="function"),
) -> ServiceView:
    return await _service_view(session, await _service_or_404(session, tenant_id, service_id))


@router.patch("/services/{service_id}", response_model=ServiceView)
async def update_service(
    service_id: UUID,
    payload: ServiceUpdate,
    _owner: PlatformUser = Depends(require_owner),
    tenant_id: UUID = Depends(actor_tenant_id),
    session: AsyncSession = Depends(actor_tenant_db, scope="function"),
) -> ServiceView:
    row = await _service_or_404(session, tenant_id, service_id)
    values = payload.model_dump(exclude_unset=True)
    category: ServiceCategory | None = None
    if "categoryId" in values and values["categoryId"] is not None:
        category = await _category_or_404(session, tenant_id, values["categoryId"])
    _apply(row, payload, _service_payload_mapping())
    if "categoryId" in values:
        row.category = category.name if category is not None else None
    _validate_service_pricing(row)
    await session.flush()
    await session.refresh(row)
    return await _service_view(session, row)


async def _variant_or_404(
    session: AsyncSession,
    tenant_id: UUID,
    service_id: UUID,
    variant_id: UUID,
) -> ServiceVariant:
    row = await session.scalar(
        select(ServiceVariant).where(
            ServiceVariant.tenant_id == tenant_id,
            ServiceVariant.service_id == service_id,
            ServiceVariant.id == variant_id,
        )
    )
    if row is None:
        raise NotFoundError("Вариант услуги не найден")
    return row


async def _addon_or_404(
    session: AsyncSession,
    tenant_id: UUID,
    service_id: UUID,
    addon_id: UUID,
) -> ServiceAddon:
    row = await session.scalar(
        select(ServiceAddon).where(
            ServiceAddon.tenant_id == tenant_id,
            ServiceAddon.service_id == service_id,
            ServiceAddon.id == addon_id,
        )
    )
    if row is None:
        raise NotFoundError("Дополнение к услуге не найдено")
    return row


@router.post(
    "/services/{service_id}/variants",
    response_model=ServiceVariantView,
    status_code=status.HTTP_201_CREATED,
)
async def create_service_variant(
    service_id: UUID,
    payload: ServiceVariantCreate,
    _owner: PlatformUser = Depends(require_owner),
    tenant_id: UUID = Depends(actor_tenant_id),
    session: AsyncSession = Depends(actor_tenant_db, scope="function"),
) -> ServiceVariantView:
    await _service_or_404(session, tenant_id, service_id)
    row = ServiceVariant(
        tenant_id=tenant_id,
        service_id=service_id,
        label=payload.label,
        price_delta=payload.priceDelta,
        duration_delta_min=payload.durationDeltaMin,
        sort_order=payload.sortOrder,
        is_active=payload.isActive,
    )
    try:
        async with session.begin_nested():
            session.add(row)
            await session.flush()
    except IntegrityError as exc:
        raise ConflictError(
            "Вариант с таким названием уже существует",
            code="service_variant_label_conflict",
        ) from exc
    return ServiceVariantView.model_validate(row)


@router.patch("/services/{service_id}/variants/{variant_id}", response_model=ServiceVariantView)
async def update_service_variant(
    service_id: UUID,
    variant_id: UUID,
    payload: ServiceVariantUpdate,
    _owner: PlatformUser = Depends(require_owner),
    tenant_id: UUID = Depends(actor_tenant_id),
    session: AsyncSession = Depends(actor_tenant_db, scope="function"),
) -> ServiceVariantView:
    row = await _variant_or_404(session, tenant_id, service_id, variant_id)
    _apply(
        row,
        payload,
        {
            "priceDelta": "price_delta",
            "durationDeltaMin": "duration_delta_min",
            "sortOrder": "sort_order",
            "isActive": "is_active",
        },
    )
    try:
        async with session.begin_nested():
            await session.flush()
    except IntegrityError as exc:
        raise ConflictError(
            "Вариант с таким названием уже существует",
            code="service_variant_label_conflict",
        ) from exc
    await session.refresh(row)
    return ServiceVariantView.model_validate(row)


@router.delete(
    "/services/{service_id}/variants/{variant_id}", status_code=status.HTTP_204_NO_CONTENT
)
async def delete_service_variant(
    service_id: UUID,
    variant_id: UUID,
    _owner: PlatformUser = Depends(require_owner),
    tenant_id: UUID = Depends(actor_tenant_id),
    session: AsyncSession = Depends(actor_tenant_db, scope="function"),
) -> Response:
    row = await _variant_or_404(session, tenant_id, service_id, variant_id)
    row.is_active = False
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.post(
    "/services/{service_id}/addons",
    response_model=ServiceAddonView,
    status_code=status.HTTP_201_CREATED,
)
async def create_service_addon(
    service_id: UUID,
    payload: ServiceAddonCreate,
    _owner: PlatformUser = Depends(require_owner),
    tenant_id: UUID = Depends(actor_tenant_id),
    session: AsyncSession = Depends(actor_tenant_db, scope="function"),
) -> ServiceAddonView:
    await _service_or_404(session, tenant_id, service_id)
    row = ServiceAddon(
        tenant_id=tenant_id,
        service_id=service_id,
        name=payload.name,
        price_delta=payload.priceDelta,
        duration_delta_min=payload.durationDeltaMin,
        sort_order=payload.sortOrder,
        is_active=payload.isActive,
    )
    try:
        async with session.begin_nested():
            session.add(row)
            await session.flush()
    except IntegrityError as exc:
        raise ConflictError(
            "Дополнение с таким названием уже существует",
            code="service_addon_name_conflict",
        ) from exc
    return ServiceAddonView.model_validate(row)


@router.patch("/services/{service_id}/addons/{addon_id}", response_model=ServiceAddonView)
async def update_service_addon(
    service_id: UUID,
    addon_id: UUID,
    payload: ServiceAddonUpdate,
    _owner: PlatformUser = Depends(require_owner),
    tenant_id: UUID = Depends(actor_tenant_id),
    session: AsyncSession = Depends(actor_tenant_db, scope="function"),
) -> ServiceAddonView:
    row = await _addon_or_404(session, tenant_id, service_id, addon_id)
    _apply(
        row,
        payload,
        {
            "priceDelta": "price_delta",
            "durationDeltaMin": "duration_delta_min",
            "sortOrder": "sort_order",
            "isActive": "is_active",
        },
    )
    try:
        async with session.begin_nested():
            await session.flush()
    except IntegrityError as exc:
        raise ConflictError(
            "Дополнение с таким названием уже существует",
            code="service_addon_name_conflict",
        ) from exc
    await session.refresh(row)
    return ServiceAddonView.model_validate(row)


@router.delete("/services/{service_id}/addons/{addon_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_service_addon(
    service_id: UUID,
    addon_id: UUID,
    _owner: PlatformUser = Depends(require_owner),
    tenant_id: UUID = Depends(actor_tenant_id),
    session: AsyncSession = Depends(actor_tenant_db, scope="function"),
) -> Response:
    row = await _addon_or_404(session, tenant_id, service_id, addon_id)
    row.is_active = False
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.delete("/services/{service_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_service(
    service_id: UUID,
    _owner: PlatformUser = Depends(require_owner),
    tenant_id: UUID = Depends(actor_tenant_id),
    session: AsyncSession = Depends(actor_tenant_db, scope="function"),
) -> Response:
    row = await _service_or_404(session, tenant_id, service_id)
    has_history = bool(
        await session.scalar(
            select(AppointmentItem.id)
            .where(
                AppointmentItem.tenant_id == tenant_id,
                AppointmentItem.service_id == service_id,
            )
            .limit(1)
        )
    )
    if has_history:
        row.is_active = False
    else:
        await session.delete(row)
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.get("/public/services", response_model=list[PublicServiceView])
async def public_services(
    limit: int = Query(default=200, ge=1, le=500),
    context: TenantContext = Depends(tenant_context),
    session: AsyncSession = Depends(tenant_db, scope="function"),
) -> list[PublicServiceView]:
    rows = (
        await session.scalars(
            select(Service)
            .outerjoin(
                ServiceCategory,
                (ServiceCategory.tenant_id == Service.tenant_id)
                & (ServiceCategory.id == Service.category_id),
            )
            .where(
                Service.tenant_id == context.id,
                Service.is_active.is_(True),
                Service.allow_online_booking.is_(True),
                or_(Service.category_id.is_(None), ServiceCategory.is_active.is_(True)),
            )
            .order_by(Service.sort_order, Service.category, Service.name)
            .limit(limit)
        )
    ).all()
    values = await _service_views(session, list(rows), public=True)
    return values  # type: ignore[return-value]


async def _staff_view(session: AsyncSession, row: Staff) -> StaffView:
    service_ids = list(
        await session.scalars(
            select(StaffService.service_id).where(
                StaffService.tenant_id == row.tenant_id, StaffService.staff_id == row.id
            )
        )
    )
    return StaffView.model_validate({**row.__dict__, "service_ids": service_ids})


async def _staff_service_map(
    session: AsyncSession,
    *,
    tenant_id: UUID,
    staff_ids: list[UUID],
    active_services_only: bool,
) -> dict[UUID, list[UUID]]:
    if not staff_ids:
        return {}
    query = select(StaffService.staff_id, StaffService.service_id).where(
        StaffService.tenant_id == tenant_id,
        StaffService.staff_id.in_(staff_ids),
    )
    if active_services_only:
        query = query.join(
            Service,
            (Service.tenant_id == StaffService.tenant_id) & (Service.id == StaffService.service_id),
        ).where(Service.is_active.is_(True))
    result: dict[UUID, list[UUID]] = {staff_id: [] for staff_id in staff_ids}
    for staff_id, service_id in (await session.execute(query)).all():
        result[staff_id].append(service_id)
    return result


async def _staff_or_404(session: AsyncSession, tenant_id: UUID, staff_id: UUID) -> Staff:
    row = await session.scalar(
        select(Staff).where(Staff.tenant_id == tenant_id, Staff.id == staff_id)
    )
    if row is None:
        raise NotFoundError("Мастер не найден")
    return row


async def _replace_staff_services(
    session: AsyncSession, tenant_id: UUID, staff_id: UUID, service_ids: list[UUID]
) -> None:
    unique_ids = await _validated_staff_service_ids(session, tenant_id, service_ids)

    await session.execute(
        delete(StaffService).where(
            StaffService.tenant_id == tenant_id, StaffService.staff_id == staff_id
        )
    )
    session.add_all(
        [
            StaffService(tenant_id=tenant_id, staff_id=staff_id, service_id=value)
            for value in unique_ids
        ]
    )
    await session.flush()


async def _validated_staff_service_ids(
    session: AsyncSession, tenant_id: UUID, service_ids: list[UUID]
) -> list[UUID]:
    unique_ids = list(dict.fromkeys(service_ids))
    if unique_ids:
        existing = set(
            await session.scalars(
                select(Service.id).where(
                    Service.tenant_id == tenant_id,
                    Service.id.in_(unique_ids),
                    Service.is_active.is_(True),
                )
            )
        )
        if existing != set(unique_ids):
            raise BadRequestError("Одна или несколько услуг недоступны", code="invalid_service_ids")
    return unique_ids


@router.get("/staff", response_model=list[StaffView])
async def list_staff(
    include_inactive: bool = False,
    limit: int = Query(default=200, ge=1, le=500),
    _actor: PlatformUser = Depends(require_crm_actor),
    tenant_id: UUID = Depends(actor_tenant_id),
    session: AsyncSession = Depends(actor_tenant_db, scope="function"),
) -> list[StaffView]:
    query = select(Staff).where(Staff.tenant_id == tenant_id)
    if not include_inactive:
        query = query.where(Staff.is_active.is_(True))
    rows = (await session.scalars(query.order_by(Staff.name).limit(limit))).all()
    service_map = await _staff_service_map(
        session,
        tenant_id=tenant_id,
        staff_ids=[row.id for row in rows],
        active_services_only=False,
    )
    return [
        StaffView.model_validate({**row.__dict__, "service_ids": service_map.get(row.id, [])})
        for row in rows
    ]


@router.post("/staff", response_model=StaffView, status_code=status.HTTP_201_CREATED)
async def create_staff(
    payload: StaffCreate,
    background: BackgroundTasks,
    owner: PlatformUser = Depends(require_owner),
    tenant_id: UUID = Depends(actor_tenant_id),
    session: AsyncSession = Depends(actor_tenant_db, scope="function"),
    passwords: PasswordService = Depends(password_service),
    settings: Settings = Depends(settings_dep),
) -> StaffView:
    await lock_tenant_quota(session, tenant_id, "staff")
    access = await plan_access_for_tenant(session, tenant_id)
    staff_limit = access.limit("staff")
    current = int(
        await session.scalar(
            select(func.count())
            .select_from(Staff)
            .where(Staff.tenant_id == tenant_id, Staff.is_active.is_(True))
        )
        or 0
    )
    if staff_limit is not None and current >= staff_limit:
        raise ConflictError("Достигнут лимит сотрудников тарифа", code="staff_limit_reached")

    service_ids = await _validated_staff_service_ids(session, tenant_id, payload.serviceIds)
    platform_user_id = None
    invite_token: str | None = None
    invite_email: str | None = None
    created_platform_user = False
    if payload.email:
        email = str(payload.email).lower()
        # Глобальную учётную запись и токен сброса нужно зафиксировать до того,
        # как строка сотрудника тенанта сошлётся на неё из другой RLS-сессии.
        async with RuntimeSession() as identity_session:
            async with identity_session.begin():
                await set_rls_context(identity_session, None, platform_scope=True)
                platform_user = await identity_session.scalar(
                    select(PlatformUser).where(PlatformUser.email == email).with_for_update()
                )
                if platform_user is not None and platform_user.role is not PlatformRole.staff:
                    raise ConflictError(
                        "Email уже используется другой ролью", code="staff_email_conflict"
                    )
                if platform_user is not None and platform_user.status is PlatformUserStatus.blocked:
                    raise ConflictError(
                        "Учётная запись сотрудника заблокирована", code="staff_account_blocked"
                    )
                if platform_user is None:
                    temporary = secrets.token_urlsafe(36) + "Aa1!"
                    platform_user = PlatformUser(
                        email=email,
                        password_hash=passwords.hash(temporary, email=email),
                        role=PlatformRole.staff,
                        status=PlatformUserStatus.pending,
                        email_verified=False,
                    )
                    identity_session.add(platform_user)
                    await identity_session.flush()
                    created_platform_user = True
                if platform_user.status is PlatformUserStatus.pending:
                    invite_token = create_one_time_token(
                        identity_session,
                        user_type=AuthUserType.platform,
                        user_id=platform_user.id,
                        token_type=AuthTokenType.password_reset,
                        settings=settings,
                    )
                    invite_email = email
                platform_user_id = platform_user.id

        async with AdminSession() as admin_session:
            already_linked = await admin_session.scalar(
                select(Staff.id).where(Staff.user_id == platform_user_id)
            )
        if already_linked:
            raise ConflictError("Сотрудник уже привязан к салону", code="staff_already_linked")
    row = Staff(
        tenant_id=tenant_id,
        user_id=platform_user_id,
        name=payload.name,
        specialization=payload.specialization,
        photo_url=payload.photoUrl,
        schedule=payload.schedule,
        is_active=payload.isActive,
    )
    try:
        async with session.begin_nested():
            session.add(row)
            await session.flush()
    except IntegrityError as exc:
        if created_platform_user and platform_user_id is not None:
            async with RuntimeSession() as cleanup_session:
                async with cleanup_session.begin():
                    await set_rls_context(cleanup_session, None, platform_scope=True)
                    await cleanup_session.execute(
                        delete(AuthToken).where(
                            AuthToken.user_type == AuthUserType.platform,
                            AuthToken.user_id == platform_user_id,
                        )
                    )
                    platform_user = await cleanup_session.get(PlatformUser, platform_user_id)
                    if platform_user is not None:
                        await cleanup_session.delete(platform_user)
        raise ConflictError("Сотрудник уже привязан к салону", code="staff_already_linked") from exc
    await _replace_staff_services(session, tenant_id, row.id, service_ids)
    if invite_token and invite_email:
        background.add_task(enqueue_auth_email, "staff_invite", invite_email, invite_token, None)
    return await _staff_view(session, row)


@router.get("/staff/{staff_id}", response_model=StaffView)
async def get_staff(
    staff_id: UUID,
    _actor: PlatformUser = Depends(require_crm_actor),
    tenant_id: UUID = Depends(actor_tenant_id),
    session: AsyncSession = Depends(actor_tenant_db, scope="function"),
) -> StaffView:
    return await _staff_view(session, await _staff_or_404(session, tenant_id, staff_id))


@router.patch("/staff/{staff_id}", response_model=StaffView)
async def update_staff(
    staff_id: UUID,
    payload: StaffUpdate,
    _owner: PlatformUser = Depends(require_owner),
    tenant_id: UUID = Depends(actor_tenant_id),
    session: AsyncSession = Depends(actor_tenant_db, scope="function"),
) -> StaffView:
    row = await _staff_or_404(session, tenant_id, staff_id)
    values = payload.model_dump(exclude_unset=True)
    service_ids = values.pop("serviceIds", None)
    for key, value in values.items():
        setattr(row, {"photoUrl": "photo_url", "isActive": "is_active"}.get(key, key), value)
    if service_ids is not None:
        await _replace_staff_services(session, tenant_id, row.id, service_ids)
    await session.flush()
    await session.refresh(row)
    return await _staff_view(session, row)


@router.delete("/staff/{staff_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_staff(
    staff_id: UUID,
    _owner: PlatformUser = Depends(require_owner),
    tenant_id: UUID = Depends(actor_tenant_id),
    session: AsyncSession = Depends(actor_tenant_db, scope="function"),
) -> Response:
    row = await _staff_or_404(session, tenant_id, staff_id)
    if await session.scalar(select(Appointment.id).where(Appointment.staff_id == row.id).limit(1)):
        row.is_active = False
    else:
        await session.delete(row)
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.get("/public/staff", response_model=list[PublicStaffView])
async def public_staff(
    serviceId: UUID | None = None,
    limit: int = Query(default=200, ge=1, le=500),
    context: TenantContext = Depends(tenant_context),
    session: AsyncSession = Depends(tenant_db, scope="function"),
) -> list[PublicStaffView]:
    query = select(Staff).where(Staff.tenant_id == context.id, Staff.is_active.is_(True))
    if serviceId:
        query = (
            query.join(
                StaffService,
                (StaffService.tenant_id == Staff.tenant_id) & (StaffService.staff_id == Staff.id),
            )
            .join(
                Service,
                (Service.tenant_id == StaffService.tenant_id)
                & (Service.id == StaffService.service_id),
            )
            .where(
                StaffService.service_id == serviceId,
                Service.is_active.is_(True),
            )
        )
    rows = (await session.scalars(query.order_by(Staff.name).limit(limit))).all()
    service_map = await _staff_service_map(
        session,
        tenant_id=context.id,
        staff_ids=[row.id for row in rows],
        active_services_only=True,
    )
    return [
        PublicStaffView.model_validate({**row.__dict__, "service_ids": service_map.get(row.id, [])})
        for row in rows
    ]


def _schedule_exception_type(kind: str) -> ScheduleExceptionType:
    return (
        ScheduleExceptionType.available if kind == "working" else ScheduleExceptionType.unavailable
    )


def _schedule_exception_view(row: ScheduleException) -> ScheduleExceptionView:
    return ScheduleExceptionView.model_validate(
        {
            **row.__dict__,
            "starts_at": row.start_at,
            "ends_at": row.end_at,
        }
    )


async def _schedule_exception_or_404(
    session: AsyncSession,
    tenant_id: UUID,
    staff_id: UUID,
    exception_id: UUID,
    *,
    lock: bool = False,
) -> ScheduleException:
    query = select(ScheduleException).where(
        ScheduleException.tenant_id == tenant_id,
        ScheduleException.staff_id == staff_id,
        ScheduleException.id == exception_id,
    )
    if lock:
        query = query.with_for_update()
    row = await session.scalar(query)
    if row is None:
        raise NotFoundError("Исключение графика не найдено")
    return row


@router.post(
    "/staff/{staff_id}/schedule-exceptions",
    response_model=ScheduleExceptionView,
    status_code=status.HTTP_201_CREATED,
)
async def add_schedule_exception(
    staff_id: UUID,
    payload: ScheduleExceptionCreate,
    _owner: PlatformUser = Depends(require_owner),
    tenant_id: UUID = Depends(actor_tenant_id),
    session: AsyncSession = Depends(actor_tenant_db, scope="function"),
) -> ScheduleExceptionView:
    await _staff_or_404(session, tenant_id, staff_id)
    value = ScheduleException(
        tenant_id=tenant_id,
        staff_id=staff_id,
        start_at=payload.startsAt,
        end_at=payload.endsAt,
        kind=payload.kind,
        type=_schedule_exception_type(payload.kind),
        reason=payload.reason,
    )
    session.add(value)
    await session.flush()
    return _schedule_exception_view(value)


@router.get(
    "/staff/{staff_id}/schedule-exceptions",
    response_model=list[ScheduleExceptionView],
)
async def list_schedule_exceptions(
    staff_id: UUID,
    from_: datetime = Query(alias="from"),
    to: datetime = Query(),
    _actor: PlatformUser = Depends(require_crm_actor),
    tenant_id: UUID = Depends(actor_tenant_id),
    session: AsyncSession = Depends(actor_tenant_db, scope="function"),
) -> list[ScheduleExceptionView]:
    if from_.tzinfo is None or to.tzinfo is None:
        raise BadRequestError("Границы периода должны содержать timezone", code="timezone_required")
    if to <= from_ or to - from_ > timedelta(days=366):
        raise BadRequestError("Некорректный диапазон", code="invalid_date_range")
    await _staff_or_404(session, tenant_id, staff_id)
    rows = (
        await session.scalars(
            select(ScheduleException)
            .where(
                ScheduleException.tenant_id == tenant_id,
                ScheduleException.staff_id == staff_id,
                ScheduleException.start_at < to,
                ScheduleException.end_at > from_,
            )
            .order_by(ScheduleException.start_at)
            .limit(1000)
        )
    ).all()
    return [_schedule_exception_view(row) for row in rows]


@router.patch(
    "/staff/{staff_id}/schedule-exceptions/{exception_id}",
    response_model=ScheduleExceptionView,
)
async def update_schedule_exception(
    staff_id: UUID,
    exception_id: UUID,
    payload: ScheduleExceptionUpdate,
    _owner: PlatformUser = Depends(require_owner),
    tenant_id: UUID = Depends(actor_tenant_id),
    session: AsyncSession = Depends(actor_tenant_db, scope="function"),
) -> ScheduleExceptionView:
    row = await _schedule_exception_or_404(session, tenant_id, staff_id, exception_id, lock=True)
    starts_at = payload.startsAt or row.start_at
    ends_at = payload.endsAt or row.end_at
    if ends_at <= starts_at:
        raise BadRequestError("endsAt должен быть позже startsAt", code="invalid_date_range")
    row.start_at = starts_at
    row.end_at = ends_at
    if payload.kind is not None:
        row.kind = payload.kind
        row.type = _schedule_exception_type(payload.kind)
    if "reason" in payload.model_fields_set:
        row.reason = payload.reason
    await session.flush()
    await session.refresh(row)
    return _schedule_exception_view(row)


@router.delete(
    "/staff/{staff_id}/schedule-exceptions/{exception_id}",
    status_code=status.HTTP_204_NO_CONTENT,
)
async def delete_schedule_exception(
    staff_id: UUID,
    exception_id: UUID,
    _owner: PlatformUser = Depends(require_owner),
    tenant_id: UUID = Depends(actor_tenant_id),
    session: AsyncSession = Depends(actor_tenant_db, scope="function"),
) -> Response:
    row = await _schedule_exception_or_404(session, tenant_id, staff_id, exception_id, lock=True)
    await session.delete(row)
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.get("/clients", response_model=Paginated)
async def list_clients(
    pagination: Pagination = Depends(),
    search: str | None = Query(default=None, max_length=160),
    _actor: PlatformUser = Depends(require_crm_actor),
    tenant_id: UUID = Depends(actor_tenant_id),
    session: AsyncSession = Depends(actor_tenant_db, scope="function"),
) -> Paginated:
    filters = [TenantUser.tenant_id == tenant_id]
    if search:
        pattern = f"%{search.replace('%', r'\%').replace('_', r'\_')}%"
        filters.append(
            or_(
                TenantUser.full_name.ilike(pattern, escape="\\"),
                TenantUser.email.ilike(pattern, escape="\\"),
                TenantUser.phone.ilike(pattern, escape="\\"),
            )
        )
    total = int(
        await session.scalar(select(func.count()).select_from(TenantUser).where(*filters)) or 0
    )
    rows = (
        await session.scalars(
            select(TenantUser)
            .where(*filters)
            .order_by(TenantUser.created_at.desc())
            .offset((pagination.page - 1) * pagination.limit)
            .limit(pagination.limit)
        )
    ).all()
    return Paginated(
        items=[ClientView.model_validate(row) for row in rows],
        total=total,
        page=pagination.page,
        limit=pagination.limit,
    )


@router.post("/clients", response_model=ClientView, status_code=status.HTTP_201_CREATED)
async def create_client(
    payload: ClientCreate,
    _actor: PlatformUser = Depends(require_crm_actor),
    tenant_id: UUID = Depends(actor_tenant_id),
    session: AsyncSession = Depends(actor_tenant_db, scope="function"),
) -> ClientView:
    await lock_tenant_quota(session, tenant_id, "clients")
    access = await plan_access_for_tenant(session, tenant_id)
    client_limit = access.limit("clients")
    count = int(
        await session.scalar(
            select(func.count()).select_from(TenantUser).where(TenantUser.tenant_id == tenant_id)
        )
        or 0
    )
    if client_limit is not None and count >= client_limit:
        raise ConflictError("Достигнут лимит клиентов тарифа", code="client_limit_reached")
    row = TenantUser(
        tenant_id=tenant_id,
        email=str(payload.email).lower() if payload.email else None,
        full_name=payload.fullName,
        phone=payload.phone,
        status=TenantUserStatus.crm_only,
        personal_data_consent_at=datetime.now(UTC) if payload.consent else None,
    )
    session.add(row)
    try:
        await session.flush()
    except IntegrityError as exc:
        raise ConflictError("Клиент с таким email уже существует", code="client_exists") from exc
    return ClientView.model_validate(row)


async def _client_or_404(session: AsyncSession, tenant_id: UUID, client_id: UUID) -> TenantUser:
    row = await session.scalar(
        select(TenantUser).where(TenantUser.tenant_id == tenant_id, TenantUser.id == client_id)
    )
    if row is None:
        raise NotFoundError("Клиент не найден")
    return row


@router.get("/clients/{client_id}", response_model=ClientDetailsView)
async def get_client(
    client_id: UUID,
    _actor: PlatformUser = Depends(require_crm_actor),
    tenant_id: UUID = Depends(actor_tenant_id),
    session: AsyncSession = Depends(actor_tenant_db, scope="function"),
) -> ClientDetailsView:
    row = await _client_or_404(session, tenant_id, client_id)
    appointment_rows = (
        await session.execute(
            select(Appointment, Service.name, Staff.name)
            .join(
                Service,
                (Service.tenant_id == Appointment.tenant_id)
                & (Service.id == Appointment.service_id),
            )
            .outerjoin(
                Staff,
                (Staff.tenant_id == Appointment.tenant_id) & (Staff.id == Appointment.staff_id),
            )
            .where(
                Appointment.tenant_id == tenant_id,
                Appointment.tenant_user_id == client_id,
            )
            .order_by(Appointment.start_at.desc())
        )
    ).all()
    history = [
        ClientAppointmentSummary.model_validate(
            {
                **appointment.__dict__,
                "service_name": service_name,
                "staff_name": staff_name,
            }
        )
        for appointment, service_name, staff_name in appointment_rows
    ]
    return ClientDetailsView.model_validate(
        {
            **row.__dict__,
            "appointment_history": history,
        }
    )


@router.get(
    "/clients/{client_id}/hair-profile",
    response_model=ClientHairProfileView | None,
)
async def get_client_hair_profile(
    client_id: UUID,
    _owner: PlatformUser = Depends(require_owner),
    tenant_id: UUID = Depends(actor_tenant_id),
    session: AsyncSession = Depends(actor_tenant_db, scope="function"),
) -> ClientHairProfileView | None:
    await _client_or_404(session, tenant_id, client_id)
    row = await session.scalar(
        select(ClientHairProfile).where(
            ClientHairProfile.tenant_id == tenant_id,
            ClientHairProfile.client_id == client_id,
        )
    )
    return ClientHairProfileView.model_validate(row) if row is not None else None


@router.put(
    "/clients/{client_id}/hair-profile",
    response_model=ClientHairProfileView,
)
async def put_client_hair_profile(
    client_id: UUID,
    payload: ClientHairProfileUpdate,
    owner: PlatformUser = Depends(require_owner),
    tenant_id: UUID = Depends(actor_tenant_id),
    session: AsyncSession = Depends(actor_tenant_db, scope="function"),
) -> ClientHairProfileView:
    await _client_or_404(session, tenant_id, client_id)
    row = await session.scalar(
        select(ClientHairProfile)
        .where(
            ClientHairProfile.tenant_id == tenant_id,
            ClientHairProfile.client_id == client_id,
        )
        .with_for_update()
    )
    expected_version = payload.expectedVersion
    if row is None:
        if expected_version not in (None, 0):
            raise ConflictError(
                "Профиль волос уже изменён в другой сессии",
                code="hair_profile_version_conflict",
            )
        row = ClientHairProfile(
            tenant_id=tenant_id,
            client_id=client_id,
            version=1,
            updated_by_id=owner.id,
        )
        session.add(row)
    else:
        if expected_version is not None and expected_version != row.version:
            raise ConflictError(
                "Профиль волос уже изменён в другой сессии",
                code="hair_profile_version_conflict",
            )
        row.version += 1
        row.updated_by_id = owner.id

    mapping = {
        "hairLength": "hair_length",
        "conditionNotes": "condition_notes",
        "scalpSensitivityNotes": "scalp_sensitivity_notes",
        "grayPercentage": "gray_percentage",
        "naturalColor": "natural_color",
        "currentColor": "current_color",
        "colorHistory": "color_history",
        "beardLength": "beard_length",
        "beardStyle": "beard_style",
        "moustacheStyle": "moustache_style",
    }
    for key, value in payload.model_dump(
        exclude_unset=True,
        exclude={"expectedVersion"},
    ).items():
        setattr(row, mapping.get(key, key), value)
    try:
        await session.flush()
    except IntegrityError as exc:
        raise ConflictError(
            "Профиль волос уже создан в другой сессии",
            code="hair_profile_version_conflict",
        ) from exc
    await session.refresh(row)
    return ClientHairProfileView.model_validate(row)


@router.patch("/clients/{client_id}", response_model=ClientView)
async def update_client(
    client_id: UUID,
    payload: ClientUpdate,
    request: Request,
    _actor: PlatformUser = Depends(require_crm_actor),
    tenant_id: UUID = Depends(actor_tenant_id),
    session: AsyncSession = Depends(actor_tenant_db, scope="function"),
) -> ClientView:
    row = await _client_or_404(session, tenant_id, client_id)
    values = payload.model_dump(exclude_unset=True)
    if values.get("status") == "anonymized":
        storage = getattr(request.app.state, "storage", None)
        if storage is None:
            raise ServiceUnavailableError(
                "Хранилище медиа временно недоступно", code="media_storage_unavailable"
            )
        try:
            await erase_tenant_user_media(
                storage,
                tenant_id=tenant_id,
                keys=await tenant_user_media_keys(session, row),
            )
        except (StorageError, ValueError) as exc:
            raise ServiceUnavailableError(
                "Хранилище медиа временно недоступно", code="media_storage_unavailable"
            ) from exc
        await anonymize_tenant_user(session, row)
    else:
        _apply(row, payload, {"fullName": "full_name"})
    try:
        await session.flush()
    except IntegrityError as exc:
        raise ConflictError("Клиент с таким email уже существует", code="client_exists") from exc
    return ClientView.model_validate(row)
