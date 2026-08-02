from __future__ import annotations

import uuid
from dataclasses import dataclass
from datetime import UTC, datetime

from sqlalchemy import desc, select, text
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.errors import ForbiddenError, NotFoundError
from app.models import Plan, Site, Subscription, SubscriptionStatus


@dataclass(frozen=True, slots=True)
class PlanAccess:
    plan_id: uuid.UUID
    code: str
    features: frozenset[str]
    limits: dict[str, int | None]
    subscription_status: str

    def require(self, feature: str) -> None:
        if feature not in self.features:
            raise ForbiddenError(
                "Функция недоступна на текущем тарифе",
                code=f"feature_{feature}_required",
            )

    def limit(self, name: str) -> int | None:
        value = self.limits.get(name)
        return int(value) if value is not None else None


async def lock_tenant_quota(session: AsyncSession, tenant_id: uuid.UUID, resource: str) -> None:
    """Сериализовать подсчёт и создание объектов в рамках квоты одного тенанта."""

    await session.execute(
        text("SELECT pg_advisory_xact_lock(hashtextextended(:key, 3))"),
        {"key": f"quota:{tenant_id}:{resource}"},
    )


async def plan_access_for_owner(session: AsyncSession, owner_id: uuid.UUID) -> PlanAccess:
    row = (
        await session.execute(
            select(Subscription, Plan)
            .join(Plan, Plan.id == Subscription.plan_id)
            .where(Subscription.owner_id == owner_id)
            .order_by(desc(Subscription.created_at))
            .limit(1)
        )
    ).one_or_none()
    if row is None:
        raise NotFoundError("Подписка не найдена", code="subscription_not_found")
    subscription, plan = row
    now = datetime.now(UTC)
    has_paid_access = subscription.status in {
        SubscriptionStatus.active,
        SubscriptionStatus.trialing,
    }
    if has_paid_access and subscription.current_period_end:
        has_paid_access = subscription.current_period_end > now
    if subscription.status is SubscriptionStatus.canceled:
        has_paid_access = bool(
            subscription.current_period_end and subscription.current_period_end > now
        )
    if subscription.status is SubscriptionStatus.past_due:
        has_paid_access = bool(
            subscription.grace_period_end and subscription.grace_period_end > now
        )
    if not has_paid_access:
        fallback = await session.scalar(
            select(Plan).where(Plan.code == "start", Plan.is_active.is_(True))
        )
        if fallback is None:
            raise ForbiddenError("Подписка неактивна", code="subscription_inactive")
        plan = fallback
    return PlanAccess(
        plan_id=plan.id,
        code=plan.code,
        features=frozenset(str(value) for value in plan.features),
        limits={
            str(key): (None if value is None else int(value)) for key, value in plan.limits.items()
        },
        subscription_status=subscription.status.value,
    )


async def plan_access_for_tenant(session: AsyncSession, tenant_id: uuid.UUID) -> PlanAccess:
    owner_id = await session.scalar(select(Site.owner_id).where(Site.id == tenant_id))
    if owner_id is None:
        raise NotFoundError("Салон не найден", code="tenant_not_found")
    return await plan_access_for_owner(session, owner_id)
