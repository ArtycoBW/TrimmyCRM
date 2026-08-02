from __future__ import annotations

import os
from datetime import UTC, datetime, timedelta
from decimal import Decimal
from pathlib import Path
from uuid import UUID

import pytest

for key, value in {
    "DATABASE_URL": "postgresql+asyncpg://trimmycrm:trimmycrm@localhost/trimmycrm_test",
    "REDIS_URL": "redis://localhost:6379/0",
    "CELERY_BROKER_URL": "redis://localhost:6379/1",
    "CELERY_RESULT_BACKEND": "redis://localhost:6379/2",
    "S3_ENDPOINT_URL": "https://storage.yandexcloud.net",
    "INTERNAL_EDGE_TOKEN": "edge-token-1111111111111111111111111111",
    "JWT_PLATFORM_SECRET": "platform-secret-111111111111111111111111",
    "JWT_TENANT_SECRET": "tenant-secret-22222222222222222222222222",
    "AUTH_TOKEN_PEPPER": "token-pepper-333333333333333333333333333",
    "ENVIRONMENT": "test",
    "PAYMENT_PROVIDER": "mock",
}.items():
    os.environ[key] = value

from app.models import (  # noqa: E402
    Appointment,
    AppointmentItem,
    AppointmentItemAddon,
    Pet,
    Service,
    ServiceAddon,
    ServiceVariant,
    Site,
    Staff,
    StaffService,
)
from app.schemas import AppointmentView, BookingCreate  # noqa: E402
from app.services import booking  # noqa: E402
from app.services.booking_pricing import (  # noqa: E402
    BookingItemSelection,
    BookingQuoteError,
    CatalogAddonChoice,
    CatalogBookingItem,
    CatalogVariantChoice,
    calculate_appointment_quote,
)
from app.services.scheduling import TimeRange  # noqa: E402

TENANT_ID = UUID("11111111-1111-4111-8111-111111111111")
CLIENT_ID = UUID("22222222-2222-4222-8222-222222222222")
PET_ID = UUID("33333333-3333-4333-8333-333333333333")
STAFF_ID = UUID("44444444-4444-4444-8444-444444444444")
APPOINTMENT_ID = UUID("55555555-5555-4555-8555-555555555555")
HAIRCUT_ID = UUID("66666666-6666-4666-8666-666666666666")
COLOR_ID = UUID("77777777-7777-4777-8777-777777777777")
VARIANT_ID = UUID("88888888-8888-4888-8888-888888888888")
ADDON_ID = UUID("99999999-9999-4999-8999-999999999999")


def test_multi_service_quote_uses_server_catalog_values() -> None:
    quote = calculate_appointment_quote(
        (
            CatalogBookingItem(
                service_id=HAIRCUT_ID,
                service_name="Стрижка",
                base_price=Decimal("3000.00"),
                base_duration_min=60,
                buffer_before_min=5,
                variant=CatalogVariantChoice(
                    id=VARIANT_ID,
                    label="Длинные волосы",
                    price_delta=Decimal("1000.00"),
                    duration_delta_min=30,
                ),
                addons=(
                    CatalogAddonChoice(
                        id=ADDON_ID,
                        name="Экспресс-уход",
                        price_delta=Decimal("750.50"),
                        duration_delta_min=15,
                    ),
                ),
            ),
            CatalogBookingItem(
                service_id=COLOR_ID,
                service_name="Тонирование",
                base_price=Decimal("4500.00"),
                base_duration_min=90,
                buffer_after_min=20,
            ),
        )
    )

    assert quote.total_price == Decimal("9250.50")
    assert quote.duration_min == 195
    assert quote.buffer_before_min == 5
    assert quote.buffer_after_min == 20
    assert quote.items[0].service_name == "Стрижка"
    assert quote.items[0].variant_label == "Длинные волосы"
    assert quote.items[0].unit_price == Decimal("4750.50")
    assert quote.items[0].addons[0].name == "Экспресс-уход"
    assert quote.items[1].sort_order == 1


def test_quote_rejects_duplicate_services_and_addons() -> None:
    repeated_service = CatalogBookingItem(
        service_id=HAIRCUT_ID,
        service_name="Стрижка",
        base_price=Decimal("3000.00"),
        base_duration_min=60,
    )
    with pytest.raises(BookingQuoteError, match="повторяться"):
        calculate_appointment_quote((repeated_service, repeated_service))

    repeated_addon = CatalogAddonChoice(
        id=ADDON_ID,
        name="Уход",
        price_delta=Decimal("500.00"),
        duration_delta_min=10,
    )
    with pytest.raises(BookingQuoteError, match="Дополнение"):
        calculate_appointment_quote(
            (
                CatalogBookingItem(
                    service_id=HAIRCUT_ID,
                    service_name="Стрижка",
                    base_price=Decimal("3000.00"),
                    base_duration_min=60,
                    addons=(repeated_addon, repeated_addon),
                ),
            )
        )


def test_appointment_item_models_enforce_composite_tenant_links() -> None:
    item_fk_names = {
        constraint.name for constraint in AppointmentItem.__table__.foreign_key_constraints
    }
    addon_fk_names = {
        constraint.name for constraint in AppointmentItemAddon.__table__.foreign_key_constraints
    }

    assert "fk_appointment_items_tenant_appointment" in item_fk_names
    assert "fk_appointment_items_tenant_service_variant" in item_fk_names
    assert "fk_appointment_item_addons_tenant_item" in addon_fk_names
    assert "fk_appointment_item_addons_tenant_service_addon" in addon_fk_names
    variant_fk = next(
        constraint
        for constraint in AppointmentItem.__table__.foreign_key_constraints
        if constraint.name == "fk_appointment_items_tenant_service_variant"
    )
    assert [element.parent.name for element in variant_fk.elements] == [
        "tenant_id",
        "service_id",
        "variant_id",
    ]


def test_appointment_items_migration_backfills_and_forces_rls() -> None:
    migration = (
        Path(__file__).parents[2] / "alembic" / "versions" / "0011_appointment_items.py"
    ).read_text(encoding="utf-8")

    assert "INSERT INTO appointment_items" in migration
    assert "legacyAppointment" in migration
    assert "FORCE ROW LEVEL SECURITY" in migration
    assert "current_setting('app.current_tenant'" in migration
    assert '"fk_appointment_items_tenant_service_variant"' in migration
    assert '"fk_appointment_item_addons_tenant_service_addon"' in migration


def test_appointment_view_exposes_snapshots_without_recalculation() -> None:
    now = datetime(2026, 8, 2, 12, tzinfo=UTC)
    view = AppointmentView.model_validate(
        {
            "id": APPOINTMENT_ID,
            "tenant_id": TENANT_ID,
            "tenant_user_id": CLIENT_ID,
            "pet_id": PET_ID,
            "service_id": HAIRCUT_ID,
            "staff_id": STAFF_ID,
            "start_at": now,
            "end_at": datetime(2026, 8, 2, 15, tzinfo=UTC),
            "status": "confirmed",
            "price": Decimal("9250.50"),
            "prepaid": False,
            "version": 1,
            "created_at": now,
            "items": [
                {
                    "id": UUID("aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"),
                    "service_id": HAIRCUT_ID,
                    "variant_id": VARIANT_ID,
                    "assigned_staff_id": STAFF_ID,
                    "service_name": "Стрижка",
                    "variant_label": "Длинные волосы",
                    "selected_options": {"length": "long"},
                    "unit_price": Decimal("4750.50"),
                    "duration_min": 105,
                    "buffer_before_min": 5,
                    "buffer_after_min": 0,
                    "currency": "RUB",
                    "sort_order": 0,
                    "addons": [
                        {
                            "id": UUID("bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb"),
                            "addon_id": ADDON_ID,
                            "name": "Экспресс-уход",
                            "price": Decimal("750.50"),
                            "duration_min": 15,
                        }
                    ],
                }
            ],
        }
    )

    assert view.items[0].serviceName == "Стрижка"
    assert view.items[0].unitPrice == Decimal("4750.50")
    assert view.items[0].addons[0].name == "Экспресс-уход"


class _ScalarRows:
    def __init__(self, values: list[object]) -> None:
        self.values = values

    def all(self) -> list[object]:
        return self.values


class _CreateSession:
    def __init__(
        self,
        pet: Pet,
        site: Site,
        *,
        scalar_batches: list[list[object]],
    ) -> None:
        self.scalar_values = [pet]
        self.scalar_batches = scalar_batches
        self.site = site
        self.added: list[object] = []

    async def execute(self, _statement: object, _params: object | None = None) -> None:
        return None

    async def scalar(self, _statement: object) -> object:
        return self.scalar_values.pop(0)

    async def scalars(self, _statement: object) -> _ScalarRows:
        return _ScalarRows(self.scalar_batches.pop(0))

    async def get(self, _model: object, _identifier: UUID) -> Site:
        return self.site

    def add(self, value: object) -> None:
        self.added.append(value)

    async def flush(self) -> None:
        for value in self.added:
            if isinstance(value, Appointment) and value.id is None:
                value.id = APPOINTMENT_ID


@pytest.mark.asyncio
async def test_new_legacy_booking_persists_an_item_snapshot(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    start = datetime(2026, 8, 3, 9, tzinfo=UTC)
    end = datetime(2026, 8, 3, 10, tzinfo=UTC)
    site = Site(id=TENANT_ID, name="CUT/01", slug="cut-01", timezone="Europe/Moscow")
    service = Service(
        id=HAIRCUT_ID,
        tenant_id=TENANT_ID,
        name="Стрижка",
        price=Decimal("3000.00"),
        duration_min=60,
        buffer_before_min=5,
        buffer_after_min=15,
        currency="RUB",
        is_active=True,
    )
    staff = Staff(id=STAFF_ID, tenant_id=TENANT_ID, name="Анна", schedule={}, is_active=True)
    pet = Pet(
        id=PET_ID,
        tenant_id=TENANT_ID,
        owner_id=CLIENT_ID,
        name="Legacy",
    )
    capability = StaffService(
        tenant_id=TENANT_ID,
        staff_id=STAFF_ID,
        service_id=HAIRCUT_ID,
        custom_price=Decimal("3200.00"),
        custom_duration_min=75,
    )
    session = _CreateSession(
        pet,
        site,
        scalar_batches=[[service], [capability]],
    )

    async def slots(
        *_args: object, **_kwargs: object
    ) -> tuple[Site, Service, Staff, list[tuple[TimeRange, bool]]]:
        return site, service, staff, [(TimeRange(start, end), True)]

    monkeypatch.setattr(booking, "available_slots", slots)

    row = await booking.create_appointment(
        session,  # type: ignore[arg-type]
        tenant_id=TENANT_ID,
        tenant_user_id=CLIENT_ID,
        pet_id=PET_ID,
        service_id=HAIRCUT_ID,
        staff_id=STAFF_ID,
        start_at=start,
    )

    item = next(value for value in session.added if isinstance(value, AppointmentItem))
    assert row.id == APPOINTMENT_ID
    assert item.appointment_id == APPOINTMENT_ID
    assert item.service_name_snapshot == "Стрижка"
    assert item.unit_price == Decimal("3200.00")
    assert item.duration_min == 75
    assert item.selected_options == {"source": "catalogSelection"}


def test_booking_payload_accepts_legacy_or_multi_item_format() -> None:
    start = datetime(2026, 8, 3, 9, tzinfo=UTC)
    legacy = BookingCreate(
        serviceId=HAIRCUT_ID,
        staffId=STAFF_ID,
        petId=PET_ID,
        startAt=start,
    )
    assert [item.serviceId for item in legacy.normalized_items()] == [HAIRCUT_ID]

    multi = BookingCreate(
        items=[
            {"serviceId": HAIRCUT_ID, "variantId": VARIANT_ID, "addonIds": [ADDON_ID]},
            {"serviceId": COLOR_ID},
        ],
        staffId=STAFF_ID,
        petId=PET_ID,
        startAt=start,
    )
    assert [item.serviceId for item in multi.normalized_items()] == [HAIRCUT_ID, COLOR_ID]

    with pytest.raises(ValueError, match="serviceId или непустой items"):
        BookingCreate(
            serviceId=HAIRCUT_ID,
            items=[{"serviceId": COLOR_ID}],
            staffId=STAFF_ID,
            petId=PET_ID,
            startAt=start,
        )


@pytest.mark.asyncio
async def test_multi_service_booking_resolves_catalog_and_persists_snapshots(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    start = datetime(2026, 8, 3, 9, tzinfo=UTC)
    end = start + timedelta(minutes=195)
    site = Site(id=TENANT_ID, name="CUT/01", slug="cut-01", timezone="Europe/Moscow")
    haircut = Service(
        id=HAIRCUT_ID,
        tenant_id=TENANT_ID,
        name="Стрижка",
        price=Decimal("3000.00"),
        duration_min=60,
        buffer_before_min=5,
        buffer_after_min=0,
        currency="RUB",
        is_active=True,
    )
    color = Service(
        id=COLOR_ID,
        tenant_id=TENANT_ID,
        name="Тонирование",
        price=Decimal("4500.00"),
        duration_min=90,
        buffer_before_min=0,
        buffer_after_min=20,
        currency="RUB",
        is_active=True,
    )
    capabilities = [
        StaffService(
            tenant_id=TENANT_ID,
            staff_id=STAFF_ID,
            service_id=HAIRCUT_ID,
            custom_price=Decimal("3000.00"),
            custom_duration_min=60,
        ),
        StaffService(
            tenant_id=TENANT_ID,
            staff_id=STAFF_ID,
            service_id=COLOR_ID,
        ),
    ]
    variant = ServiceVariant(
        id=VARIANT_ID,
        tenant_id=TENANT_ID,
        service_id=HAIRCUT_ID,
        label="Длинные волосы",
        price_delta=Decimal("1000.00"),
        duration_delta_min=30,
        is_active=True,
    )
    addon = ServiceAddon(
        id=ADDON_ID,
        tenant_id=TENANT_ID,
        service_id=HAIRCUT_ID,
        name="Экспресс-уход",
        price_delta=Decimal("750.50"),
        duration_delta_min=15,
        is_active=True,
    )
    pet = Pet(id=PET_ID, tenant_id=TENANT_ID, owner_id=CLIENT_ID, name="Legacy")
    session = _CreateSession(
        pet,
        site,
        scalar_batches=[[haircut, color], capabilities, [variant], [addon]],
    )
    slot_arguments: dict[str, object] = {}

    async def slots(
        *_args: object, **kwargs: object
    ) -> tuple[Site, Service, Staff, list[tuple[TimeRange, bool]]]:
        slot_arguments.update(kwargs)
        staff = Staff(id=STAFF_ID, tenant_id=TENANT_ID, name="Анна", schedule={}, is_active=True)
        return site, haircut, staff, [(TimeRange(start, end), True)]

    monkeypatch.setattr(booking, "available_slots", slots)

    row = await booking.create_appointment(
        session,  # type: ignore[arg-type]
        tenant_id=TENANT_ID,
        tenant_user_id=CLIENT_ID,
        pet_id=PET_ID,
        items=(
            BookingItemSelection(
                service_id=HAIRCUT_ID,
                variant_id=VARIANT_ID,
                addon_ids=(ADDON_ID,),
            ),
            BookingItemSelection(service_id=COLOR_ID),
        ),
        staff_id=STAFF_ID,
        start_at=start,
    )

    item_rows = [value for value in session.added if isinstance(value, AppointmentItem)]
    addon_rows = [value for value in session.added if isinstance(value, AppointmentItemAddon)]
    assert row.service_id == HAIRCUT_ID
    assert row.price == Decimal("9250.50")
    assert row.end_at == end
    assert slot_arguments["duration_min_override"] == 195
    assert slot_arguments["buffer_before_min_override"] == 5
    assert slot_arguments["buffer_after_min_override"] == 20
    assert [item.service_name_snapshot for item in item_rows] == ["Стрижка", "Тонирование"]
    assert item_rows[0].variant_label_snapshot == "Длинные волосы"
    assert item_rows[0].unit_price == Decimal("4750.50")
    assert addon_rows[0].name_snapshot == "Экспресс-уход"
    assert addon_rows[0].appointment_item_id == item_rows[0].id


@pytest.mark.asyncio
async def test_booking_rejects_variant_from_another_service() -> None:
    haircut = Service(
        id=HAIRCUT_ID,
        tenant_id=TENANT_ID,
        name="Стрижка",
        price=Decimal("3000.00"),
        duration_min=60,
        buffer_before_min=0,
        buffer_after_min=0,
        currency="RUB",
        is_active=True,
    )
    capability = StaffService(
        tenant_id=TENANT_ID,
        staff_id=STAFF_ID,
        service_id=HAIRCUT_ID,
    )
    wrong_variant = ServiceVariant(
        id=VARIANT_ID,
        tenant_id=TENANT_ID,
        service_id=COLOR_ID,
        label="Чужой вариант",
        price_delta=Decimal("100.00"),
        duration_delta_min=5,
        is_active=True,
    )
    session = _CreateSession(
        Pet(id=PET_ID, tenant_id=TENANT_ID, owner_id=CLIENT_ID, name="Legacy"),
        Site(id=TENANT_ID, name="CUT/01", slug="cut-01"),
        scalar_batches=[[haircut], [capability], [wrong_variant]],
    )

    with pytest.raises(Exception) as captured:
        await booking.resolve_booking_quote(
            session,  # type: ignore[arg-type]
            tenant_id=TENANT_ID,
            staff_id=STAFF_ID,
            items=(BookingItemSelection(service_id=HAIRCUT_ID, variant_id=VARIANT_ID),),
            require_online_booking=False,
        )

    assert getattr(captured.value, "code", None) == "invalid_service_variant"
