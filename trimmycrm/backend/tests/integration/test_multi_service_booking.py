from __future__ import annotations

import os
from datetime import datetime, time, timedelta
from decimal import Decimal
from uuid import uuid4
from zoneinfo import ZoneInfo

import pytest
from sqlalchemy import select, text
from sqlalchemy.ext.asyncio import AsyncSession, create_async_engine

from app.core.errors import ConflictError
from app.models import (
    AppointmentItem,
    AppointmentItemAddon,
    Pet,
    PlatformUser,
    Service,
    ServiceAddon,
    ServiceVariant,
    Site,
    Staff,
    StaffService,
    TenantUser,
)
from app.services.booking import create_appointment
from app.services.booking_pricing import BookingItemSelection

pytestmark = pytest.mark.integration


@pytest.mark.asyncio
async def test_runtime_role_creates_multi_service_snapshots() -> None:
    admin_url = os.getenv("TEST_ADMIN_DATABASE_URL")
    runtime_url = os.getenv("TEST_DATABASE_URL")
    if not admin_url or not runtime_url:
        pytest.skip("TEST_ADMIN_DATABASE_URL and TEST_DATABASE_URL are required")

    tenant_id = uuid4()
    owner_id = uuid4()
    client_id = uuid4()
    pet_id = uuid4()
    staff_id = uuid4()
    haircut_id = uuid4()
    color_id = uuid4()
    variant_id = uuid4()
    addon_id = uuid4()
    admin_engine = create_async_engine(admin_url)
    runtime_engine = create_async_engine(runtime_url)
    timezone = ZoneInfo("Europe/Moscow")
    local_day = datetime.now(timezone).date() + timedelta(days=1)
    weekday = (
        "monday",
        "tuesday",
        "wednesday",
        "thursday",
        "friday",
        "saturday",
        "sunday",
    )[local_day.weekday()]
    schedule = {weekday: [{"start": "09:00", "end": "18:00"}]}
    requested_start = datetime.combine(local_day, time(10, 5), tzinfo=timezone)

    try:
        async with AsyncSession(admin_engine, expire_on_commit=False) as admin_session:
            async with admin_session.begin():
                admin_session.add(
                    PlatformUser(
                        id=owner_id,
                        email=f"integration-{owner_id.hex}@example.invalid",
                        password_hash="integration-test-value",  # noqa: S106
                    )
                )
                admin_session.add(
                    Site(
                        id=tenant_id,
                        owner_id=owner_id,
                        name="Integration CUT",
                        slug=f"it-{tenant_id.hex}",
                        timezone="Europe/Moscow",
                        work_hours=schedule,
                    )
                )

        async with runtime_engine.connect() as connection:
            transaction = await connection.begin()
            session = AsyncSession(bind=connection, expire_on_commit=False)
            try:
                await session.execute(
                    text("SELECT set_config('app.current_tenant', :tenant_id, true)"),
                    {"tenant_id": str(tenant_id)},
                )
                session.add(
                    TenantUser(id=client_id, tenant_id=tenant_id, full_name="Тестовый клиент")
                )
                await session.flush()
                session.add_all(
                    [
                        Pet(
                            id=pet_id,
                            tenant_id=tenant_id,
                            owner_id=client_id,
                            name="Legacy",
                        ),
                        Staff(
                            id=staff_id,
                            tenant_id=tenant_id,
                            name="Тестовый мастер",
                            schedule=schedule,
                            is_active=True,
                        ),
                        Service(
                            id=haircut_id,
                            tenant_id=tenant_id,
                            name="Стрижка",
                            price=Decimal("3000.00"),
                            duration_min=60,
                            buffer_before_min=5,
                            buffer_after_min=0,
                            currency="RUB",
                            is_active=True,
                            allow_online_booking=True,
                        ),
                        Service(
                            id=color_id,
                            tenant_id=tenant_id,
                            name="Тонирование",
                            price=Decimal("4500.00"),
                            duration_min=90,
                            buffer_before_min=0,
                            buffer_after_min=20,
                            currency="RUB",
                            is_active=True,
                            allow_online_booking=True,
                        ),
                    ]
                )
                await session.flush()
                session.add_all(
                    [
                        StaffService(
                            tenant_id=tenant_id,
                            staff_id=staff_id,
                            service_id=haircut_id,
                        ),
                        StaffService(
                            tenant_id=tenant_id,
                            staff_id=staff_id,
                            service_id=color_id,
                        ),
                        ServiceVariant(
                            id=variant_id,
                            tenant_id=tenant_id,
                            service_id=haircut_id,
                            label="Длинные волосы",
                            price_delta=Decimal("1000.00"),
                            duration_delta_min=30,
                            is_active=True,
                        ),
                        ServiceAddon(
                            id=addon_id,
                            tenant_id=tenant_id,
                            service_id=haircut_id,
                            name="Экспресс-уход",
                            price_delta=Decimal("750.50"),
                            duration_delta_min=15,
                            is_active=True,
                        ),
                    ]
                )
                await session.flush()

                appointment = await create_appointment(
                    session,
                    tenant_id=tenant_id,
                    tenant_user_id=client_id,
                    pet_id=pet_id,
                    items=(
                        BookingItemSelection(
                            service_id=haircut_id,
                            variant_id=variant_id,
                            addon_ids=(addon_id,),
                        ),
                        BookingItemSelection(service_id=color_id),
                    ),
                    staff_id=staff_id,
                    start_at=requested_start,
                    require_online_booking=True,
                )

                items = (
                    await session.scalars(
                        select(AppointmentItem)
                        .where(AppointmentItem.appointment_id == appointment.id)
                        .order_by(AppointmentItem.sort_order)
                    )
                ).all()
                addons = (
                    await session.scalars(
                        select(AppointmentItemAddon).where(
                            AppointmentItemAddon.appointment_item_id == items[0].id
                        )
                    )
                ).all()

                assert appointment.price == Decimal("9250.50")
                assert appointment.end_at - appointment.start_at == timedelta(minutes=195)
                assert [item.service_name_snapshot for item in items] == [
                    "Стрижка",
                    "Тонирование",
                ]
                assert items[0].variant_label_snapshot == "Длинные волосы"
                assert addons[0].name_snapshot == "Экспресс-уход"

                with pytest.raises(ConflictError, match="недоступен"):
                    await create_appointment(
                        session,
                        tenant_id=tenant_id,
                        tenant_user_id=client_id,
                        pet_id=pet_id,
                        items=(
                            BookingItemSelection(
                                service_id=haircut_id,
                                variant_id=variant_id,
                                addon_ids=(addon_id,),
                            ),
                            BookingItemSelection(service_id=color_id),
                        ),
                        staff_id=staff_id,
                        start_at=appointment.end_at,
                        require_online_booking=True,
                    )
            finally:
                await session.close()
                await transaction.rollback()
    finally:
        async with AsyncSession(admin_engine) as admin_session:
            async with admin_session.begin():
                site = await admin_session.get(Site, tenant_id)
                if site is not None:
                    await admin_session.delete(site)
                owner = await admin_session.get(PlatformUser, owner_id)
                if owner is not None:
                    await admin_session.delete(owner)
        await runtime_engine.dispose()
        await admin_engine.dispose()
