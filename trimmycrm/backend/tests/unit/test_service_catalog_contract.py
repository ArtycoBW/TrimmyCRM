from __future__ import annotations

import os
from datetime import UTC, datetime
from decimal import Decimal
from pathlib import Path
from typing import Any
from uuid import UUID

import pytest
from fastapi.routing import APIRoute
from pydantic import ValidationError

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

from app.api.routes import crm  # noqa: E402
from app.models import (  # noqa: E402
    Service,
    ServiceAddon,
    ServiceAudience,
    ServiceCategory,
    ServicePriceType,
    ServiceVariant,
)
from app.schemas import (  # noqa: E402
    PublicServiceView,
    ServiceAddonCreate,
    ServiceCategoryCreate,
    ServiceCategoryView,
    ServiceCreate,
    ServiceVariantCreate,
)

TENANT_ID = UUID("11111111-1111-4111-8111-111111111111")
SERVICE_ID = UUID("22222222-2222-4222-8222-222222222222")
VARIANT_ID = UUID("33333333-3333-4333-8333-333333333333")
ADDON_ID = UUID("44444444-4444-4444-8444-444444444444")


def _route(path: str, method: str) -> APIRoute:
    return next(
        route
        for route in crm.router.routes
        if isinstance(route, APIRoute) and route.path == path and method in route.methods
    )


def _service_payload(**overrides: Any) -> dict[str, Any]:
    payload: dict[str, Any] = {
        "name": "Сложное окрашивание",
        "price": Decimal("7500.00"),
        "priceType": ServicePriceType.from_,
        "durationMin": 240,
    }
    payload.update(overrides)
    return payload


def test_hair_service_price_contract_rejects_invalid_ranges() -> None:
    assert ServiceCreate(**_service_payload()).priceType.value == "from"
    valid = ServiceCreate(
        **_service_payload(
            priceType=ServicePriceType.range,
            maxPrice=Decimal("11000.00"),
        )
    )
    assert valid.maxPrice == Decimal("11000.00")

    with pytest.raises(ValidationError):
        ServiceCreate(**_service_payload(priceType=ServicePriceType.range))
    with pytest.raises(ValidationError):
        ServiceCreate(**_service_payload(maxPrice=Decimal("7000.00")))


def test_category_variant_and_addon_validation_is_typed() -> None:
    category = ServiceCategoryCreate(
        name="Окрашивание",
        slug="hair-color",
        audience=ServiceAudience.women,
    )
    assert category.audience is ServiceAudience.women
    assert ServiceVariantCreate(label="Ниже плеч", durationDeltaMin=30).priceDelta == 0
    assert ServiceAddonCreate(name="Уход Olaplex", priceDelta="1500.00").durationDeltaMin == 0

    with pytest.raises(ValidationError):
        ServiceVariantCreate(label="Ниже плеч", durationDeltaMin=7)
    with pytest.raises(ValidationError):
        ServiceAddonCreate(name="Уход", priceDelta="-1")


def test_catalog_models_use_composite_tenant_foreign_keys() -> None:
    service_fk = next(
        constraint
        for constraint in Service.__table__.foreign_key_constraints
        if constraint.name == "fk_services_tenant_category"
    )
    variant_fk = next(
        constraint
        for constraint in ServiceVariant.__table__.foreign_key_constraints
        if constraint.name == "fk_service_variants_tenant_service"
    )
    addon_fk = next(
        constraint
        for constraint in ServiceAddon.__table__.foreign_key_constraints
        if constraint.name == "fk_service_addons_tenant_service"
    )

    assert [element.parent.name for element in service_fk.elements] == ["tenant_id", "category_id"]
    assert [element.parent.name for element in variant_fk.elements] == ["tenant_id", "service_id"]
    assert [element.parent.name for element in addon_fk.elements] == ["tenant_id", "service_id"]
    assert ServiceCategory.__table__.c.tenant_id.nullable is False


def test_catalog_migration_forces_rls_and_backfills_legacy_categories() -> None:
    migration = (
        Path(__file__).parents[2] / "alembic" / "versions" / "0010_hair_service_catalog.py"
    ).read_text(encoding="utf-8")

    for table in ("service_categories", "service_variants", "service_addons"):
        assert f'"{table}"' in migration
    assert "FORCE ROW LEVEL SECURITY" in migration
    assert "current_setting('app.current_tenant'" in migration
    assert '"fk_service_variants_tenant_service"' in migration
    assert '"fk_service_addons_tenant_service"' in migration
    assert "INSERT INTO service_categories" in migration
    assert "UPDATE services AS service" in migration


def test_catalog_routes_publish_nested_contracts() -> None:
    assert _route("/service-categories", "GET").response_model == list[ServiceCategoryView]
    assert (
        _route("/services/{service_id}/variants", "POST").response_model.__name__
        == "ServiceVariantView"
    )
    assert (
        _route("/services/{service_id}/addons", "POST").response_model.__name__
        == "ServiceAddonView"
    )


def test_public_service_view_contains_only_bookable_catalog_data() -> None:
    now = datetime(2026, 8, 2, tzinfo=UTC)
    view = PublicServiceView.model_validate(
        {
            "id": SERVICE_ID,
            "tenant_id": TENANT_ID,
            "name": "Стрижка",
            "description": "Подбор формы и укладка",
            "category_id": None,
            "category_name": "Стрижки",
            "price": Decimal("3000.00"),
            "max_price": None,
            "price_type": ServicePriceType.fixed,
            "currency": "RUB",
            "duration_min": 60,
            "buffer_before_min": 0,
            "buffer_after_min": 15,
            "requires_consultation": False,
            "requires_patch_test": False,
            "variant_selection_required": True,
            "preparation_text": None,
            "aftercare_text": "Используйте термозащиту",
            "allow_online_booking": True,
            "is_active": True,
            "created_at": now,
            "updated_at": now,
            "variants": [
                {
                    "id": VARIANT_ID,
                    "service_id": SERVICE_ID,
                    "label": "Длинные волосы",
                    "price_delta": Decimal("1000.00"),
                    "duration_delta_min": 30,
                    "sort_order": 0,
                    "is_active": True,
                }
            ],
            "addons": [
                {
                    "id": ADDON_ID,
                    "service_id": SERVICE_ID,
                    "name": "Уход",
                    "price_delta": Decimal("800.00"),
                    "duration_delta_min": 15,
                    "sort_order": 0,
                    "is_active": True,
                }
            ],
        }
    )

    payload = view.model_dump(mode="json")
    assert payload["variants"][0]["label"] == "Длинные волосы"
    assert payload["addons"][0]["name"] == "Уход"
    assert "isActive" not in payload["variants"][0]
    assert "serviceId" not in payload["addons"][0]
    assert "tenantId" not in payload
    assert "allowOnlineBooking" not in payload
    assert "isActive" not in payload
