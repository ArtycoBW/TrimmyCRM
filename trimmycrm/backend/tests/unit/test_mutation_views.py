from __future__ import annotations

import os
from datetime import UTC, datetime
from decimal import Decimal
from types import SimpleNamespace
from typing import Any
from uuid import UUID

import pytest
from fastapi import BackgroundTasks

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

from app.api.routes import crm, engagement, sites  # noqa: E402
from app.models import (  # noqa: E402
    Promotion,
    SalonType,
    ScheduleException,
    ScheduleExceptionType,
    Service,
    Site,
    SiteStatus,
    Staff,
)
from app.schemas import (  # noqa: E402
    PromotionUpdate,
    ScheduleExceptionUpdate,
    ServiceUpdate,
    SiteUpdate,
    StaffUpdate,
)

TENANT_ID = UUID("11111111-1111-4111-8111-111111111111")
OWNER_ID = UUID("22222222-2222-4222-8222-222222222222")
ROW_ID = UUID("33333333-3333-4333-8333-333333333333")
SERVICE_ID = UUID("44444444-4444-4444-8444-444444444444")
CREATED_AT = datetime(2026, 7, 14, 10, tzinfo=UTC)
UPDATED_AT = datetime(2026, 7, 15, 10, tzinfo=UTC)


class _MutationSession:
    def __init__(self, row: Any, scalar_values: list[Any] | None = None) -> None:
        self.row = row
        self.scalar_values = list(scalar_values or [])
        self.flushes = 0
        self.refreshes = 0

    async def flush(self) -> None:
        self.flushes += 1
        self.row.__dict__.pop("updated_at", None)

    async def refresh(self, row: Any) -> None:
        assert row is self.row
        self.refreshes += 1
        row.updated_at = UPDATED_AT

    async def scalar(self, _statement: Any) -> Any:
        if self.scalar_values:
            return self.scalar_values.pop(0)
        return self.row

    async def scalars(self, _statement: Any) -> list[UUID]:
        return [SERVICE_ID]


class _StaffServiceSession:
    def __init__(self) -> None:
        self.pending: list[Any] = []
        self.persisted: list[UUID] = []
        self.flushes = 0

    async def execute(self, _statement: Any) -> None:
        self.persisted = []

    def add_all(self, rows: list[Any]) -> None:
        self.pending.extend(rows)

    async def flush(self) -> None:
        self.flushes += 1
        self.persisted = [row.service_id for row in self.pending]
        self.pending = []

    async def scalars(self, _statement: Any) -> list[UUID]:
        return self.persisted


def _service() -> Service:
    return Service(
        id=ROW_ID,
        tenant_id=TENANT_ID,
        name="Груминг",
        description=None,
        price=Decimal("1500.00"),
        duration_min=60,
        buffer_before_min=0,
        buffer_after_min=0,
        category=None,
        is_active=True,
        created_at=CREATED_AT,
        updated_at=CREATED_AT,
    )


def _staff() -> Staff:
    return Staff(
        id=ROW_ID,
        tenant_id=TENANT_ID,
        user_id=None,
        name="Анна",
        specialization="Гремер",
        photo_url=None,
        schedule={},
        is_active=True,
        created_at=CREATED_AT,
        updated_at=CREATED_AT,
    )


def _promotion() -> Promotion:
    return Promotion(
        id=ROW_ID,
        tenant_id=TENANT_ID,
        title="Летняя акция",
        description=None,
        discount_percent=10,
        promo_code="SUMMER10",
        valid_from=None,
        valid_to=None,
        max_uses=None,
        used_count=0,
        is_active=True,
        created_at=CREATED_AT,
        updated_at=CREATED_AT,
    )


def _schedule_exception() -> ScheduleException:
    return ScheduleException(
        id=ROW_ID,
        tenant_id=TENANT_ID,
        staff_id=ROW_ID,
        start_at=datetime(2026, 7, 20, 9, tzinfo=UTC),
        end_at=datetime(2026, 7, 20, 12, tzinfo=UTC),
        kind="break",
        type=ScheduleExceptionType.unavailable,
        reason="Визит к врачу",
        created_at=CREATED_AT,
        updated_at=CREATED_AT,
    )


@pytest.mark.asyncio
async def test_update_service_refreshes_server_timestamp(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    row = _service()
    session = _MutationSession(row)

    async def service_or_404(_session: Any, _tenant_id: UUID, _service_id: UUID) -> Service:
        return row

    monkeypatch.setattr(crm, "_service_or_404", service_or_404)

    result = await crm.update_service(
        ROW_ID,
        ServiceUpdate(name="Комплексный груминг"),
        _owner=None,
        tenant_id=TENANT_ID,
        session=session,
    )

    assert result.name == "Комплексный груминг"
    assert result.updatedAt == UPDATED_AT
    assert session.refreshes == 1


@pytest.mark.asyncio
async def test_update_staff_refreshes_server_timestamp(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    row = _staff()
    session = _MutationSession(row)

    async def staff_or_404(_session: Any, _tenant_id: UUID, _staff_id: UUID) -> Staff:
        return row

    monkeypatch.setattr(crm, "_staff_or_404", staff_or_404)

    result = await crm.update_staff(
        ROW_ID,
        StaffUpdate(name="Анна Петрова"),
        _owner=None,
        tenant_id=TENANT_ID,
        session=session,
    )

    assert result.name == "Анна Петрова"
    assert result.updatedAt == UPDATED_AT
    assert session.refreshes == 1


@pytest.mark.asyncio
async def test_staff_services_are_flushed_before_response(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    row = _staff()
    session = _StaffServiceSession()

    async def validated(_session: Any, _tenant_id: UUID, service_ids: list[UUID]) -> list[UUID]:
        return service_ids

    monkeypatch.setattr(crm, "_validated_staff_service_ids", validated)

    await crm._replace_staff_services(session, TENANT_ID, row.id, [SERVICE_ID])
    result = await crm._staff_view(session, row)

    assert session.flushes == 1
    assert result.serviceIds == [SERVICE_ID]


@pytest.mark.asyncio
async def test_update_promotion_refreshes_server_timestamp(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    row = _promotion()
    session = _MutationSession(row)

    class _Access:
        def require(self, feature: str) -> None:
            assert feature == "promotions"

    async def access_for_tenant(_session: Any, _tenant_id: UUID) -> _Access:
        return _Access()

    monkeypatch.setattr(engagement, "plan_access_for_tenant", access_for_tenant)

    result = await engagement.update_promotion(
        ROW_ID,
        PromotionUpdate(description="Для постоянных клиентов"),
        _owner=None,
        tenant_id=TENANT_ID,
        session=session,
    )

    assert result.description == "Для постоянных клиентов"
    assert result.updatedAt == UPDATED_AT
    assert session.refreshes == 1


@pytest.mark.asyncio
async def test_update_site_refreshes_server_timestamp(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    row = Site(
        id=TENANT_ID,
        owner_id=OWNER_ID,
        name="Форма",
        slug="forma",
        salon_type=SalonType.women_hair_salon,
        service_focuses=["haircut", "color"],
        locale="ru-RU",
        currency="RUB",
        custom_domain=None,
        domain_verified=False,
        description=None,
        city="Москва",
        street=None,
        phone=None,
        timezone="Europe/Moscow",
        work_hours={},
        socials={},
        logo_url=None,
        theme={},
        template_key="default",
        status=SiteStatus.draft,
        published_at=None,
        created_at=CREATED_AT,
        updated_at=CREATED_AT,
    )
    session = _MutationSession(row, [1, None])

    async def owner_site(_session: Any, _owner_id: UUID, *, lock: bool = False) -> Site:
        assert lock
        return row

    async def no_context(*_args: Any, **_kwargs: Any) -> None:
        return None

    async def save_version(fake_session: Any, **_kwargs: Any) -> None:
        await fake_session.flush()

    monkeypatch.setattr(sites, "_owner_site", owner_site)
    monkeypatch.setattr(sites, "set_rls_context", no_context)
    monkeypatch.setattr(sites, "save_version", save_version)
    monkeypatch.setattr(sites, "_invalidate_host_cache", no_context)
    monkeypatch.setattr(sites, "_schedule_host_cache_invalidation", lambda *_args: None)

    result = await sites.update_site(
        SiteUpdate(description="Салон стрижек и окрашивания"),
        request=SimpleNamespace(),
        background=BackgroundTasks(),
        user=SimpleNamespace(id=OWNER_ID),
        session=session,
    )

    assert result.description == "Салон стрижек и окрашивания"
    assert result.updatedAt == UPDATED_AT
    assert session.refreshes == 1


def test_schedule_exception_view_maps_database_time_fields() -> None:
    row = _schedule_exception()

    result = crm._schedule_exception_view(row)

    assert result.startsAt == row.start_at
    assert result.endsAt == row.end_at


@pytest.mark.asyncio
async def test_update_schedule_exception_refreshes_server_timestamp(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    row = _schedule_exception()
    session = _MutationSession(row)

    async def exception_or_404(*_args: Any, **_kwargs: Any) -> ScheduleException:
        return row

    monkeypatch.setattr(crm, "_schedule_exception_or_404", exception_or_404)

    result = await crm.update_schedule_exception(
        ROW_ID,
        ROW_ID,
        ScheduleExceptionUpdate(reason="Обед"),
        _owner=None,
        tenant_id=TENANT_ID,
        session=session,
    )

    assert result.reason == "Обед"
    assert result.updatedAt == UPDATED_AT
    assert session.refreshes == 1
