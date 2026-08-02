from __future__ import annotations

import os
from datetime import UTC, date, datetime
from decimal import Decimal
from typing import Any
from uuid import UUID

import pytest
from fastapi.routing import APIRoute
from pydantic import ValidationError
from sqlalchemy.dialects import postgresql

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

from app.api.deps import TenantContext  # noqa: E402
from app.api.routes import crm, engagement  # noqa: E402
from app.core.errors import ForbiddenError  # noqa: E402
from app.models import Promotion, Review, ReviewStatus, ServicePriceType  # noqa: E402
from app.schemas import (  # noqa: E402
    ClientDetailsView,
    ClientView,
    PublicPromotionView,
    PublicReviewView,
    PublicServiceView,
    PublicStaffView,
    SiteUpdate,
    StaffCreate,
)

TENANT_ID = UUID("11111111-1111-4111-8111-111111111111")
PUBLIC_ID = UUID("22222222-2222-4222-8222-222222222222")


def _route(router: Any, path: str) -> APIRoute:
    return next(
        route for route in router.routes if isinstance(route, APIRoute) and route.path == path
    )


def test_public_routes_use_dedicated_response_models() -> None:
    assert _route(crm.router, "/public/services").response_model == list[PublicServiceView]
    assert _route(crm.router, "/public/staff").response_model == list[PublicStaffView]
    assert _route(engagement.router, "/public/reviews").response_model == list[PublicReviewView]
    assert (
        _route(engagement.router, "/public/promotions").response_model == list[PublicPromotionView]
    )
    assert _route(crm.router, "/clients/{client_id}").response_model is ClientDetailsView


def test_public_service_projection_drops_tenant_and_lifecycle_fields() -> None:
    view = PublicServiceView.model_validate(
        {
            "id": PUBLIC_ID,
            "tenant_id": TENANT_ID,
            "name": "Стрижка и укладка",
            "description": "Стрижка с подбором формы",
            "category_id": None,
            "price": Decimal("3500.00"),
            "max_price": None,
            "price_type": ServicePriceType.fixed,
            "currency": "RUB",
            "duration_min": 120,
            "buffer_before_min": 10,
            "buffer_after_min": 15,
            "requires_consultation": False,
            "requires_patch_test": False,
            "variant_selection_required": True,
            "preparation_text": "Приходите с чистыми волосами",
            "aftercare_text": "Используйте термозащиту",
        }
    )

    assert set(view.model_dump()) == {
        "id",
        "name",
        "description",
        "categoryId",
        "categoryName",
        "price",
        "maxPrice",
        "priceType",
        "currency",
        "durationMin",
        "bufferBeforeMin",
        "bufferAfterMin",
        "requiresConsultation",
        "requiresPatchTest",
        "variantSelectionRequired",
        "preparationText",
        "aftercareText",
        "variants",
        "addons",
    }


def test_public_staff_projection_drops_internal_fields() -> None:
    view = PublicStaffView.model_validate(
        {
            "id": PUBLIC_ID,
            "tenant_id": TENANT_ID,
            "user_id": UUID("33333333-3333-4333-8333-333333333333"),
            "name": "Анна",
            "specialization": "Стилист",
            "photo_url": "/api/v1/public/media/photo",
            "schedule": {"monday": [{"start": "09:00", "end": "18:00"}]},
            "service_ids": [UUID("44444444-4444-4444-8444-444444444444")],
            "is_active": True,
            "created_at": datetime(2026, 7, 14, tzinfo=UTC),
            "updated_at": datetime(2026, 7, 14, tzinfo=UTC),
        }
    )

    assert set(view.model_dump()) == {
        "id",
        "name",
        "specialization",
        "photoUrl",
        "serviceIds",
    }


def test_public_review_projection_masks_author_and_drops_relations() -> None:
    row = Review(
        id=PUBLIC_ID,
        tenant_id=TENANT_ID,
        tenant_user_id=UUID("33333333-3333-4333-8333-333333333333"),
        appointment_id=UUID("44444444-4444-4444-8444-444444444444"),
        rating=5,
        text="Отлично",
        status=ReviewStatus.published,
        created_at=datetime(2026, 7, 14, tzinfo=UTC),
    )

    payload = engagement._public_review_view(row).model_dump()

    assert payload["authorName"] == "Клиент"
    assert set(payload) == {"id", "rating", "text", "authorName", "createdAt"}


def test_public_promotion_projection_keeps_code_but_drops_usage_state() -> None:
    view = PublicPromotionView.model_validate(
        {
            "id": PUBLIC_ID,
            "title": "Летняя акция",
            "description": "Скидка на комплекс",
            "discount_percent": 15,
            "promo_code": "SUMMER15",
            "valid_from": date(2026, 7, 1),
            "valid_to": date(2026, 7, 31),
            "max_uses": 100,
            "used_count": 10,
            "is_active": True,
        }
    )

    assert view.promoCode == "SUMMER15"
    assert set(view.model_dump()) == {
        "id",
        "title",
        "description",
        "discountPercent",
        "promoCode",
        "validFrom",
        "validTo",
    }


def test_client_list_contract_stays_separate_from_detail_history() -> None:
    assert "appointmentHistory" not in ClientView.model_fields
    assert "appointmentHistory" in ClientDetailsView.model_fields


def test_site_and_staff_reject_untrusted_urls() -> None:
    with pytest.raises(ValidationError):
        SiteUpdate(socials={"telegram": "javascript:alert(1)"})
    with pytest.raises(ValidationError):
        StaffCreate(name="Анна", photoUrl="http://127.0.0.1/private")


class _Access:
    def __init__(self, *, allowed: bool = True) -> None:
        self.allowed = allowed
        self.required: list[str] = []

    def require(self, feature: str) -> None:
        self.required.append(feature)
        if not self.allowed:
            raise ForbiddenError(code=f"feature_{feature}_required")


class _Scalars:
    def __init__(self, rows: list[Promotion]) -> None:
        self._rows = rows

    def all(self) -> list[Promotion]:
        return self._rows


class _Session:
    def __init__(self, rows: list[Promotion]) -> None:
        self.rows = rows
        self.statement: Any | None = None

    async def scalars(self, statement: Any) -> _Scalars:
        self.statement = statement
        return _Scalars(self.rows)


@pytest.mark.asyncio
async def test_public_promotions_require_feature_and_apply_visibility_filters(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    access = _Access()
    promotion = Promotion(
        id=PUBLIC_ID,
        tenant_id=TENANT_ID,
        title="Летняя акция",
        description=None,
        discount_percent=Decimal("15"),
        promo_code="SUMMER15",
        valid_from=date(2026, 7, 1),
        valid_to=date(2026, 7, 31),
        max_uses=100,
        used_count=10,
        is_active=True,
    )
    session = _Session([promotion])

    async def access_for_tenant(_session: Any, tenant_id: UUID) -> _Access:
        assert tenant_id == TENANT_ID
        return access

    async def salon_today(_session: Any, tenant_id: UUID) -> date:
        assert tenant_id == TENANT_ID
        return date(2026, 7, 14)

    monkeypatch.setattr(engagement, "plan_access_for_tenant", access_for_tenant)
    monkeypatch.setattr(engagement, "_salon_today", salon_today)

    result = await engagement.public_promotions(
        limit=6,
        context=TenantContext(id=TENANT_ID, host="salon.test", slug="salon"),
        session=session,  # type: ignore[arg-type]
    )

    assert access.required == ["promotions"]
    assert result[0].promoCode == "SUMMER15"
    assert session.statement is not None
    sql = str(
        session.statement.compile(
            dialect=postgresql.dialect(),  # type: ignore[no-untyped-call]
            compile_kwargs={"literal_binds": True},
        )
    ).lower()
    assert "promotions.tenant_id =" in sql
    assert "promotions.is_active is true" in sql
    assert "promotions.title is not null" in sql
    assert "promotions.discount_percent is not null" in sql
    assert "promotions.valid_from is null or promotions.valid_from <=" in sql
    assert "promotions.valid_to is null or promotions.valid_to >=" in sql
    assert "promotions.max_uses is null or promotions.used_count < promotions.max_uses" in sql
    assert "limit 6" in sql


@pytest.mark.asyncio
async def test_public_promotions_check_feature_before_data_query(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    access = _Access(allowed=False)
    session = _Session([])

    async def access_for_tenant(_session: Any, _tenant_id: UUID) -> _Access:
        return access

    monkeypatch.setattr(engagement, "plan_access_for_tenant", access_for_tenant)

    with pytest.raises(ForbiddenError) as exc_info:
        await engagement.public_promotions(
            limit=6,
            context=TenantContext(id=TENANT_ID, host="salon.test", slug="salon"),
            session=session,  # type: ignore[arg-type]
        )

    assert exc_info.value.code == "feature_promotions_required"
    assert session.statement is None
