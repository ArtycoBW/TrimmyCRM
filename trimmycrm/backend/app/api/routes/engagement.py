from __future__ import annotations

from datetime import UTC, date, datetime
from uuid import UUID

from fastapi import APIRouter, Depends, Query, Response, status
from sqlalchemy import delete, func, or_, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import (
    TenantContext,
    actor_tenant_db,
    actor_tenant_id,
    current_tenant_user,
    require_owner,
    tenant_context,
    tenant_db,
)
from app.core.errors import BadRequestError, ConflictError, NotFoundError
from app.models import (
    Appointment,
    AppointmentStatus,
    LoyaltyAccount,
    LoyaltyTransaction,
    LoyaltyTransactionType,
    NotificationPreference,
    PlatformUser,
    Promotion,
    Review,
    ReviewStatus,
    Site,
    TenantUser,
)
from app.schemas import (
    LoyaltyAdjust,
    LoyaltyView,
    NotificationPreferenceUpdate,
    PromotionCreate,
    PromotionUpdate,
    PromotionValidate,
    PromotionView,
    PublicPromotionView,
    PublicReviewView,
    ReviewCreate,
    ReviewModerate,
    ReviewView,
    normalize_promo_code,
)
from app.services.access import plan_access_for_tenant
from app.services.scheduling import parse_timezone

router = APIRouter(tags=["engagement"])


async def _review_view(session: AsyncSession, row: Review) -> ReviewView:
    author = await session.scalar(
        select(TenantUser.full_name).where(TenantUser.id == row.tenant_user_id)
    )
    return ReviewView.model_validate({**row.__dict__, "author_name": author or "Клиент"})


def _public_review_view(row: Review) -> PublicReviewView:
    return PublicReviewView.model_validate({**row.__dict__, "author_name": "Клиент"})


@router.post("/reviews", response_model=ReviewView, status_code=status.HTTP_201_CREATED)
async def create_review(
    payload: ReviewCreate,
    user: TenantUser = Depends(current_tenant_user),
    context: TenantContext = Depends(tenant_context),
    session: AsyncSession = Depends(tenant_db, scope="function"),
) -> ReviewView:
    access = await plan_access_for_tenant(session, context.id)
    access.require("reviews")
    appointment = await session.scalar(
        select(Appointment).where(
            Appointment.id == payload.appointmentId,
            Appointment.tenant_user_id == user.id,
            Appointment.status == AppointmentStatus.completed,
        )
    )
    if appointment is None:
        raise BadRequestError(
            "Отзыв доступен только после завершённого визита", code="review_not_allowed"
        )
    row = Review(
        tenant_id=context.id,
        tenant_user_id=user.id,
        appointment_id=appointment.id,
        rating=payload.rating,
        text=payload.text,
        status=ReviewStatus.pending,
    )
    session.add(row)
    try:
        await session.flush()
    except IntegrityError as exc:
        raise ConflictError("Отзыв на этот визит уже оставлен", code="review_exists") from exc
    return await _review_view(session, row)


@router.get("/public/reviews", response_model=list[PublicReviewView])
async def public_reviews(
    context: TenantContext = Depends(tenant_context),
    session: AsyncSession = Depends(tenant_db, scope="function"),
) -> list[PublicReviewView]:
    (await plan_access_for_tenant(session, context.id)).require("reviews")
    rows = (
        await session.scalars(
            select(Review)
            .where(Review.tenant_id == context.id, Review.status == ReviewStatus.published)
            .order_by(Review.created_at.desc())
            .limit(100)
        )
    ).all()
    return [_public_review_view(row) for row in rows]


@router.get("/admin/reviews", response_model=list[ReviewView])
async def admin_reviews(
    limit: int = Query(default=200, ge=1, le=500),
    _owner: PlatformUser = Depends(require_owner),
    tenant_id: UUID = Depends(actor_tenant_id),
    session: AsyncSession = Depends(actor_tenant_db, scope="function"),
) -> list[ReviewView]:
    (await plan_access_for_tenant(session, tenant_id)).require("reviews")
    rows = (
        await session.execute(
            select(Review, TenantUser.full_name)
            .join(
                TenantUser,
                (TenantUser.tenant_id == Review.tenant_id)
                & (TenantUser.id == Review.tenant_user_id),
            )
            .where(Review.tenant_id == tenant_id)
            .order_by(Review.created_at.desc())
            .limit(limit)
        )
    ).all()
    return [
        ReviewView.model_validate({**row.__dict__, "author_name": author_name or "Клиент"})
        for row, author_name in rows
    ]


@router.patch("/admin/reviews/{review_id}", response_model=ReviewView)
async def moderate_review(
    review_id: UUID,
    payload: ReviewModerate,
    _owner: PlatformUser = Depends(require_owner),
    tenant_id: UUID = Depends(actor_tenant_id),
    session: AsyncSession = Depends(actor_tenant_db, scope="function"),
) -> ReviewView:
    (await plan_access_for_tenant(session, tenant_id)).require("reviews")
    row = await session.scalar(
        select(Review).where(Review.tenant_id == tenant_id, Review.id == review_id)
    )
    if row is None:
        raise NotFoundError("Отзыв не найден")
    row.status = ReviewStatus(payload.status)
    row.moderated_at = datetime.now(UTC)
    return await _review_view(session, row)


def _promotion_view(row: Promotion) -> PromotionView:
    return PromotionView.model_validate(row)


def _public_promotion_view(row: Promotion) -> PublicPromotionView:
    return PublicPromotionView.model_validate(row)


async def _salon_today(session: AsyncSession, tenant_id: UUID) -> date:
    timezone = await session.scalar(select(Site.timezone).where(Site.id == tenant_id))
    return datetime.now(parse_timezone(timezone or "Europe/Moscow")).date()


@router.get("/public/promotions", response_model=list[PublicPromotionView])
async def public_promotions(
    limit: int = Query(default=6, ge=1, le=30),
    context: TenantContext = Depends(tenant_context),
    session: AsyncSession = Depends(tenant_db, scope="function"),
) -> list[PublicPromotionView]:
    (await plan_access_for_tenant(session, context.id)).require("promotions")
    today = await _salon_today(session, context.id)
    rows = (
        await session.scalars(
            select(Promotion)
            .where(
                Promotion.tenant_id == context.id,
                Promotion.is_active.is_(True),
                Promotion.title.is_not(None),
                Promotion.discount_percent.is_not(None),
                or_(Promotion.valid_from.is_(None), Promotion.valid_from <= today),
                or_(Promotion.valid_to.is_(None), Promotion.valid_to >= today),
                or_(Promotion.max_uses.is_(None), Promotion.used_count < Promotion.max_uses),
            )
            .order_by(
                Promotion.valid_to.asc().nulls_last(),
                Promotion.created_at.desc(),
                Promotion.id,
            )
            .limit(limit)
        )
    ).all()
    return [_public_promotion_view(row) for row in rows]


@router.get("/promotions", response_model=list[PromotionView])
async def promotions(
    limit: int = Query(default=200, ge=1, le=500),
    _owner: PlatformUser = Depends(require_owner),
    tenant_id: UUID = Depends(actor_tenant_id),
    session: AsyncSession = Depends(actor_tenant_db, scope="function"),
) -> list[PromotionView]:
    access = await plan_access_for_tenant(session, tenant_id)
    access.require("promotions")
    rows = (
        await session.scalars(
            select(Promotion)
            .where(Promotion.tenant_id == tenant_id)
            .order_by(Promotion.created_at.desc())
            .limit(limit)
        )
    ).all()
    return [_promotion_view(row) for row in rows]


@router.post("/promotions", response_model=PromotionView, status_code=status.HTTP_201_CREATED)
async def create_promotion(
    payload: PromotionCreate,
    _owner: PlatformUser = Depends(require_owner),
    tenant_id: UUID = Depends(actor_tenant_id),
    session: AsyncSession = Depends(actor_tenant_db, scope="function"),
) -> PromotionView:
    access = await plan_access_for_tenant(session, tenant_id)
    access.require("promotions")
    row = Promotion(
        tenant_id=tenant_id,
        title=payload.title,
        description=payload.description,
        discount_percent=payload.discountPercent,
        promo_code=normalize_promo_code(payload.promoCode) if payload.promoCode else None,
        valid_from=payload.validFrom,
        valid_to=payload.validTo,
        max_uses=payload.maxUses,
        is_active=payload.isActive,
    )
    session.add(row)
    try:
        await session.flush()
    except IntegrityError as exc:
        raise ConflictError("Промокод уже существует", code="promo_code_exists") from exc
    return _promotion_view(row)


@router.patch("/promotions/{promotion_id}", response_model=PromotionView)
async def update_promotion(
    promotion_id: UUID,
    payload: PromotionUpdate,
    _owner: PlatformUser = Depends(require_owner),
    tenant_id: UUID = Depends(actor_tenant_id),
    session: AsyncSession = Depends(actor_tenant_db, scope="function"),
) -> PromotionView:
    (await plan_access_for_tenant(session, tenant_id)).require("promotions")
    row = await session.scalar(
        select(Promotion).where(Promotion.tenant_id == tenant_id, Promotion.id == promotion_id)
    )
    if row is None:
        raise NotFoundError("Акция не найдена")
    mapping = {
        "discountPercent": "discount_percent",
        "promoCode": "promo_code",
        "validFrom": "valid_from",
        "validTo": "valid_to",
        "maxUses": "max_uses",
        "isActive": "is_active",
    }
    for key, value in payload.model_dump(exclude_unset=True).items():
        if key == "promoCode" and value:
            value = normalize_promo_code(value)
        setattr(row, mapping.get(key, key), value)
    try:
        await session.flush()
    except IntegrityError as exc:
        raise ConflictError("Промокод уже существует", code="promo_code_exists") from exc
    await session.refresh(row)
    return _promotion_view(row)


@router.delete("/promotions/{promotion_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_promotion(
    promotion_id: UUID,
    _owner: PlatformUser = Depends(require_owner),
    tenant_id: UUID = Depends(actor_tenant_id),
    session: AsyncSession = Depends(actor_tenant_db, scope="function"),
) -> Response:
    (await plan_access_for_tenant(session, tenant_id)).require("promotions")
    deleted_id = await session.scalar(
        delete(Promotion)
        .where(Promotion.tenant_id == tenant_id, Promotion.id == promotion_id)
        .returning(Promotion.id)
    )
    if deleted_id is None:
        raise NotFoundError("Акция не найдена")
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.post("/promotions/validate")
async def validate_promotion(
    payload: PromotionValidate,
    context: TenantContext = Depends(tenant_context),
    session: AsyncSession = Depends(tenant_db, scope="function"),
) -> dict[str, object]:
    access = await plan_access_for_tenant(session, context.id)
    access.require("promotions")
    code = normalize_promo_code(payload.promoCode)
    row = await session.scalar(
        select(Promotion).where(
            Promotion.tenant_id == context.id,
            Promotion.promo_code == code,
            Promotion.is_active.is_(True),
        )
    )
    today = await _salon_today(session, context.id)
    valid = bool(
        row
        and (row.valid_from is None or row.valid_from <= today)
        and (row.valid_to is None or row.valid_to >= today)
        and (row.max_uses is None or row.used_count < row.max_uses)
    )
    return {
        "valid": valid,
        "discountPercent": row.discount_percent if valid and row else None,
        "title": row.title if valid and row else None,
    }


async def _loyalty_view(session: AsyncSession, account: LoyaltyAccount) -> LoyaltyView:
    spent = int(
        -(
            await session.scalar(
                select(func.coalesce(func.sum(LoyaltyTransaction.points_delta), 0)).where(
                    LoyaltyTransaction.account_id == account.id,
                    LoyaltyTransaction.points_delta < 0,
                )
            )
            or 0
        )
    )
    return LoyaltyView(
        balance=account.points_balance,
        lifetimeEarned=account.lifetime_earned,
        lifetimeSpent=spent,
    )


@router.get("/loyalty/mine", response_model=LoyaltyView)
async def my_loyalty(
    user: TenantUser = Depends(current_tenant_user),
    context: TenantContext = Depends(tenant_context),
    session: AsyncSession = Depends(tenant_db, scope="function"),
) -> LoyaltyView:
    access = await plan_access_for_tenant(session, context.id)
    access.require("loyalty")
    account = await session.scalar(
        select(LoyaltyAccount).where(LoyaltyAccount.tenant_user_id == user.id)
    )
    if account is None:
        account = LoyaltyAccount(tenant_id=context.id, tenant_user_id=user.id)
        session.add(account)
        await session.flush()
    return await _loyalty_view(session, account)


@router.post("/loyalty/adjust", response_model=LoyaltyView)
async def adjust_loyalty(
    payload: LoyaltyAdjust,
    _owner: PlatformUser = Depends(require_owner),
    tenant_id: UUID = Depends(actor_tenant_id),
    session: AsyncSession = Depends(actor_tenant_db, scope="function"),
) -> LoyaltyView:
    access = await plan_access_for_tenant(session, tenant_id)
    access.require("loyalty")
    account = await session.scalar(
        select(LoyaltyAccount)
        .where(LoyaltyAccount.tenant_user_id == payload.tenantUserId)
        .with_for_update()
    )
    if account is None:
        if not await session.scalar(
            select(TenantUser.id).where(TenantUser.id == payload.tenantUserId)
        ):
            raise NotFoundError("Клиент не найден")
        account = LoyaltyAccount(tenant_id=tenant_id, tenant_user_id=payload.tenantUserId)
        session.add(account)
        await session.flush()
    new_balance = account.points_balance + payload.points
    if new_balance < 0:
        raise ConflictError("Недостаточно баллов", code="insufficient_loyalty_points")
    account.points_balance = new_balance
    if payload.points > 0:
        account.lifetime_earned += payload.points
    session.add(
        LoyaltyTransaction(
            tenant_id=tenant_id,
            account_id=account.id,
            type=LoyaltyTransactionType.adjustment,
            points_delta=payload.points,
            balance_after=new_balance,
            reason=payload.reason,
        )
    )
    return await _loyalty_view(session, account)


@router.get("/notification-preferences")
async def notification_preferences(
    user: TenantUser = Depends(current_tenant_user),
    context: TenantContext = Depends(tenant_context),
    session: AsyncSession = Depends(tenant_db, scope="function"),
) -> dict[str, object]:
    row = await session.scalar(
        select(NotificationPreference).where(NotificationPreference.tenant_user_id == user.id)
    )
    if row is None:
        row = NotificationPreference(tenant_id=context.id, tenant_user_id=user.id)
        session.add(row)
        await session.flush()
    return {
        "emailEnabled": row.email_enabled,
        "smsEnabled": row.sms_enabled,
        "telegramEnabled": row.telegram_enabled,
        "reminderHours": row.reminder_hours,
        "telegramChatId": row.telegram_chat_id,
    }


@router.patch("/notification-preferences")
async def update_notification_preferences(
    payload: NotificationPreferenceUpdate,
    user: TenantUser = Depends(current_tenant_user),
    context: TenantContext = Depends(tenant_context),
    session: AsyncSession = Depends(tenant_db, scope="function"),
) -> dict[str, object]:
    access = await plan_access_for_tenant(session, context.id)
    if payload.smsEnabled:
        access.require("sms")
    if payload.telegramEnabled:
        access.require("telegram")
    row = await session.scalar(
        select(NotificationPreference).where(NotificationPreference.tenant_user_id == user.id)
    )
    if row is None:
        row = NotificationPreference(tenant_id=context.id, tenant_user_id=user.id)
        session.add(row)
    values = payload.model_dump(exclude_unset=True)
    mapping = {
        "emailEnabled": "email_enabled",
        "smsEnabled": "sms_enabled",
        "telegramEnabled": "telegram_enabled",
        "reminderHours": "reminder_hours",
        "telegramChatId": "telegram_chat_id",
    }
    for key, value in values.items():
        setattr(row, mapping[key], value)
    await session.flush()
    return await notification_preferences(user, context, session)
