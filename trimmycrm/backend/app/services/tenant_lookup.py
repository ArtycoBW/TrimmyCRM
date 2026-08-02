from __future__ import annotations

from datetime import UTC, datetime

from sqlalchemy import select

from app.core.tenant import TenantIdentity
from app.db.session import RuntimeSession
from app.models import Plan, Site, SiteStatus, Subscription, SubscriptionStatus


class SQLTenantLookup:
    """Доверенный репозиторий сопоставлений хостов.

    ``sites`` — корневая таблица тенантов без RLS. Все дочерние данные остаются
    под защитой FORCE RLS. Репозиторий возвращает только идентификаторы и никогда
    не возвращает персональные данные салона.
    """

    def __init__(self, base_domain: str) -> None:
        self.base_domain = base_domain.strip().lower().rstrip(".")

    async def find_by_slug(self, slug: str) -> TenantIdentity | None:
        async with RuntimeSession() as session:
            site = await session.scalar(
                select(Site).where(
                    Site.slug == slug,
                    Site.status.in_([SiteStatus.draft, SiteStatus.published]),
                )
            )
        if site is None:
            return None
        return TenantIdentity(
            id=site.id,
            slug=str(site.slug),
            canonical_host=f"{site.slug}.{self.base_domain}",
            status=site.status.value,
            custom_domain=str(site.custom_domain) if site.custom_domain else None,
        )

    async def find_by_custom_domain(self, domain: str) -> TenantIdentity | None:
        async with RuntimeSession() as session:
            result = (
                await session.execute(
                    select(Site, Subscription, Plan)
                    .join(Subscription, Subscription.owner_id == Site.owner_id)
                    .join(Plan, Plan.id == Subscription.plan_id)
                    .where(
                        Site.custom_domain == domain,
                        Site.domain_verified.is_(True),
                        Site.status.in_([SiteStatus.draft, SiteStatus.published]),
                    )
                    .order_by(Subscription.created_at.desc())
                    .limit(1)
                )
            ).one_or_none()
        if result is None:
            return None
        site, subscription, plan = result
        now = datetime.now(UTC)
        entitled = subscription.status in {
            SubscriptionStatus.active,
            SubscriptionStatus.trialing,
        }
        if entitled and subscription.current_period_end is not None:
            entitled = subscription.current_period_end > now
        if subscription.status is SubscriptionStatus.canceled:
            entitled = bool(
                subscription.current_period_end and subscription.current_period_end > now
            )
        if subscription.status is SubscriptionStatus.past_due:
            entitled = bool(subscription.grace_period_end and subscription.grace_period_end > now)
        if not entitled or "custom_domain" not in {str(feature) for feature in plan.features}:
            return None
        return TenantIdentity(
            id=site.id,
            slug=str(site.slug),
            canonical_host=domain,
            status=site.status.value,
            custom_domain=domain,
        )
