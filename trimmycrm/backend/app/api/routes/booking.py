from __future__ import annotations

from datetime import UTC, date, datetime, timedelta
from typing import Any
from uuid import UUID

from fastapi import APIRouter, Depends, Header, Query, status
from sqlalchemy import and_, func, select, text, update
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import (
    TenantContext,
    actor_tenant_db,
    actor_tenant_id,
    current_tenant_user,
    require_crm_actor,
    settings_dep,
    tenant_context,
    tenant_db,
)
from app.core.config import Settings
from app.core.errors import BadRequestError, ConflictError, NotFoundError
from app.models import (
    Appointment,
    AppointmentItem,
    AppointmentItemAddon,
    AppointmentStatus,
    IdempotencyKey,
    IdempotencyStatus,
    Notification,
    NotificationStatus,
    Pet,
    PlatformUser,
    Service,
    Site,
    Staff,
    StaffService,
    TenantUser,
)
from app.schemas import (
    AdminAppointmentCreate,
    AppointmentItemAddonView,
    AppointmentItemView,
    AppointmentUpdate,
    AppointmentView,
    BookingCreate,
    CancelRequest,
    Message,
    Paginated,
    Pagination,
    RescheduleRequest,
    SlotsResponse,
    SlotView,
)
from app.services.booking import available_slots, booking_request_hash, create_appointment
from app.services.scheduling import parse_timezone

router = APIRouter(tags=["booking"])


async def _appointment_item_views(
    session: AsyncSession, appointment_id: UUID
) -> list[AppointmentItemView]:
    items = (
        await session.scalars(
            select(AppointmentItem)
            .where(AppointmentItem.appointment_id == appointment_id)
            .order_by(AppointmentItem.sort_order, AppointmentItem.created_at)
        )
    ).all()
    if not items:
        return []
    addons = (
        await session.scalars(
            select(AppointmentItemAddon)
            .where(AppointmentItemAddon.appointment_item_id.in_([item.id for item in items]))
            .order_by(AppointmentItemAddon.sort_order, AppointmentItemAddon.created_at)
        )
    ).all()
    addons_by_item: dict[UUID, list[AppointmentItemAddonView]] = {}
    for addon in addons:
        addons_by_item.setdefault(addon.appointment_item_id, []).append(
            AppointmentItemAddonView.model_validate(
                {
                    "id": addon.id,
                    "addon_id": addon.addon_id,
                    "name": addon.name_snapshot,
                    "price": addon.price_snapshot,
                    "duration_min": addon.duration_min_snapshot,
                }
            )
        )
    return [
        AppointmentItemView.model_validate(
            {
                "id": item.id,
                "service_id": item.service_id,
                "variant_id": item.variant_id,
                "assigned_staff_id": item.assigned_staff_id,
                "service_name": item.service_name_snapshot,
                "variant_label": item.variant_label_snapshot,
                "selected_options": item.selected_options,
                "unit_price": item.unit_price,
                "final_price": item.final_price,
                "duration_min": item.duration_min,
                "buffer_before_min": item.buffer_before_min,
                "buffer_after_min": item.buffer_after_min,
                "currency": item.currency,
                "sort_order": item.sort_order,
                "adjustment_reason": item.adjustment_reason,
                "addons": addons_by_item.get(item.id, []),
            }
        )
        for item in items
    ]


async def _appointment_view(session: AsyncSession, row: Appointment) -> AppointmentView:
    names = (
        await session.execute(
            select(TenantUser.full_name, Pet.name, Service.name, Staff.name)
            .select_from(Appointment)
            .join(Pet, and_(Pet.tenant_id == Appointment.tenant_id, Pet.id == Appointment.pet_id))
            .join(
                Service,
                and_(
                    Service.tenant_id == Appointment.tenant_id, Service.id == Appointment.service_id
                ),
            )
            .join(
                TenantUser,
                and_(
                    TenantUser.tenant_id == Appointment.tenant_id,
                    TenantUser.id == Appointment.tenant_user_id,
                ),
            )
            .outerjoin(
                Staff,
                and_(Staff.tenant_id == Appointment.tenant_id, Staff.id == Appointment.staff_id),
            )
            .where(Appointment.id == row.id)
        )
    ).one()
    return AppointmentView.model_validate(
        {
            **row.__dict__,
            "client_name": names[0],
            "pet_name": names[1],
            "service_name": names[2],
            "staff_name": names[3],
            "items": await _appointment_item_views(session, row.id),
        }
    )


@router.get("/booking/slots", response_model=SlotsResponse)
async def slots(
    serviceId: UUID,
    staffId: UUID,
    date_: date = Query(alias="date"),
    context: TenantContext = Depends(tenant_context),
    session: AsyncSession = Depends(tenant_db, scope="function"),
) -> SlotsResponse:
    site_row = await session.get(Site, context.id)
    if site_row is None:
        raise NotFoundError("Салон не найден")
    local_today = datetime.now(
        parse_timezone(getattr(site_row, "timezone", "Europe/Moscow"))
    ).date()
    if date_ < local_today or date_ > local_today + timedelta(days=180):
        raise BadRequestError(
            "Дата вне доступного периода записи", code="booking_date_out_of_range"
        )
    site, service, staff, values = await available_slots(
        session,
        tenant_id=context.id,
        service_id=serviceId,
        staff_id=staffId,
        day=date_,
        include_unavailable=True,
    )
    return SlotsResponse(
        timezone=getattr(site, "timezone", "Europe/Moscow"),
        serviceId=service.id,
        staffId=staff.id,
        slots=[
            SlotView(startAt=value.starts_at, endAt=value.ends_at, available=available)
            for value, available in values
        ],
    )


async def _idempotency_start(
    session: AsyncSession,
    *,
    tenant_id: UUID,
    user_id: UUID,
    key: str | None,
    request_hash: str,
) -> tuple[IdempotencyKey | None, AppointmentView | None]:
    if key is None:
        return None, None
    if not 8 <= len(key) <= 128:
        raise BadRequestError("Некорректный Idempotency-Key", code="invalid_idempotency_key")
    scope = f"booking:{tenant_id}:{user_id}"
    await session.execute(
        text("SELECT pg_advisory_xact_lock(hashtextextended(:value, 1))"),
        {"value": f"{scope}:{key}"},
    )
    existing = await session.scalar(
        select(IdempotencyKey)
        .where(IdempotencyKey.scope == scope, IdempotencyKey.key == key)
        .with_for_update()
    )
    if existing is not None:
        if existing.request_hash != request_hash:
            raise ConflictError(
                "Ключ уже использован для другого запроса", code="idempotency_mismatch"
            )
        if existing.status is IdempotencyStatus.completed and existing.response_body:
            return existing, AppointmentView.model_validate(existing.response_body)
        if existing.status is IdempotencyStatus.processing:
            raise ConflictError("Запрос уже обрабатывается", code="request_in_progress")
        existing.status = IdempotencyStatus.processing
        existing.response_body = None
        return existing, None
    row = IdempotencyKey(
        tenant_id=tenant_id,
        scope=scope,
        key=key,
        request_hash=request_hash,
        status=IdempotencyStatus.processing,
        expires_at=datetime.now(UTC) + timedelta(hours=24),
    )
    session.add(row)
    await session.flush()
    return row, None


@router.post("/booking", response_model=AppointmentView, status_code=status.HTTP_201_CREATED)
async def book(
    payload: BookingCreate,
    idempotency_key: str | None = Header(default=None, alias="Idempotency-Key"),
    user: TenantUser = Depends(current_tenant_user),
    context: TenantContext = Depends(tenant_context),
    session: AsyncSession = Depends(tenant_db, scope="function"),
) -> AppointmentView:
    request_hash = booking_request_hash(payload.model_dump(mode="json"))
    idem, cached = await _idempotency_start(
        session,
        tenant_id=context.id,
        user_id=user.id,
        key=idempotency_key,
        request_hash=request_hash,
    )
    if cached is not None:
        return cached
    try:
        async with session.begin_nested():
            row = await create_appointment(
                session,
                tenant_id=context.id,
                tenant_user_id=user.id,
                pet_id=payload.petId,
                service_id=payload.serviceId,
                staff_id=payload.staffId,
                start_at=payload.startAt,
                promotion_code=payload.promotionCode,
            )
    except IntegrityError as exc:
        if idem is not None:
            idem.status = IdempotencyStatus.failed
        raise ConflictError("Выбранный слот уже занят", code="slot_unavailable") from exc
    result = await _appointment_view(session, row)
    if idem is not None:
        idem.status = IdempotencyStatus.completed
        idem.response_status = status.HTTP_201_CREATED
        idem.response_body = result.model_dump(mode="json")
    return result


@router.get("/appointments/mine", response_model=Paginated)
async def my_appointments(
    pagination: Pagination = Depends(),
    petId: UUID | None = None,
    status_: AppointmentStatus | None = Query(default=None, alias="status"),
    from_: datetime | None = Query(default=None, alias="from"),
    to: datetime | None = None,
    user: TenantUser = Depends(current_tenant_user),
    session: AsyncSession = Depends(tenant_db, scope="function"),
) -> Paginated:
    if (from_ is not None and from_.tzinfo is None) or (to is not None and to.tzinfo is None):
        raise BadRequestError("Границы периода должны содержать timezone", code="timezone_required")
    if from_ is not None and to is not None and to <= from_:
        raise BadRequestError("Некорректный диапазон", code="invalid_date_range")
    filters: list[Any] = [Appointment.tenant_user_id == user.id]
    if petId:
        filters.append(Appointment.pet_id == petId)
    if status_:
        filters.append(Appointment.status == status_)
    if from_:
        filters.append(Appointment.start_at >= from_)
    if to:
        filters.append(Appointment.start_at < to)
    total = int(
        await session.scalar(select(func.count()).select_from(Appointment).where(*filters)) or 0
    )
    rows = (
        await session.scalars(
            select(Appointment)
            .where(*filters)
            .order_by(Appointment.start_at.desc())
            .offset((pagination.page - 1) * pagination.limit)
            .limit(pagination.limit)
        )
    ).all()
    return Paginated(
        items=[await _appointment_view(session, row) for row in rows],
        total=total,
        page=pagination.page,
        limit=pagination.limit,
    )


async def _client_appointment(
    session: AsyncSession, appointment_id: UUID, user_id: UUID, *, lock: bool = False
) -> Appointment:
    query = select(Appointment).where(
        Appointment.id == appointment_id, Appointment.tenant_user_id == user_id
    )
    if lock:
        query = query.with_for_update()
    row = await session.scalar(query)
    if row is None:
        raise NotFoundError("Запись не найдена")
    return row


@router.post("/appointments/{appointment_id}/cancel", response_model=Message)
async def cancel_appointment(
    appointment_id: UUID,
    payload: CancelRequest,
    user: TenantUser = Depends(current_tenant_user),
    session: AsyncSession = Depends(tenant_db, scope="function"),
    settings: Settings = Depends(settings_dep),
) -> Message:
    row = await _client_appointment(session, appointment_id, user.id, lock=True)
    if row.status not in {AppointmentStatus.new, AppointmentStatus.confirmed}:
        raise ConflictError("Эту запись уже нельзя отменить", code="invalid_appointment_status")
    if row.prepaid:
        raise ConflictError(
            "Для отмены предоплаченной записи свяжитесь с салоном",
            code="prepaid_cancellation_requires_staff",
        )
    cutoff = timedelta(hours=settings.cancellation_cutoff_hours)
    if row.start_at - datetime.now(UTC) < cutoff:
        raise ConflictError("Срок самостоятельной отмены истёк", code="cancellation_cutoff")
    row.status = AppointmentStatus.cancelled
    row.canceled_at = datetime.now(UTC)
    row.cancellation_reason = payload.reason
    row.version += 1
    await session.execute(
        update(Notification)
        .where(
            Notification.tenant_id == row.tenant_id,
            Notification.status == NotificationStatus.queued,
            Notification.payload["appointmentId"].astext == str(row.id),
        )
        .values(status=NotificationStatus.canceled)
    )
    return Message(message="Запись отменена")


@router.post("/appointments/{appointment_id}/reschedule", response_model=AppointmentView)
async def reschedule_appointment(
    appointment_id: UUID,
    payload: RescheduleRequest,
    user: TenantUser = Depends(current_tenant_user),
    context: TenantContext = Depends(tenant_context),
    session: AsyncSession = Depends(tenant_db, scope="function"),
    settings: Settings = Depends(settings_dep),
) -> AppointmentView:
    row = await _client_appointment(session, appointment_id, user.id, lock=True)
    if row.status not in {AppointmentStatus.new, AppointmentStatus.confirmed}:
        raise ConflictError("Эту запись уже нельзя перенести", code="invalid_appointment_status")
    if payload.expectedVersion is not None and payload.expectedVersion != row.version:
        raise ConflictError("Запись уже была изменена", code="version_conflict")
    cutoff = timedelta(hours=settings.cancellation_cutoff_hours)
    if row.start_at - datetime.now(UTC) < cutoff:
        raise ConflictError("Срок самостоятельного переноса истёк", code="reschedule_cutoff")
    new_staff = payload.staffId or row.staff_id
    if new_staff is None:
        raise BadRequestError("Выберите мастера", code="staff_required")
    if payload.startAt.tzinfo is None:
        raise BadRequestError("startAt должен содержать timezone", code="timezone_required")
    lock_key = f"appointment-schedule:{context.id}:{new_staff}"
    await session.execute(
        text("SELECT pg_advisory_xact_lock(hashtextextended(:key, 0))"),
        {"key": lock_key},
    )
    site = await session.get(Site, context.id)
    if site is None:
        raise NotFoundError("Салон не найден")
    local_day = payload.startAt.astimezone(
        parse_timezone(getattr(site, "timezone", "Europe/Moscow"))
    ).date()
    _site, _service, _staff, candidate_slots = await available_slots(
        session,
        tenant_id=context.id,
        service_id=row.service_id,
        staff_id=new_staff,
        day=local_day,
        include_unavailable=True,
        exclude_appointment_id=row.id,
    )
    normalized_start = payload.startAt.astimezone(UTC)
    chosen = next(
        (
            value
            for value, is_available in candidate_slots
            if is_available and value.starts_at.astimezone(UTC) == normalized_start
        ),
        None,
    )
    if chosen is None:
        raise ConflictError("Выбранный слот недоступен", code="slot_unavailable")
    row.staff_id = new_staff
    row.start_at = chosen.starts_at.astimezone(UTC)
    row.end_at = chosen.ends_at.astimezone(UTC)
    row.version += 1
    await session.execute(
        update(Notification)
        .where(
            Notification.tenant_id == row.tenant_id,
            Notification.status == NotificationStatus.queued,
            Notification.payload["appointmentId"].astext == str(row.id),
        )
        .values(status=NotificationStatus.canceled)
    )
    try:
        async with session.begin_nested():
            await session.flush()
    except IntegrityError as exc:
        raise ConflictError("Выбранный слот уже занят", code="slot_unavailable") from exc
    return await _appointment_view(session, row)


@router.get("/pets/{pet_id}/appointments", response_model=list[AppointmentView])
async def pet_appointments(
    pet_id: UUID,
    scope: str = Query(default="history", pattern="^(upcoming|history|all)$"),
    user: TenantUser = Depends(current_tenant_user),
    session: AsyncSession = Depends(tenant_db, scope="function"),
) -> list[AppointmentView]:
    pet = await session.scalar(select(Pet.id).where(Pet.id == pet_id, Pet.owner_id == user.id))
    if pet is None:
        raise NotFoundError("Питомец не найден")
    query = select(Appointment).where(
        Appointment.pet_id == pet_id, Appointment.tenant_user_id == user.id
    )
    now = datetime.now(UTC)
    if scope == "upcoming":
        query = query.where(Appointment.start_at >= now)
    elif scope == "history":
        query = query.where(Appointment.start_at < now)
    rows = (await session.scalars(query.order_by(Appointment.start_at.desc()))).all()
    return [await _appointment_view(session, row) for row in rows]


@router.get("/admin/appointments", response_model=list[AppointmentView])
async def admin_appointments(
    from_: datetime = Query(alias="from"),
    to: datetime = Query(),
    staffId: UUID | None = None,
    serviceId: UUID | None = None,
    tenantUserId: UUID | None = None,
    status_: AppointmentStatus | None = Query(default=None, alias="status"),
    _actor: PlatformUser = Depends(require_crm_actor),
    tenant_id: UUID = Depends(actor_tenant_id),
    session: AsyncSession = Depends(actor_tenant_db, scope="function"),
) -> list[AppointmentView]:
    if from_.tzinfo is None or to.tzinfo is None:
        raise BadRequestError("Границы периода должны содержать timezone", code="timezone_required")
    if to <= from_ or to - from_ > timedelta(days=93):
        raise BadRequestError("Некорректный диапазон календаря", code="invalid_date_range")
    filters: list[Any] = [
        Appointment.tenant_id == tenant_id,
        Appointment.start_at < to,
        Appointment.end_at > from_,
    ]
    if staffId:
        filters.append(Appointment.staff_id == staffId)
    if serviceId:
        filters.append(Appointment.service_id == serviceId)
    if tenantUserId:
        filters.append(Appointment.tenant_user_id == tenantUserId)
    if status_:
        filters.append(Appointment.status == status_)
    rows = (
        await session.scalars(select(Appointment).where(*filters).order_by(Appointment.start_at))
    ).all()
    return [await _appointment_view(session, row) for row in rows]


@router.post(
    "/admin/appointments", response_model=AppointmentView, status_code=status.HTTP_201_CREATED
)
async def admin_create_appointment(
    payload: AdminAppointmentCreate,
    _actor: PlatformUser = Depends(require_crm_actor),
    tenant_id: UUID = Depends(actor_tenant_id),
    session: AsyncSession = Depends(actor_tenant_db, scope="function"),
) -> AppointmentView:
    if payload.startAt.tzinfo is None:
        raise BadRequestError("startAt должен содержать timezone", code="timezone_required")
    staff_id = payload.staffId
    if staff_id is None:
        site = await session.get(Site, tenant_id)
        if site is None:
            raise NotFoundError("Салон не найден")
        local_day = payload.startAt.astimezone(
            parse_timezone(getattr(site, "timezone", "Europe/Moscow"))
        ).date()
        staff_ids = list(
            await session.scalars(
                select(StaffService.staff_id).where(
                    StaffService.tenant_id == tenant_id,
                    StaffService.service_id == payload.serviceId,
                )
            )
        )
        for candidate in staff_ids:
            try:
                _site, _service, _staff, candidate_slots = await available_slots(
                    session,
                    tenant_id=tenant_id,
                    service_id=payload.serviceId,
                    staff_id=candidate,
                    day=local_day,
                )
                if any(
                    slot.starts_at == payload.startAt and available
                    for slot, available in candidate_slots
                ):
                    staff_id = candidate
                    break
            except (BadRequestError, NotFoundError):
                continue
    if staff_id is None:
        raise ConflictError("Нет свободного мастера", code="staff_unavailable")
    try:
        async with session.begin_nested():
            row = await create_appointment(
                session,
                tenant_id=tenant_id,
                tenant_user_id=payload.tenantUserId,
                pet_id=payload.petId,
                service_id=payload.serviceId,
                staff_id=staff_id,
                start_at=payload.startAt,
                notes=payload.notes,
            )
    except IntegrityError as exc:
        raise ConflictError("Выбранный слот уже занят", code="slot_unavailable") from exc
    return await _appointment_view(session, row)


_TRANSITIONS = {
    AppointmentStatus.new: {AppointmentStatus.confirmed, AppointmentStatus.cancelled},
    AppointmentStatus.confirmed: {
        AppointmentStatus.completed,
        AppointmentStatus.cancelled,
        AppointmentStatus.no_show,
    },
    AppointmentStatus.completed: set(),
    AppointmentStatus.cancelled: set(),
    AppointmentStatus.no_show: set(),
}


@router.patch("/admin/appointments/{appointment_id}", response_model=AppointmentView)
async def admin_update_appointment(
    appointment_id: UUID,
    payload: AppointmentUpdate,
    _actor: PlatformUser = Depends(require_crm_actor),
    tenant_id: UUID = Depends(actor_tenant_id),
    session: AsyncSession = Depends(actor_tenant_db, scope="function"),
) -> AppointmentView:
    row = await session.scalar(
        select(Appointment)
        .where(Appointment.tenant_id == tenant_id, Appointment.id == appointment_id)
        .with_for_update()
    )
    if row is None:
        raise NotFoundError("Запись не найдена")
    if payload.expectedVersion is not None and payload.expectedVersion != row.version:
        raise ConflictError("Запись уже была изменена", code="version_conflict")
    if payload.status is not None:
        new_status = AppointmentStatus(payload.status)
        if new_status != row.status and new_status not in _TRANSITIONS[row.status]:
            raise ConflictError("Недопустимый переход статуса", code="invalid_status_transition")
        row.status = new_status
        if new_status is AppointmentStatus.cancelled:
            row.canceled_at = datetime.now(UTC)
            await session.execute(
                update(Notification)
                .where(
                    Notification.tenant_id == row.tenant_id,
                    Notification.status == NotificationStatus.queued,
                    Notification.payload["appointmentId"].astext == str(row.id),
                )
                .values(status=NotificationStatus.canceled)
            )
    if payload.startAt is not None or payload.staffId is not None:
        if row.status not in {AppointmentStatus.new, AppointmentStatus.confirmed}:
            raise ConflictError(
                "Завершённую или отменённую запись нельзя перенести",
                code="invalid_appointment_status",
            )
        new_start = payload.startAt or row.start_at
        new_staff = payload.staffId or row.staff_id
        if new_staff is None:
            raise BadRequestError("Выберите мастера", code="staff_required")
        if new_start.tzinfo is None:
            raise BadRequestError("startAt должен содержать timezone", code="timezone_required")
        lock_key = f"appointment-schedule:{tenant_id}:{new_staff}"
        await session.execute(
            text("SELECT pg_advisory_xact_lock(hashtextextended(:key, 0))"),
            {"key": lock_key},
        )
        site = await session.get(Site, tenant_id)
        if site is None:
            raise NotFoundError("Салон не найден")
        local_day = new_start.astimezone(
            parse_timezone(getattr(site, "timezone", "Europe/Moscow"))
        ).date()
        _site, _service, _staff, candidate_slots = await available_slots(
            session,
            tenant_id=tenant_id,
            service_id=row.service_id,
            staff_id=new_staff,
            day=local_day,
            include_unavailable=True,
            exclude_appointment_id=row.id,
        )
        normalized_start = new_start.astimezone(UTC)
        chosen = next(
            (
                value
                for value, is_available in candidate_slots
                if is_available and value.starts_at.astimezone(UTC) == normalized_start
            ),
            None,
        )
        if chosen is None:
            raise ConflictError("Выбранный слот недоступен", code="slot_unavailable")
        row.start_at = chosen.starts_at.astimezone(UTC)
        row.end_at = chosen.ends_at.astimezone(UTC)
        row.staff_id = new_staff
        await session.execute(
            update(Notification)
            .where(
                Notification.tenant_id == row.tenant_id,
                Notification.status == NotificationStatus.queued,
                Notification.payload["appointmentId"].astext == str(row.id),
            )
            .values(status=NotificationStatus.canceled)
        )
    if payload.notes is not None:
        row.notes = payload.notes
    row.version += 1
    try:
        async with session.begin_nested():
            await session.flush()
    except IntegrityError as exc:
        raise ConflictError("Выбранный слот уже занят", code="slot_unavailable") from exc
    return await _appointment_view(session, row)
