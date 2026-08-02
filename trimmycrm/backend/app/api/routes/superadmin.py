from __future__ import annotations

from datetime import UTC, datetime
from uuid import UUID

from fastapi import APIRouter, BackgroundTasks, Depends, Query, Request
from sqlalchemy import desc, func, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.sql.elements import ColumnElement

from app.api.deps import require_superadmin, superadmin_db
from app.core.errors import BadRequestError, NotFoundError
from app.core.logging import get_request_id
from app.models import (
    Appointment,
    AuditActorType,
    AuditLog,
    ChatLead,
    CustomLandingOrder,
    CustomLandingStatus,
    FeedbackMessage,
    LandingLead,
    Payment,
    PaymentStatus,
    Plan,
    PlatformRole,
    PlatformUser,
    PlatformUserStatus,
    Site,
    SiteStatus,
    Subscription,
    SubscriptionStatus,
    TenantUser,
)
from app.schemas import (
    CustomLandingStatusUpdate,
    FeedbackReadUpdate,
    Paginated,
    Pagination,
    PlanUpdate,
    PlanView,
    TemplateUpdate,
    TenantAdminUpdate,
)

router = APIRouter(prefix="/admin", tags=["superadmin"])


def _audit(
    session: AsyncSession,
    *,
    actor_id: UUID,
    action: str,
    entity_type: str,
    entity_id: UUID | None,
    tenant_id: UUID | None = None,
    before: dict[str, object] | None = None,
    after: dict[str, object] | None = None,
) -> None:
    session.add(
        AuditLog(
            tenant_id=tenant_id,
            actor_type=AuditActorType.platform_user,
            actor_id=actor_id,
            action=action,
            entity_type=entity_type,
            entity_id=entity_id,
            before=before,
            after=after,
            request_id=get_request_id(),
        )
    )


@router.get("/users", response_model=Paginated)
async def users(
    pagination: Pagination = Depends(),
    search: str | None = Query(default=None, max_length=160),
    role: PlatformRole | None = None,
    status_: PlatformUserStatus | None = Query(default=None, alias="status"),
    plan_id: UUID | None = Query(default=None, alias="planId"),
    _admin: PlatformUser = Depends(require_superadmin),
    session: AsyncSession = Depends(superadmin_db, scope="function"),
) -> Paginated:
    latest_subscription_id = (
        select(Subscription.id)
        .where(Subscription.owner_id == PlatformUser.id)
        .order_by(Subscription.created_at.desc())
        .limit(1)
        .correlate(PlatformUser)
        .scalar_subquery()
    )
    filters: list[ColumnElement[bool]] = []
    if search:
        pattern = f"%{search.strip()}%"
        filters.append(
            PlatformUser.email.ilike(pattern)
            | PlatformUser.full_name.ilike(pattern)
            | PlatformUser.phone.ilike(pattern)
            | Site.name.ilike(pattern)
            | Site.slug.ilike(pattern)
        )
    if role is not None:
        filters.append(PlatformUser.role == role)
    if status_ is not None:
        filters.append(PlatformUser.status == status_)
    if plan_id is not None:
        filters.append(Subscription.plan_id == plan_id)

    base = (
        select(PlatformUser, Site, Subscription, Plan)
        .outerjoin(Site, Site.owner_id == PlatformUser.id)
        .outerjoin(Subscription, Subscription.id == latest_subscription_id)
        .outerjoin(Plan, Plan.id == Subscription.plan_id)
        .where(*filters)
    )
    total = int(
        await session.scalar(
            select(func.count())
            .select_from(PlatformUser)
            .outerjoin(Site, Site.owner_id == PlatformUser.id)
            .outerjoin(Subscription, Subscription.id == latest_subscription_id)
            .where(*filters)
        )
        or 0
    )
    rows = (
        await session.execute(
            base.order_by(PlatformUser.created_at.desc())
            .offset((pagination.page - 1) * pagination.limit)
            .limit(pagination.limit)
        )
    ).all()
    return Paginated(
        items=[
            {
                "id": user.id,
                "email": user.email,
                "fullName": user.full_name,
                "phone": user.phone,
                "role": user.role.value,
                "status": user.status.value,
                "emailVerified": user.email_verified,
                "createdAt": user.created_at,
                "lastLoginAt": user.last_login_at,
                "site": None
                if site is None
                else {
                    "id": site.id,
                    "name": site.name,
                    "slug": site.slug,
                    "status": site.status.value,
                },
                "subscription": None
                if subscription is None
                else {
                    "id": subscription.id,
                    "status": subscription.status.value,
                    "currentPeriodEnd": subscription.current_period_end,
                    "plan": None
                    if plan is None
                    else {"id": plan.id, "code": plan.code, "name": plan.name},
                },
            }
            for user, site, subscription, plan in rows
        ],
        total=total,
        page=pagination.page,
        limit=pagination.limit,
    )


@router.get("/feedback", response_model=Paginated)
async def feedback_messages(
    pagination: Pagination = Depends(),
    search: str | None = Query(default=None, max_length=160),
    status_: str | None = Query(default=None, alias="status", pattern="^(new|read)$"),
    _admin: PlatformUser = Depends(require_superadmin),
    session: AsyncSession = Depends(superadmin_db, scope="function"),
) -> Paginated:
    filters: list[ColumnElement[bool]] = []
    if search:
        pattern = f"%{search.strip()}%"
        filters.append(
            FeedbackMessage.message.ilike(pattern)
            | PlatformUser.email.ilike(pattern)
            | PlatformUser.full_name.ilike(pattern)
            | PlatformUser.phone.ilike(pattern)
        )
    if status_ == "new":
        filters.append(FeedbackMessage.read_at.is_(None))
    elif status_ == "read":
        filters.append(FeedbackMessage.read_at.is_not(None))
    total = int(
        await session.scalar(
            select(func.count())
            .select_from(FeedbackMessage)
            .join(PlatformUser, PlatformUser.id == FeedbackMessage.author_id)
            .where(*filters)
        )
        or 0
    )
    rows = (
        await session.execute(
            select(FeedbackMessage, PlatformUser)
            .join(PlatformUser, PlatformUser.id == FeedbackMessage.author_id)
            .where(*filters)
            .order_by(FeedbackMessage.created_at.desc())
            .offset((pagination.page - 1) * pagination.limit)
            .limit(pagination.limit)
        )
    ).all()
    return Paginated(
        items=[
            {
                "id": message.id,
                "message": message.message,
                "createdAt": message.created_at,
                "readAt": message.read_at,
                "author": {
                    "id": author.id,
                    "email": author.email,
                    "fullName": author.full_name,
                    "phone": author.phone,
                },
            }
            for message, author in rows
        ],
        total=total,
        page=pagination.page,
        limit=pagination.limit,
    )


@router.patch("/feedback/{message_id}")
async def update_feedback_message(
    message_id: UUID,
    payload: FeedbackReadUpdate,
    admin: PlatformUser = Depends(require_superadmin),
    session: AsyncSession = Depends(superadmin_db, scope="function"),
) -> dict[str, object]:
    message = await session.get(FeedbackMessage, message_id, with_for_update=True)
    if message is None:
        raise NotFoundError("Сообщение не найдено")
    before: dict[str, object] = {"readAt": message.read_at.isoformat() if message.read_at else None}
    message.read_at = datetime.now(UTC) if payload.read else None
    _audit(
        session,
        actor_id=admin.id,
        action="feedback.read.update",
        entity_type="feedback_message",
        entity_id=message.id,
        before=before,
        after={"read": payload.read},
    )
    return {"id": message.id, "readAt": message.read_at}


@router.get("/landing-leads", response_model=Paginated)
async def landing_leads(
    pagination: Pagination = Depends(),
    search: str | None = Query(default=None, max_length=160),
    kind: str | None = Query(default=None, pattern="^(question|callback)$"),
    status_: str | None = Query(default=None, alias="status", pattern="^(new|read)$"),
    _admin: PlatformUser = Depends(require_superadmin),
    session: AsyncSession = Depends(superadmin_db, scope="function"),
) -> Paginated:
    filters: list[ColumnElement[bool]] = []
    if search:
        pattern = f"%{search.strip()}%"
        filters.append(
            LandingLead.name.ilike(pattern)
            | LandingLead.phone.ilike(pattern)
            | LandingLead.question.ilike(pattern)
        )
    if kind:
        filters.append(LandingLead.kind == kind)
    if status_ == "new":
        filters.append(LandingLead.read_at.is_(None))
    elif status_ == "read":
        filters.append(LandingLead.read_at.is_not(None))
    total = int(
        await session.scalar(select(func.count()).select_from(LandingLead).where(*filters)) or 0
    )
    rows = (
        (
            await session.execute(
                select(LandingLead)
                .where(*filters)
                .order_by(LandingLead.created_at.desc())
                .offset((pagination.page - 1) * pagination.limit)
                .limit(pagination.limit)
            )
        )
        .scalars()
        .all()
    )
    return Paginated(
        items=[
            {
                "id": lead.id,
                "kind": lead.kind,
                "name": lead.name,
                "phone": lead.phone,
                "question": lead.question,
                "preferredTime": lead.preferred_time,
                "createdAt": lead.created_at,
                "readAt": lead.read_at,
            }
            for lead in rows
        ],
        total=total,
        page=pagination.page,
        limit=pagination.limit,
    )


@router.patch("/landing-leads/{lead_id}")
async def update_landing_lead(
    lead_id: UUID,
    payload: FeedbackReadUpdate,
    admin: PlatformUser = Depends(require_superadmin),
    session: AsyncSession = Depends(superadmin_db, scope="function"),
) -> dict[str, object]:
    lead = await session.get(LandingLead, lead_id, with_for_update=True)
    if lead is None:
        raise NotFoundError("Заявка не найдена")
    lead.read_at = datetime.now(UTC) if payload.read else None
    _audit(
        session,
        actor_id=admin.id,
        action="landing_lead.read.update",
        entity_type="landing_lead",
        entity_id=lead.id,
        after={"read": payload.read},
    )
    return {"id": lead.id, "readAt": lead.read_at}


@router.get("/chat-leads", response_model=Paginated)
async def chat_leads(
    pagination: Pagination = Depends(),
    search: str | None = Query(default=None, max_length=160),
    status_: str | None = Query(default=None, alias="status", pattern="^(new|read)$"),
    _admin: PlatformUser = Depends(require_superadmin),
    session: AsyncSession = Depends(superadmin_db, scope="function"),
) -> Paginated:
    filters: list[ColumnElement[bool]] = []
    if search:
        pattern = f"%{search.strip()}%"
        filters.append(
            ChatLead.name.ilike(pattern)
            | ChatLead.phone.ilike(pattern)
            | ChatLead.question.ilike(pattern)
        )
    if status_ == "new":
        filters.append(ChatLead.read_at.is_(None))
    elif status_ == "read":
        filters.append(ChatLead.read_at.is_not(None))
    total = int(
        await session.scalar(select(func.count()).select_from(ChatLead).where(*filters)) or 0
    )
    rows = (
        (
            await session.execute(
                select(ChatLead)
                .where(*filters)
                .order_by(ChatLead.created_at.desc())
                .offset((pagination.page - 1) * pagination.limit)
                .limit(pagination.limit)
            )
        )
        .scalars()
        .all()
    )
    return Paginated(
        items=[
            {
                "id": lead.id,
                "name": lead.name,
                "phone": lead.phone,
                "question": lead.question,
                "createdAt": lead.created_at,
                "readAt": lead.read_at,
            }
            for lead in rows
        ],
        total=total,
        page=pagination.page,
        limit=pagination.limit,
    )


@router.patch("/chat-leads/{lead_id}")
async def update_chat_lead(
    lead_id: UUID,
    payload: FeedbackReadUpdate,
    admin: PlatformUser = Depends(require_superadmin),
    session: AsyncSession = Depends(superadmin_db, scope="function"),
) -> dict[str, object]:
    lead = await session.get(ChatLead, lead_id, with_for_update=True)
    if lead is None:
        raise NotFoundError("Обращение из чата не найдено")
    lead.read_at = datetime.now(UTC) if payload.read else None
    _audit(
        session,
        actor_id=admin.id,
        action="chat_lead.read.update",
        entity_type="chat_lead",
        entity_id=lead.id,
        after={"read": payload.read},
    )
    return {"id": lead.id, "readAt": lead.read_at}


@router.get("/tenants", response_model=Paginated)
async def tenants(
    pagination: Pagination = Depends(),
    search: str | None = Query(default=None, max_length=160),
    status_: SiteStatus | None = Query(default=None, alias="status"),
    _admin: PlatformUser = Depends(require_superadmin),
    session: AsyncSession = Depends(superadmin_db, scope="function"),
) -> Paginated:
    filters: list[ColumnElement[bool]] = []
    if search:
        filters.append(
            Site.name.ilike(f"%{search}%")
            | Site.slug.ilike(f"%{search}%")
            | PlatformUser.email.ilike(f"%{search}%")
        )
    if status_:
        filters.append(Site.status == status_)
    total = int(
        await session.scalar(
            select(func.count())
            .select_from(Site)
            .join(PlatformUser, PlatformUser.id == Site.owner_id)
            .where(*filters)
        )
        or 0
    )
    rows = (
        await session.execute(
            select(Site, PlatformUser, Subscription, Plan)
            .join(PlatformUser, PlatformUser.id == Site.owner_id)
            .outerjoin(Subscription, Subscription.owner_id == PlatformUser.id)
            .outerjoin(Plan, Plan.id == Subscription.plan_id)
            .where(*filters)
            .order_by(Site.created_at.desc(), Subscription.created_at.desc())
            .offset((pagination.page - 1) * pagination.limit)
            .limit(pagination.limit)
        )
    ).all()
    seen: set[UUID] = set()
    items = []
    for site, owner, subscription, plan in rows:
        if site.id in seen:
            continue
        seen.add(site.id)
        items.append(
            {
                "id": site.id,
                "name": site.name,
                "slug": site.slug,
                "customDomain": site.custom_domain,
                "status": site.status.value,
                "owner": {"id": owner.id, "email": owner.email, "status": owner.status.value},
                "subscription": (
                    None
                    if subscription is None
                    else {
                        "id": subscription.id,
                        "status": subscription.status.value,
                        "plan": None
                        if plan is None
                        else {"id": plan.id, "code": plan.code, "name": plan.name},
                        "currentPeriodEnd": subscription.current_period_end,
                    }
                ),
                "createdAt": site.created_at,
            }
        )
    return Paginated(items=items, total=total, page=pagination.page, limit=pagination.limit)


async def _tenant_detail(session: AsyncSession, tenant_id: UUID) -> dict[str, object]:
    row = (
        await session.execute(
            select(Site, PlatformUser, Subscription, Plan)
            .join(PlatformUser, PlatformUser.id == Site.owner_id)
            .outerjoin(Subscription, Subscription.owner_id == PlatformUser.id)
            .outerjoin(Plan, Plan.id == Subscription.plan_id)
            .where(Site.id == tenant_id)
            .order_by(Subscription.created_at.desc())
            .limit(1)
        )
    ).one_or_none()
    if row is None:
        raise NotFoundError("Тенант не найден")
    site, owner, subscription, plan = row
    return {
        "id": site.id,
        "name": site.name,
        "slug": site.slug,
        "customDomain": site.custom_domain,
        "domainVerified": site.domain_verified,
        "status": site.status.value,
        "templateKey": site.template_key,
        "owner": {"id": owner.id, "email": owner.email, "status": owner.status.value},
        "subscription": (
            None
            if subscription is None
            else {
                "id": subscription.id,
                "status": subscription.status.value,
                "plan": None
                if plan is None
                else PlanView.model_validate(plan).model_dump(mode="json"),
                "currentPeriodEnd": subscription.current_period_end,
                "autoRenew": subscription.auto_renew,
            }
        ),
    }


@router.get("/tenants/{tenant_id}")
async def tenant_detail(
    tenant_id: UUID,
    _admin: PlatformUser = Depends(require_superadmin),
    session: AsyncSession = Depends(superadmin_db, scope="function"),
) -> dict[str, object]:
    return await _tenant_detail(session, tenant_id)


@router.patch("/tenants/{tenant_id}")
async def update_tenant(
    tenant_id: UUID,
    payload: TenantAdminUpdate,
    request: Request,
    background: BackgroundTasks,
    admin: PlatformUser = Depends(require_superadmin),
    session: AsyncSession = Depends(superadmin_db, scope="function"),
) -> dict[str, object]:
    site = await session.get(Site, tenant_id, with_for_update=True)
    if site is None:
        raise NotFoundError("Тенант не найден")
    before: dict[str, object] = {"status": site.status.value}
    if payload.status is not None:
        site.status = SiteStatus(payload.status)
    subscription = await session.scalar(
        select(Subscription)
        .where(Subscription.owner_id == site.owner_id)
        .order_by(desc(Subscription.created_at))
        .limit(1)
        .with_for_update()
    )
    if payload.planId is not None:
        plan = await session.get(Plan, payload.planId)
        if plan is None:
            raise NotFoundError("Тариф не найден")
        if subscription is None:
            subscription = Subscription(
                owner_id=site.owner_id,
                plan_id=plan.id,
                status=SubscriptionStatus.active,
                current_period_start=datetime.now(UTC),
                current_period_end=payload.currentPeriodEnd,
            )
            session.add(subscription)
        else:
            subscription.plan_id = plan.id
    if payload.subscriptionStatus is not None:
        if subscription is None:
            raise BadRequestError("У владельца нет подписки", code="subscription_missing")
        subscription.status = SubscriptionStatus(payload.subscriptionStatus)
    if payload.currentPeriodEnd is not None:
        if subscription is None:
            raise BadRequestError("У владельца нет подписки", code="subscription_missing")
        subscription.current_period_end = payload.currentPeriodEnd
    _audit(
        session,
        actor_id=admin.id,
        action="tenant.update",
        entity_type="site",
        entity_id=site.id,
        tenant_id=site.id,
        before=before,
        after=payload.model_dump(exclude_unset=True, mode="json"),
    )
    await session.flush()
    if any(
        value is not None
        for value in (
            payload.status,
            payload.planId,
            payload.subscriptionStatus,
            payload.currentPeriodEnd,
        )
    ):
        settings = request.app.state.settings
        hosts = [f"{site.slug}.{base_domain}" for base_domain in settings.tenant_base_domains]
        if site.custom_domain:
            hosts.append(str(site.custom_domain).lower())
        background.add_task(request.app.state.tenant_resolver.invalidate, *hosts)
    return await _tenant_detail(session, tenant_id)


@router.get("/custom-landing-orders", response_model=Paginated)
async def custom_landing_orders(
    pagination: Pagination = Depends(),
    status_: CustomLandingStatus | None = Query(default=None, alias="status"),
    _admin: PlatformUser = Depends(require_superadmin),
    session: AsyncSession = Depends(superadmin_db, scope="function"),
) -> Paginated:
    filters = [] if status_ is None else [CustomLandingOrder.status == status_]
    total = int(
        await session.scalar(select(func.count()).select_from(CustomLandingOrder).where(*filters))
        or 0
    )
    rows = (
        await session.execute(
            select(CustomLandingOrder, Site)
            .join(Site, Site.id == CustomLandingOrder.tenant_id)
            .where(*filters)
            .order_by(CustomLandingOrder.created_at.desc())
            .offset((pagination.page - 1) * pagination.limit)
            .limit(pagination.limit)
        )
    ).all()
    return Paginated(
        items=[
            {
                "id": order.id,
                "tenantId": order.tenant_id,
                "siteName": site.name,
                "status": order.status.value,
                "price": order.price,
                "contact": order.contact,
                "notes": order.notes,
                "createdAt": order.created_at,
            }
            for order, site in rows
        ],
        total=total,
        page=pagination.page,
        limit=pagination.limit,
    )


@router.patch("/custom-landing-orders/{order_id}")
async def update_custom_landing_order(
    order_id: UUID,
    payload: CustomLandingStatusUpdate,
    admin: PlatformUser = Depends(require_superadmin),
    session: AsyncSession = Depends(superadmin_db, scope="function"),
) -> dict[str, object]:
    order = await session.get(CustomLandingOrder, order_id, with_for_update=True)
    if order is None:
        raise NotFoundError("Заявка не найдена")
    allowed = {
        CustomLandingStatus.requested: {CustomLandingStatus.paid, CustomLandingStatus.cancelled},
        CustomLandingStatus.paid: {CustomLandingStatus.in_progress, CustomLandingStatus.cancelled},
        CustomLandingStatus.in_progress: {
            CustomLandingStatus.delivered,
            CustomLandingStatus.cancelled,
        },
        CustomLandingStatus.delivered: set(),
        CustomLandingStatus.cancelled: set(),
    }
    new_status = CustomLandingStatus(payload.status)
    if new_status != order.status and new_status not in allowed[order.status]:
        raise BadRequestError(
            "Недопустимый переход статуса заявки", code="invalid_status_transition"
        )
    before = order.status.value
    order.status = new_status
    _audit(
        session,
        actor_id=admin.id,
        action="custom_landing.status",
        entity_type="custom_landing_order",
        entity_id=order.id,
        tenant_id=order.tenant_id,
        before={"status": before},
        after={"status": new_status.value},
    )
    return {"id": order.id, "status": order.status.value}


@router.patch("/sites/{site_id}/template")
async def update_template(
    site_id: UUID,
    payload: TemplateUpdate,
    admin: PlatformUser = Depends(require_superadmin),
    session: AsyncSession = Depends(superadmin_db, scope="function"),
) -> dict[str, object]:
    site = await session.get(Site, site_id, with_for_update=True)
    if site is None:
        raise NotFoundError("Сайт не найден")
    if payload.templateKey != "default" and payload.templateKey != f"custom-{site.id}":
        raise BadRequestError(
            "Кастомный шаблон должен соответствовать сайту", code="template_tenant_mismatch"
        )
    before = site.template_key
    site.template_key = payload.templateKey
    if payload.orderStatus:
        order = await session.scalar(
            select(CustomLandingOrder)
            .where(CustomLandingOrder.tenant_id == site.id)
            .order_by(desc(CustomLandingOrder.created_at))
            .limit(1)
            .with_for_update()
        )
        if order is None:
            raise NotFoundError("Заявка на кастомный лендинг не найдена")
        order.status = CustomLandingStatus(payload.orderStatus)
    _audit(
        session,
        actor_id=admin.id,
        action="site.template",
        entity_type="site",
        entity_id=site.id,
        tenant_id=site.id,
        before={"templateKey": before},
        after={"templateKey": site.template_key},
    )
    return {"siteId": site.id, "templateKey": site.template_key}


@router.get("/metrics")
async def platform_metrics(
    _admin: PlatformUser = Depends(require_superadmin),
    session: AsyncSession = Depends(superadmin_db, scope="function"),
) -> dict[str, object]:
    now = datetime.now(UTC)
    month_start = datetime(now.year, now.month, 1, tzinfo=UTC)
    return {
        "tenants": int(await session.scalar(select(func.count()).select_from(Site)) or 0),
        "publishedTenants": int(
            await session.scalar(
                select(func.count()).select_from(Site).where(Site.status == SiteStatus.published)
            )
            or 0
        ),
        "clients": int(await session.scalar(select(func.count()).select_from(TenantUser)) or 0),
        "appointmentsThisMonth": int(
            await session.scalar(
                select(func.count())
                .select_from(Appointment)
                .where(Appointment.start_at >= month_start)
            )
            or 0
        ),
        "successfulPaymentsThisMonth": int(
            await session.scalar(
                select(func.count())
                .select_from(Payment)
                .where(
                    Payment.status == PaymentStatus.succeeded,
                    Payment.created_at >= month_start,
                )
            )
            or 0
        ),
    }


@router.get("/plans", response_model=list[PlanView])
async def admin_plans(
    _admin: PlatformUser = Depends(require_superadmin),
    session: AsyncSession = Depends(superadmin_db, scope="function"),
) -> list[PlanView]:
    return [
        PlanView.model_validate(row)
        for row in (await session.scalars(select(Plan).order_by(Plan.price))).all()
    ]


@router.patch("/plans/{plan_id}", response_model=PlanView)
async def update_plan(
    plan_id: UUID,
    payload: PlanUpdate,
    admin: PlatformUser = Depends(require_superadmin),
    session: AsyncSession = Depends(superadmin_db, scope="function"),
) -> PlanView:
    plan = await session.get(Plan, plan_id, with_for_update=True)
    if plan is None:
        raise NotFoundError("Тариф не найден")
    before: dict[str, object] = {
        "name": plan.name,
        "price": str(plan.price),
        "limits": plan.limits,
        "features": plan.features,
    }
    mapping = {"isActive": "is_active"}
    for key, value in payload.model_dump(exclude_unset=True).items():
        setattr(plan, mapping.get(key, key), value)
    _audit(
        session,
        actor_id=admin.id,
        action="plan.update",
        entity_type="plan",
        entity_id=plan.id,
        before=before,
        after=payload.model_dump(exclude_unset=True, mode="json"),
    )
    return PlanView.model_validate(plan)


@router.get("/audit-logs", response_model=Paginated)
async def audit_logs(
    pagination: Pagination = Depends(),
    tenantId: UUID | None = None,
    _admin: PlatformUser = Depends(require_superadmin),
    session: AsyncSession = Depends(superadmin_db, scope="function"),
) -> Paginated:
    filters = [] if tenantId is None else [AuditLog.tenant_id == tenantId]
    total = int(
        await session.scalar(select(func.count()).select_from(AuditLog).where(*filters)) or 0
    )
    rows = (
        await session.scalars(
            select(AuditLog)
            .where(*filters)
            .order_by(AuditLog.created_at.desc())
            .offset((pagination.page - 1) * pagination.limit)
            .limit(pagination.limit)
        )
    ).all()
    return Paginated(
        items=[
            {
                "id": row.id,
                "tenantId": row.tenant_id,
                "actorId": row.actor_id,
                "action": row.action,
                "entityType": row.entity_type,
                "entityId": row.entity_id,
                "before": row.before,
                "after": row.after,
                "requestId": row.request_id,
                "createdAt": row.created_at,
            }
            for row in rows
        ],
        total=total,
        page=pagination.page,
        limit=pagination.limit,
    )
