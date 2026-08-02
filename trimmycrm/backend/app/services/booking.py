from __future__ import annotations

import hashlib
import json
import uuid
from dataclasses import dataclass
from datetime import UTC, date, datetime, time, timedelta
from decimal import Decimal
from typing import Any

from sqlalchemy import select, text
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.errors import BadRequestError, ConflictError, NotFoundError
from app.models import (
    Appointment,
    AppointmentItem,
    AppointmentItemAddon,
    AppointmentStatus,
    Pet,
    Promotion,
    ScheduleException,
    ScheduleExceptionType,
    Service,
    ServiceAddon,
    ServiceVariant,
    Site,
    Staff,
    StaffService,
)
from app.services.booking_pricing import (
    AppointmentQuote,
    BookingItemSelection,
    BookingQuoteError,
    CatalogAddonChoice,
    CatalogBookingItem,
    CatalogVariantChoice,
    calculate_appointment_quote,
)
from app.services.scheduling import (
    ScheduleError,
    ScheduleExceptionValue,
    TimeRange,
    assert_slot_matches,
    generate_slots,
    parse_timezone,
)


@dataclass(frozen=True, slots=True)
class AppointmentSlotRequirements:
    service_ids: tuple[uuid.UUID, ...]
    duration_min: int
    buffer_before_min: int
    buffer_after_min: int


async def available_slots(
    session: AsyncSession,
    *,
    tenant_id: uuid.UUID,
    service_id: uuid.UUID,
    staff_id: uuid.UUID,
    day: date,
    include_unavailable: bool = True,
    exclude_appointment_id: uuid.UUID | None = None,
    duration_min_override: int | None = None,
    buffer_before_min_override: int | None = None,
    buffer_after_min_override: int | None = None,
) -> tuple[Site, Service, Staff, list[tuple[TimeRange, bool]]]:
    site = await session.get(Site, tenant_id)
    service = await session.scalar(
        select(Service).where(
            Service.tenant_id == tenant_id,
            Service.id == service_id,
            Service.is_active.is_(True),
        )
    )
    staff = await session.scalar(
        select(Staff).where(
            Staff.tenant_id == tenant_id,
            Staff.id == staff_id,
            Staff.is_active.is_(True),
        )
    )
    if site is None or service is None:
        raise NotFoundError("Услуга не найдена")
    if staff is None:
        raise NotFoundError("Мастер не найден")
    capability = await session.scalar(
        select(StaffService).where(
            StaffService.tenant_id == tenant_id,
            StaffService.staff_id == staff_id,
            StaffService.service_id == service_id,
        )
    )
    if capability is None:
        raise BadRequestError("Мастер не оказывает выбранную услугу", code="staff_service_mismatch")

    timezone = getattr(site, "timezone", "Europe/Moscow")
    tz = parse_timezone(timezone)
    local_start = datetime.combine(day, time.min, tzinfo=tz)
    local_end = local_start + timedelta(days=1)
    appointment_filters = [
        Appointment.tenant_id == tenant_id,
        Appointment.staff_id == staff_id,
        Appointment.status.in_([AppointmentStatus.new, AppointmentStatus.confirmed]),
        Appointment.start_at < local_end.astimezone(UTC),
        Appointment.end_at > local_start.astimezone(UTC),
    ]
    if exclude_appointment_id is not None:
        appointment_filters.append(Appointment.id != exclude_appointment_id)
    appointment_rows = (
        await session.execute(
            select(Appointment, Service)
            .join(
                Service,
                (Service.tenant_id == Appointment.tenant_id)
                & (Service.id == Appointment.service_id),
            )
            .where(*appointment_filters)
        )
    ).all()
    snapshot_buffers: dict[uuid.UUID, tuple[int, int]] = {}
    if appointment_rows:
        snapshot_items = (
            await session.scalars(
                select(AppointmentItem)
                .where(
                    AppointmentItem.tenant_id == tenant_id,
                    AppointmentItem.appointment_id.in_(
                        [appointment.id for appointment, _service in appointment_rows]
                    ),
                )
                .order_by(
                    AppointmentItem.appointment_id,
                    AppointmentItem.sort_order,
                    AppointmentItem.created_at,
                )
            )
        ).all()
        for item in snapshot_items:
            previous = snapshot_buffers.get(item.appointment_id)
            snapshot_buffers[item.appointment_id] = (
                item.buffer_before_min if previous is None else previous[0],
                item.buffer_after_min,
            )
    exceptions = (
        await session.scalars(
            select(ScheduleException).where(
                ScheduleException.tenant_id == tenant_id,
                ScheduleException.staff_id == staff_id,
                ScheduleException.start_at < local_end.astimezone(UTC),
                ScheduleException.end_at > local_start.astimezone(UTC),
            )
        )
    ).all()
    duration = duration_min_override or capability.custom_duration_min or service.duration_min
    slots = generate_slots(
        day=day,
        timezone=timezone,
        salon_schedule=site.work_hours,
        staff_schedule=staff.schedule,
        duration_min=duration,
        buffer_before_min=(
            buffer_before_min_override
            if buffer_before_min_override is not None
            else getattr(service, "buffer_before_min", 0)
        ),
        buffer_after_min=(
            buffer_after_min_override
            if buffer_after_min_override is not None
            else getattr(service, "buffer_after_min", 0)
        ),
        appointments=[
            TimeRange(
                appointment.start_at
                - timedelta(
                    minutes=snapshot_buffers.get(
                        appointment.id,
                        (getattr(appointment_service, "buffer_before_min", 0), 0),
                    )[0]
                ),
                appointment.end_at
                + timedelta(
                    minutes=snapshot_buffers.get(
                        appointment.id,
                        (0, getattr(appointment_service, "buffer_after_min", 0)),
                    )[1]
                ),
            )
            for appointment, appointment_service in appointment_rows
        ],
        exceptions=[
            ScheduleExceptionValue(
                row.start_at,
                row.end_at,
                "working" if row.type is ScheduleExceptionType.available else "unavailable",
            )
            for row in exceptions
        ],
        include_unavailable=include_unavailable,
    )
    return site, service, staff, slots


async def appointment_slot_requirements(
    session: AsyncSession,
    *,
    tenant_id: uuid.UUID,
    appointment_id: uuid.UUID,
) -> AppointmentSlotRequirements:
    items = (
        await session.scalars(
            select(AppointmentItem)
            .where(
                AppointmentItem.tenant_id == tenant_id,
                AppointmentItem.appointment_id == appointment_id,
            )
            .order_by(AppointmentItem.sort_order, AppointmentItem.created_at)
        )
    ).all()
    if not items:
        raise ConflictError(
            "У записи отсутствуют позиции услуг",
            code="appointment_items_missing",
        )
    return AppointmentSlotRequirements(
        service_ids=tuple(item.service_id for item in items),
        duration_min=sum(item.duration_min for item in items),
        buffer_before_min=items[0].buffer_before_min,
        buffer_after_min=items[-1].buffer_after_min,
    )


async def ensure_staff_can_perform(
    session: AsyncSession,
    *,
    tenant_id: uuid.UUID,
    staff_id: uuid.UUID,
    service_ids: tuple[uuid.UUID, ...],
) -> None:
    capabilities = set(
        await session.scalars(
            select(StaffService.service_id).where(
                StaffService.tenant_id == tenant_id,
                StaffService.staff_id == staff_id,
                StaffService.service_id.in_(service_ids),
            )
        )
    )
    if capabilities != set(service_ids):
        raise BadRequestError(
            "Мастер оказывает не все услуги этой записи",
            code="staff_service_mismatch",
        )


async def resolve_booking_quote(
    session: AsyncSession,
    *,
    tenant_id: uuid.UUID,
    staff_id: uuid.UUID,
    items: tuple[BookingItemSelection, ...],
    require_online_booking: bool,
) -> AppointmentQuote:
    if not items:
        raise BadRequestError("Добавьте хотя бы одну услугу", code="invalid_booking_items")
    service_ids = [item.service_id for item in items]
    service_query = select(Service).where(
        Service.tenant_id == tenant_id,
        Service.id.in_(service_ids),
        Service.is_active.is_(True),
    )
    if require_online_booking:
        service_query = service_query.where(Service.allow_online_booking.is_(True))
    services = (await session.scalars(service_query)).all()
    services_by_id = {service.id: service for service in services}
    if any(service_id not in services_by_id for service_id in service_ids):
        raise NotFoundError("Услуга недоступна для записи", code="service_unavailable")

    capabilities = (
        await session.scalars(
            select(StaffService).where(
                StaffService.tenant_id == tenant_id,
                StaffService.staff_id == staff_id,
                StaffService.service_id.in_(service_ids),
            )
        )
    ).all()
    capabilities_by_service = {capability.service_id: capability for capability in capabilities}
    if any(service_id not in capabilities_by_service for service_id in service_ids):
        raise BadRequestError(
            "Мастер оказывает не все выбранные услуги",
            code="staff_service_mismatch",
        )

    variant_ids = [item.variant_id for item in items if item.variant_id is not None]
    variants = (
        (
            await session.scalars(
                select(ServiceVariant).where(
                    ServiceVariant.tenant_id == tenant_id,
                    ServiceVariant.id.in_(variant_ids),
                    ServiceVariant.is_active.is_(True),
                )
            )
        ).all()
        if variant_ids
        else []
    )
    variants_by_key = {(variant.service_id, variant.id): variant for variant in variants}

    addon_ids = [addon_id for item in items for addon_id in item.addon_ids]
    addons = (
        (
            await session.scalars(
                select(ServiceAddon).where(
                    ServiceAddon.tenant_id == tenant_id,
                    ServiceAddon.id.in_(addon_ids),
                    ServiceAddon.is_active.is_(True),
                )
            )
        ).all()
        if addon_ids
        else []
    )
    addons_by_key = {(addon.service_id, addon.id): addon for addon in addons}

    catalog_items: list[CatalogBookingItem] = []
    for selection in items:
        service = services_by_id[selection.service_id]
        capability = capabilities_by_service[selection.service_id]
        if service.variant_selection_required and selection.variant_id is None:
            raise BadRequestError(
                f"Для услуги «{service.name}» выберите вариант",
                code="variant_required",
            )
        variant = (
            variants_by_key.get((selection.service_id, selection.variant_id))
            if selection.variant_id is not None
            else None
        )
        if selection.variant_id is not None and variant is None:
            raise BadRequestError(
                "Вариант недоступен для выбранной услуги",
                code="invalid_service_variant",
            )
        selected_addons = []
        for addon_id in selection.addon_ids:
            addon = addons_by_key.get((selection.service_id, addon_id))
            if addon is None:
                raise BadRequestError(
                    "Дополнение недоступно для выбранной услуги",
                    code="invalid_service_addon",
                )
            selected_addons.append(
                CatalogAddonChoice(
                    id=addon.id,
                    name=addon.name,
                    price_delta=addon.price_delta,
                    duration_delta_min=addon.duration_delta_min,
                )
            )
        catalog_items.append(
            CatalogBookingItem(
                service_id=service.id,
                service_name=service.name,
                base_price=(
                    capability.custom_price
                    if capability.custom_price is not None
                    else service.price
                ),
                base_duration_min=(
                    capability.custom_duration_min
                    if capability.custom_duration_min is not None
                    else service.duration_min
                ),
                buffer_before_min=service.buffer_before_min,
                buffer_after_min=service.buffer_after_min,
                currency=service.currency,
                variant=(
                    CatalogVariantChoice(
                        id=variant.id,
                        label=variant.label,
                        price_delta=variant.price_delta,
                        duration_delta_min=variant.duration_delta_min,
                    )
                    if variant is not None
                    else None
                ),
                addons=tuple(selected_addons),
            )
        )
    try:
        return calculate_appointment_quote(tuple(catalog_items))
    except BookingQuoteError as exc:
        raise BadRequestError(str(exc), code="invalid_booking_items") from exc


async def create_appointment(
    session: AsyncSession,
    *,
    tenant_id: uuid.UUID,
    tenant_user_id: uuid.UUID,
    pet_id: uuid.UUID,
    service_id: uuid.UUID | None = None,
    items: tuple[BookingItemSelection, ...] = (),
    staff_id: uuid.UUID,
    start_at: datetime,
    notes: str | None = None,
    promotion_code: str | None = None,
    require_online_booking: bool = False,
) -> Appointment:
    if start_at.tzinfo is None:
        raise BadRequestError("startAt должен содержать timezone", code="timezone_required")
    # Сериализуем все изменения записей одного сотрудника. Блокировки в пределах
    # дня недостаточно, поскольку интервалы между услугами могут пересекать полночь.
    lock_key = f"appointment-schedule:{tenant_id}:{staff_id}"
    await session.execute(
        text("SELECT pg_advisory_xact_lock(hashtextextended(:key, 0))"), {"key": lock_key}
    )
    pet = await session.scalar(
        select(Pet).where(
            Pet.tenant_id == tenant_id,
            Pet.id == pet_id,
            Pet.owner_id == tenant_user_id,
            Pet.archived_at.is_(None),
        )
    )
    if pet is None:
        raise NotFoundError("Питомец не найден")
    site = await session.get(Site, tenant_id)
    if site is None:
        raise NotFoundError("Салон не найден")
    timezone = getattr(site, "timezone", "Europe/Moscow")
    selections = items
    if not selections:
        if service_id is None:
            raise BadRequestError("Добавьте хотя бы одну услугу", code="invalid_booking_items")
        selections = (BookingItemSelection(service_id=service_id),)
    quote = await resolve_booking_quote(
        session,
        tenant_id=tenant_id,
        staff_id=staff_id,
        items=selections,
        require_online_booking=require_online_booking,
    )
    primary_service_id = quote.items[0].service_id
    try:
        _site, _service, _staff, slots = await available_slots(
            session,
            tenant_id=tenant_id,
            service_id=primary_service_id,
            staff_id=staff_id,
            day=start_at.astimezone(parse_timezone(timezone)).date(),
            include_unavailable=True,
            duration_min_override=quote.duration_min,
            buffer_before_min_override=quote.buffer_before_min,
            buffer_after_min_override=quote.buffer_after_min,
        )
        chosen = assert_slot_matches(start_at, slots)
    except ScheduleError as exc:
        raise ConflictError(str(exc), code="slot_unavailable") from exc
    price = quote.total_price
    if promotion_code:
        price = await apply_promotion(
            session, tenant_id=tenant_id, code=promotion_code, price=price
        )
    row = Appointment(
        tenant_id=tenant_id,
        tenant_user_id=tenant_user_id,
        pet_id=pet_id,
        service_id=primary_service_id,
        staff_id=staff_id,
        start_at=chosen.starts_at.astimezone(UTC),
        end_at=chosen.ends_at.astimezone(UTC),
        status=AppointmentStatus.new,
        price=price,
        notes=notes,
    )
    session.add(row)
    await session.flush()
    for snapshot in quote.items:
        item_id = uuid.uuid4()
        session.add(
            AppointmentItem(
                id=item_id,
                tenant_id=tenant_id,
                appointment_id=row.id,
                service_id=snapshot.service_id,
                variant_id=snapshot.variant_id,
                assigned_staff_id=staff_id,
                service_name_snapshot=snapshot.service_name,
                variant_label_snapshot=snapshot.variant_label,
                selected_options={"source": "catalogSelection"},
                unit_price=snapshot.unit_price,
                duration_min=snapshot.duration_min,
                buffer_before_min=snapshot.buffer_before_min,
                buffer_after_min=snapshot.buffer_after_min,
                currency=snapshot.currency,
                sort_order=snapshot.sort_order,
            )
        )
        for addon_order, addon in enumerate(snapshot.addons):
            session.add(
                AppointmentItemAddon(
                    tenant_id=tenant_id,
                    appointment_item_id=item_id,
                    service_id=snapshot.service_id,
                    addon_id=addon.addon_id,
                    name_snapshot=addon.name,
                    price_snapshot=addon.price,
                    duration_min_snapshot=addon.duration_min,
                    sort_order=addon_order,
                )
            )
    await session.flush()
    return row


async def apply_promotion(
    session: AsyncSession, *, tenant_id: uuid.UUID, code: str, price: Decimal
) -> Decimal:
    normalized = "".join(code.split()).upper()
    promo = await session.scalar(
        select(Promotion)
        .where(
            Promotion.tenant_id == tenant_id,
            Promotion.promo_code == normalized,
            Promotion.is_active.is_(True),
        )
        .with_for_update()
    )
    today = datetime.now(UTC).date()
    if (
        promo is None
        or (promo.valid_from and promo.valid_from > today)
        or (promo.valid_to and promo.valid_to < today)
        or (promo.max_uses is not None and promo.used_count >= promo.max_uses)
    ):
        raise BadRequestError("Промокод недействителен", code="invalid_promo_code")
    promo.used_count += 1
    discount = Decimal(promo.discount_percent or 0) / Decimal(100)
    return (price * (Decimal(1) - discount)).quantize(Decimal("0.01"))


def booking_request_hash(payload: dict[str, Any]) -> str:
    value = json.dumps(payload, sort_keys=True, separators=(",", ":"), default=str)
    return hashlib.sha256(value.encode()).hexdigest()
