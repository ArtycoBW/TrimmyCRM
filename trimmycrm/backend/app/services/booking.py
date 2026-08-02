from __future__ import annotations

import hashlib
import json
import uuid
from datetime import UTC, date, datetime, time, timedelta
from decimal import Decimal
from typing import Any

from sqlalchemy import select, text
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.errors import BadRequestError, ConflictError, NotFoundError
from app.models import (
    Appointment,
    AppointmentStatus,
    Pet,
    Promotion,
    ScheduleException,
    ScheduleExceptionType,
    Service,
    Site,
    Staff,
    StaffService,
)
from app.services.scheduling import (
    ScheduleError,
    ScheduleExceptionValue,
    TimeRange,
    assert_slot_matches,
    generate_slots,
    parse_timezone,
)


async def available_slots(
    session: AsyncSession,
    *,
    tenant_id: uuid.UUID,
    service_id: uuid.UUID,
    staff_id: uuid.UUID,
    day: date,
    include_unavailable: bool = True,
    exclude_appointment_id: uuid.UUID | None = None,
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
    duration = capability.custom_duration_min or service.duration_min
    slots = generate_slots(
        day=day,
        timezone=timezone,
        salon_schedule=site.work_hours,
        staff_schedule=staff.schedule,
        duration_min=duration,
        buffer_before_min=getattr(service, "buffer_before_min", 0),
        buffer_after_min=getattr(service, "buffer_after_min", 0),
        appointments=[
            TimeRange(
                appointment.start_at
                - timedelta(minutes=getattr(appointment_service, "buffer_before_min", 0)),
                appointment.end_at
                + timedelta(minutes=getattr(appointment_service, "buffer_after_min", 0)),
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


async def create_appointment(
    session: AsyncSession,
    *,
    tenant_id: uuid.UUID,
    tenant_user_id: uuid.UUID,
    pet_id: uuid.UUID,
    service_id: uuid.UUID,
    staff_id: uuid.UUID,
    start_at: datetime,
    notes: str | None = None,
    promotion_code: str | None = None,
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
    try:
        _site, service, _staff, slots = await available_slots(
            session,
            tenant_id=tenant_id,
            service_id=service_id,
            staff_id=staff_id,
            day=start_at.astimezone(parse_timezone(timezone)).date(),
            include_unavailable=True,
        )
        chosen = assert_slot_matches(start_at, slots)
    except ScheduleError as exc:
        raise ConflictError(str(exc), code="slot_unavailable") from exc
    capability = await session.scalar(
        select(StaffService).where(
            StaffService.tenant_id == tenant_id,
            StaffService.staff_id == staff_id,
            StaffService.service_id == service_id,
        )
    )
    price = (
        capability.custom_price
        if capability and capability.custom_price is not None
        else service.price
    )
    if promotion_code:
        price = await apply_promotion(
            session, tenant_id=tenant_id, code=promotion_code, price=price
        )
    row = Appointment(
        tenant_id=tenant_id,
        tenant_user_id=tenant_user_id,
        pet_id=pet_id,
        service_id=service_id,
        staff_id=staff_id,
        start_at=chosen.starts_at.astimezone(UTC),
        end_at=chosen.ends_at.astimezone(UTC),
        status=AppointmentStatus.new,
        price=price,
        notes=notes,
    )
    session.add(row)
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
