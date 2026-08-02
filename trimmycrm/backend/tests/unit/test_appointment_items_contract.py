from __future__ import annotations

import os
from datetime import UTC, datetime
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

from app.models import AppointmentItem, AppointmentItemAddon  # noqa: E402
from app.schemas import AppointmentView  # noqa: E402
from app.services.booking_pricing import (  # noqa: E402
    BookingQuoteError,
    CatalogAddonChoice,
    CatalogBookingItem,
    CatalogVariantChoice,
    calculate_appointment_quote,
)

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
