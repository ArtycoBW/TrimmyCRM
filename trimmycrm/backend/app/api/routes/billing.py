from __future__ import annotations

import logging
from datetime import UTC, datetime, timedelta
from decimal import Decimal
from typing import cast
from uuid import UUID

from fastapi import APIRouter, Depends, Query, Request
from sqlalchemy import desc, or_, select, text
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.sql.elements import ColumnElement

from app.api.deps import (
    TenantContext,
    actor_tenant_id,
    current_tenant_user,
    platform_db,
    require_owner,
    settings_dep,
    tenant_context,
    tenant_db,
)
from app.core.config import Settings
from app.core.errors import (
    BadRequestError,
    ConflictError,
    NotFoundError,
    ServiceUnavailableError,
)
from app.core.security import client_ip_from_request
from app.db.session import AdminSession
from app.integrations.payments import (
    InvalidPaymentNotification,
    PaymentGateway,
    PaymentProviderError,
    PaymentRequest,
)
from app.integrations.payments import (
    Payment as ProviderPayment,
)
from app.integrations.payments import (
    PaymentStatus as ProviderPaymentStatus,
)
from app.models import (
    Appointment,
    AppointmentStatus,
    BillingPeriod,
    CustomLandingOrder,
    CustomLandingStatus,
    Notification,
    NotificationChannel,
    NotificationStatus,
    NotificationTargetType,
    Payment,
    PaymentPurpose,
    PaymentStatus,
    Plan,
    PlatformRole,
    PlatformUser,
    PlatformUserStatus,
    Site,
    Subscription,
    SubscriptionStatus,
    TenantUser,
    WebhookEvent,
    WebhookEventStatus,
)
from app.schemas import (
    CheckoutResponse,
    CustomLandingRequest,
    Message,
    PaymentView,
    PlanView,
    PrepaymentRequest,
    SubscribeRequest,
    SubscriptionView,
)
from app.services.access import plan_access_for_tenant

router = APIRouter(tags=["billing"])
logger = logging.getLogger(__name__)

_CONFIRMATION_URL_KEY = "confirmationUrl"


def _provider_name(request: Request) -> str:
    return "yookassa" if request.app.state.settings.payment_provider == "yookassa" else "mock"


async def _billing_lock(session: AsyncSession, key: str) -> None:
    """Сериализовать создание одной оплаты, не удерживая блокировку во время ввода-вывода."""

    await session.execute(
        text("SELECT pg_advisory_xact_lock(hashtextextended(:key, 3))"),
        {"key": key},
    )


def _saved_confirmation_url(payment: Payment) -> str | None:
    value = payment.provider_payload.get(_CONFIRMATION_URL_KEY)
    return value if isinstance(value, str) and value else None


def _record_provider_result(local: Payment, provider: ProviderPayment) -> None:
    """Объединить состояние провайдера, сохранив доверенные локальные бизнес-метаданные."""

    merged = {**dict(provider.raw), **dict(local.provider_payload)}
    merged["providerMetadata"] = dict(provider.metadata)
    if provider.confirmation_url:
        merged[_CONFIRMATION_URL_KEY] = provider.confirmation_url
    local.provider_payload = merged
    local.provider_payment_id = provider.id


async def _persist_provider_result(
    payment_id: UUID,
    provider: ProviderPayment,
) -> tuple[str | None, UUID | None]:
    """Сохранить идентификатор провайдера отдельно от уже зафиксированного намерения.

    Если транзакция завершится ошибкой, доверенный вебхук провайдера сможет
    восстановить связь через ``metadata.local_payment_id``.
    """

    owner_to_invalidate: UUID | None = None
    try:
        async with AdminSession() as session:
            async with session.begin():
                local = await session.scalar(
                    select(Payment).where(Payment.id == payment_id).with_for_update()
                )
                if local is None:
                    raise RuntimeError("durable local payment disappeared")
                if provider.amount != local.amount or provider.currency != local.currency:
                    raise RuntimeError("provider returned a mismatched payment")
                if (
                    local.provider_payment_id is not None
                    and local.provider_payment_id != provider.id
                ):
                    raise RuntimeError(
                        "local payment is already linked to another provider payment"
                    )
                if not _provider_metadata_matches_local(local, provider):
                    raise RuntimeError("provider returned mismatched payment metadata")
                _record_provider_result(local, provider)
                if provider.status is ProviderPaymentStatus.SUCCEEDED and provider.paid:
                    if local.status is not PaymentStatus.succeeded:
                        owner_to_invalidate = await _process_succeeded_payment(
                            session, local, provider
                        )
                elif (
                    provider.status is ProviderPaymentStatus.CANCELED
                    and local.status is not PaymentStatus.succeeded
                ):
                    local.status = PaymentStatus.canceled
    except Exception as exc:
        logger.exception(
            "Failed to persist interactive payment provider result",
            extra={"payment_id": str(payment_id), "provider_payment_id": provider.id},
        )
        raise ServiceUnavailableError(
            "Платёж создан, но подтверждение пока не синхронизировано. Повторите запрос.",
            code="payment_state_sync_failed",
        ) from exc

    return provider.confirmation_url, owner_to_invalidate


async def _invalidate_owner_site(request: Request, owner_id: UUID) -> None:
    """Сбросить кэш прав хоста после изменения состояния подписки."""

    try:
        async with AdminSession() as session:
            site = await session.scalar(select(Site).where(Site.owner_id == owner_id))
        if site is None:
            return
        settings = request.app.state.settings
        hosts = [f"{site.slug}.{base_domain}" for base_domain in settings.tenant_base_domains]
        if site.custom_domain:
            hosts.append(str(site.custom_domain).lower())
        await request.app.state.tenant_resolver.invalidate(*hosts)
    except Exception:  # noqa: BLE001 - инвалидация кэша выполняется по возможности
        logger.exception(
            "Failed to invalidate tenant host cache after billing update",
            extra={"owner_id": str(owner_id)},
        )


async def _reconcile_provider_linked_pending(
    request: Request,
    *,
    owner_id: UUID | None = None,
    tenant_id: UUID | None = None,
    appointment_id: UUID | None = None,
) -> None:
    """Восстановить конечное состояние провайдера при задержке или потере вебхука."""

    query = select(Payment).where(
        Payment.provider == _provider_name(request),
        Payment.status == PaymentStatus.pending,
        Payment.provider_payment_id.is_not(None),
    )
    if owner_id is not None:
        query = query.join(Subscription, Subscription.id == Payment.subscription_id).where(
            Subscription.owner_id == owner_id
        )
    if tenant_id is not None:
        query = query.where(Payment.tenant_id == tenant_id)
    if appointment_id is not None:
        query = query.where(Payment.appointment_id == appointment_id)
    async with AdminSession() as session:
        pending = list(await session.scalars(query.order_by(Payment.created_at).limit(20)))
    for local in pending:
        if local.provider_payment_id is None:
            continue
        try:
            provider = await _gateway(request).get_payment(local.provider_payment_id)
            _confirmation, changed_owner = await _persist_provider_result(local.id, provider)
            if changed_owner is not None:
                await _invalidate_owner_site(request, changed_owner)
        except (PaymentProviderError, ServiceUnavailableError):
            # Доверенная проверка повторится при следующей оплате или вебхуке;
            # текущее намерение остаётся безопасным состоянием с запретом доступа.
            continue


async def _interactive_checkout(
    *,
    request: Request,
    payment_id: UUID,
    payment_request: PaymentRequest,
    saved_confirmation_url: str | None,
    provider_payment_id: str | None,
) -> CheckoutResponse:
    if provider_payment_id:
        try:
            provider = await _gateway(request).get_payment(provider_payment_id)
        except PaymentProviderError as exc:
            if saved_confirmation_url:
                return CheckoutResponse(
                    paymentId=payment_id,
                    confirmationUrl=saved_confirmation_url,
                )
            raise ServiceUnavailableError(
                "Платёжный провайдер временно недоступен",
                code="payment_provider_unavailable",
            ) from exc
        confirmation_url, owner_to_invalidate = await _persist_provider_result(payment_id, provider)
        if owner_to_invalidate is not None:
            await _invalidate_owner_site(request, owner_to_invalidate)
        if provider.status is ProviderPaymentStatus.CANCELED:
            raise ConflictError(
                "Предыдущая платёжная сессия отменена; повторите оформление",
                code="payment_session_canceled",
            )
        redirect_url = confirmation_url or saved_confirmation_url
        if provider.status is ProviderPaymentStatus.SUCCEEDED and provider.paid:
            redirect_url = redirect_url or payment_request.return_url
        if redirect_url:
            return CheckoutResponse(
                paymentId=payment_id,
                confirmationUrl=str(redirect_url),
            )
        raise ServiceUnavailableError(
            "Платёжный провайдер не вернул ссылку на оплату",
            code="payment_confirmation_missing",
        )
    try:
        provider = await _gateway(request).create_payment(
            payment_request,
            idempotence_key=str(payment_id),
        )
    except PaymentProviderError as exc:
        raise ServiceUnavailableError(
            "Платёжный провайдер временно недоступен",
            code="payment_provider_unavailable",
        ) from exc
    confirmation_url, owner_to_invalidate = await _persist_provider_result(payment_id, provider)
    if owner_to_invalidate is not None:
        await _invalidate_owner_site(request, owner_to_invalidate)
    if provider.status is ProviderPaymentStatus.CANCELED:
        raise ConflictError(
            "Платёжная сессия отменена; повторите оформление",
            code="payment_session_canceled",
        )
    if provider.status is ProviderPaymentStatus.SUCCEEDED and provider.paid:
        confirmation_url = confirmation_url or payment_request.return_url
    if not confirmation_url:
        raise ServiceUnavailableError(
            "Платёжный провайдер не вернул ссылку на оплату",
            code="payment_confirmation_missing",
        )
    return CheckoutResponse(paymentId=payment_id, confirmationUrl=confirmation_url)


def _gateway(request: Request) -> PaymentGateway:
    return cast(PaymentGateway, request.app.state.payment_gateway)


async def _subscription_row(
    session: AsyncSession, owner_id: UUID, *, lock: bool = False
) -> tuple[Subscription, Plan]:
    query = (
        select(Subscription, Plan)
        .join(Plan, Plan.id == Subscription.plan_id)
        .where(Subscription.owner_id == owner_id)
        .order_by(desc(Subscription.created_at))
        .limit(1)
    )
    if lock:
        query = query.with_for_update()
    row = (await session.execute(query)).one_or_none()
    if row is None:
        raise NotFoundError("Подписка не найдена")
    return row[0], row[1]


def _subscription_view(subscription: Subscription, plan: Plan) -> SubscriptionView:
    return SubscriptionView.model_validate(
        {
            **subscription.__dict__,
            "grace_until": subscription.grace_period_end,
            "plan": plan,
        }
    )


@router.get("/plans", response_model=list[PlanView])
async def plans(session: AsyncSession = Depends(platform_db, scope="function")) -> list[PlanView]:
    rows = (
        await session.scalars(select(Plan).where(Plan.is_active.is_(True)).order_by(Plan.price))
    ).all()
    return [PlanView.model_validate(row) for row in rows]


@router.get("/billing/subscription", response_model=SubscriptionView)
async def subscription(
    owner: PlatformUser = Depends(require_owner),
    session: AsyncSession = Depends(platform_db, scope="function"),
) -> SubscriptionView:
    sub, plan = await _subscription_row(session, owner.id)
    return _subscription_view(sub, plan)


@router.post("/billing/subscribe", response_model=CheckoutResponse)
async def subscribe(
    payload: SubscribeRequest,
    request: Request,
    owner: PlatformUser = Depends(require_owner),
) -> CheckoutResponse:
    await _reconcile_provider_linked_pending(request, owner_id=owner.id)
    provider_name = _provider_name(request)
    async with AdminSession() as durable_session:
        async with durable_session.begin():
            await _billing_lock(durable_session, f"subscription-checkout:{owner.id}")
            target = await durable_session.scalar(
                select(Plan).where(Plan.id == payload.planId, Plan.is_active.is_(True))
            )
            if target is None:
                raise NotFoundError("Тариф не найден")
            if target.price <= 0:
                raise BadRequestError(
                    "Этот тариф нельзя оплатить онлайн",
                    code="plan_not_billable",
                )
            sub, current = await _subscription_row(durable_session, owner.id, lock=True)
            now = datetime.now(UTC)
            if (
                current.id == target.id
                and sub.status is SubscriptionStatus.active
                and (sub.current_period_end is None or sub.current_period_end > now)
            ):
                raise ConflictError(
                    "Этот тариф уже активен",
                    code="plan_already_active",
                )
            pending = list(
                await durable_session.scalars(
                    select(Payment)
                    .where(
                        Payment.subscription_id == sub.id,
                        Payment.purpose == PaymentPurpose.subscription,
                        Payment.status == PaymentStatus.pending,
                    )
                    .order_by(Payment.created_at.desc())
                    .with_for_update()
                )
            )
            payment = next(
                (
                    item
                    for item in pending
                    if item.provider == provider_name
                    and item.amount == target.price
                    and item.provider_payload.get("targetPlanId") == str(target.id)
                ),
                None,
            )
            if payment is None and pending:
                raise ConflictError(
                    "Уже существует незавершённая оплата подписки",
                    code="subscription_payment_pending",
                )
            if payment is None:
                payment = Payment(
                    tenant_id=None,
                    subscription_id=sub.id,
                    purpose=PaymentPurpose.subscription,
                    amount=target.price,
                    currency="RUB",
                    provider=provider_name,
                    status=PaymentStatus.pending,
                    provider_payload={"targetPlanId": str(target.id)},
                )
                durable_session.add(payment)
                await durable_session.flush()
            payment_id = payment.id
            saved_confirmation_url = _saved_confirmation_url(payment)
            provider_payment_id = payment.provider_payment_id
            payment_request = PaymentRequest(
                amount=payment.amount,
                description=f"Подписка TrimmyCRM: {target.name}",
                return_url=str(payload.returnUrl),
                save_payment_method=True,
                metadata={
                    "local_payment_id": str(payment.id),
                    "purpose": "subscription",
                    "target_plan_id": str(target.id),
                },
            )

    return await _interactive_checkout(
        request=request,
        payment_id=payment_id,
        payment_request=payment_request,
        saved_confirmation_url=saved_confirmation_url,
        provider_payment_id=provider_payment_id,
    )


@router.post("/billing/cancel", response_model=Message)
async def cancel_subscription(
    owner: PlatformUser = Depends(require_owner),
    session: AsyncSession = Depends(platform_db, scope="function"),
) -> Message:
    sub, _plan = await _subscription_row(session, owner.id, lock=True)
    if sub.status in {SubscriptionStatus.expired, SubscriptionStatus.canceled}:
        return Message(message="Автопродление уже отключено")
    sub.auto_renew = False
    sub.status = SubscriptionStatus.canceled
    sub.canceled_at = datetime.now(UTC)
    return Message(message="Автопродление отключено; тариф действует до конца периода")


@router.post("/billing/custom-landing", response_model=CheckoutResponse)
async def custom_landing(
    payload: CustomLandingRequest,
    request: Request,
    owner: PlatformUser = Depends(require_owner),
    tenant_id: UUID = Depends(actor_tenant_id),
) -> CheckoutResponse:
    provider_name = _provider_name(request)
    async with AdminSession() as durable_session:
        async with durable_session.begin():
            await _billing_lock(durable_session, f"custom-landing-checkout:{tenant_id}")
            owned_site = await durable_session.scalar(
                select(Site.id).where(
                    Site.id == tenant_id,
                    Site.owner_id == owner.id,
                )
            )
            if owned_site is None:
                raise NotFoundError("Салон владельца не найден", code="tenant_membership_missing")
            active_orders = list(
                await durable_session.scalars(
                    select(CustomLandingOrder)
                    .where(
                        CustomLandingOrder.tenant_id == tenant_id,
                        CustomLandingOrder.status.in_(
                            [
                                CustomLandingStatus.requested,
                                CustomLandingStatus.paid,
                                CustomLandingStatus.in_progress,
                            ]
                        ),
                    )
                    .order_by(CustomLandingOrder.created_at.desc())
                    .with_for_update()
                )
            )
            if active_orders and (
                len(active_orders) != 1
                or active_orders[0].status is not CustomLandingStatus.requested
                or active_orders[0].contact != payload.contact
                or active_orders[0].notes != payload.notes
            ):
                raise ConflictError(
                    "Активная заявка уже существует",
                    code="custom_landing_exists",
                )
            if active_orders:
                order = active_orders[0]
            else:
                order = CustomLandingOrder(
                    tenant_id=tenant_id,
                    status=CustomLandingStatus.requested,
                    price=Decimal("20000.00"),
                    contact=payload.contact,
                    notes=payload.notes,
                )
                durable_session.add(order)
                await durable_session.flush()

            pending = list(
                await durable_session.scalars(
                    select(Payment)
                    .where(
                        Payment.tenant_id == tenant_id,
                        Payment.custom_landing_order_id == order.id,
                        Payment.purpose == PaymentPurpose.custom_landing,
                        Payment.status == PaymentStatus.pending,
                    )
                    .order_by(Payment.created_at.desc())
                    .with_for_update()
                )
            )
            payment = next(
                (
                    item
                    for item in pending
                    if item.provider == provider_name and item.amount == order.price
                ),
                None,
            )
            if payment is None and pending:
                raise ConflictError(
                    "У заявки уже существует незавершённая оплата",
                    code="custom_landing_payment_pending",
                )
            if payment is None:
                payment = Payment(
                    tenant_id=tenant_id,
                    custom_landing_order_id=order.id,
                    purpose=PaymentPurpose.custom_landing,
                    amount=order.price,
                    provider=provider_name,
                    status=PaymentStatus.pending,
                )
                durable_session.add(payment)
                await durable_session.flush()
            payment_id = payment.id
            saved_confirmation_url = _saved_confirmation_url(payment)
            provider_payment_id = payment.provider_payment_id
            payment_request = PaymentRequest(
                amount=payment.amount,
                description="Индивидуальный лендинг TrimmyCRM",
                return_url=str(payload.returnUrl),
                metadata={
                    "local_payment_id": str(payment.id),
                    "purpose": "custom_landing",
                    "order_id": str(order.id),
                },
            )

    return await _interactive_checkout(
        request=request,
        payment_id=payment_id,
        payment_request=payment_request,
        saved_confirmation_url=saved_confirmation_url,
        provider_payment_id=provider_payment_id,
    )


@router.post("/billing/appointments/{appointment_id}/prepayment", response_model=CheckoutResponse)
async def prepay_appointment(
    appointment_id: UUID,
    payload: PrepaymentRequest,
    request: Request,
    user: TenantUser = Depends(current_tenant_user),
    context: TenantContext = Depends(tenant_context),
    session: AsyncSession = Depends(tenant_db, scope="function"),
) -> CheckoutResponse:
    access = await plan_access_for_tenant(session, context.id)
    access.require("prepayments")
    await _reconcile_provider_linked_pending(
        request,
        tenant_id=context.id,
        appointment_id=appointment_id,
    )
    provider_name = _provider_name(request)
    async with AdminSession() as durable_session:
        async with durable_session.begin():
            await _billing_lock(
                durable_session,
                f"appointment-prepayment-checkout:{context.id}:{appointment_id}",
            )
            appointment = await durable_session.scalar(
                select(Appointment)
                .where(
                    Appointment.id == appointment_id,
                    Appointment.tenant_id == context.id,
                    Appointment.tenant_user_id == user.id,
                )
                .with_for_update()
            )
            if appointment is None:
                raise NotFoundError("Запись не найдена")
            if appointment.prepaid:
                raise ConflictError("Предоплата уже внесена", code="already_prepaid")
            if appointment.status not in {
                AppointmentStatus.new,
                AppointmentStatus.confirmed,
            } or appointment.start_at <= datetime.now(UTC):
                raise ConflictError(
                    "Эту запись уже нельзя предоплатить",
                    code="appointment_not_payable",
                )
            amount = payload.amount or appointment.price
            if (
                amount is None
                or amount <= 0
                or (appointment.price is not None and amount > appointment.price)
            ):
                raise BadRequestError(
                    "Некорректная сумма предоплаты",
                    code="invalid_prepayment_amount",
                )
            pending = list(
                await durable_session.scalars(
                    select(Payment)
                    .where(
                        Payment.tenant_id == context.id,
                        Payment.appointment_id == appointment.id,
                        Payment.purpose == PaymentPurpose.prepayment,
                        Payment.status == PaymentStatus.pending,
                    )
                    .order_by(Payment.created_at.desc())
                    .with_for_update()
                )
            )
            payment = next(
                (
                    item
                    for item in pending
                    if item.provider == provider_name and item.amount == amount
                ),
                None,
            )
            if payment is None and pending:
                raise ConflictError(
                    "Для записи уже существует незавершённая предоплата",
                    code="prepayment_pending",
                )
            if payment is None:
                payment = Payment(
                    tenant_id=context.id,
                    appointment_id=appointment.id,
                    purpose=PaymentPurpose.prepayment,
                    amount=amount,
                    provider=provider_name,
                    status=PaymentStatus.pending,
                )
                durable_session.add(payment)
                await durable_session.flush()
            payment_id = payment.id
            saved_confirmation_url = _saved_confirmation_url(payment)
            provider_payment_id = payment.provider_payment_id
            payment_request = PaymentRequest(
                amount=payment.amount,
                description="Предоплата записи в салон",
                return_url=str(payload.returnUrl),
                metadata={
                    "local_payment_id": str(payment.id),
                    "purpose": "prepayment",
                    "appointment_id": str(appointment.id),
                },
            )

    return await _interactive_checkout(
        request=request,
        payment_id=payment_id,
        payment_request=payment_request,
        saved_confirmation_url=saved_confirmation_url,
        provider_payment_id=provider_payment_id,
    )


@router.get("/billing/invoices", response_model=list[PaymentView])
async def invoices(
    limit: int = Query(default=100, ge=1, le=500),
    owner: PlatformUser = Depends(require_owner),
    session: AsyncSession = Depends(platform_db, scope="function"),
) -> list[PaymentView]:
    subscriptions = list(
        await session.scalars(select(Subscription.id).where(Subscription.owner_id == owner.id))
    )
    tenant_id = await session.scalar(select(Site.id).where(Site.owner_id == owner.id))
    payment_scope: list[ColumnElement[bool]] = [Payment.subscription_id.in_(subscriptions)]
    if tenant_id is not None:
        payment_scope.append(Payment.tenant_id == tenant_id)
    async with AdminSession() as admin_session:
        rows = (
            await admin_session.scalars(
                select(Payment)
                .where(or_(*payment_scope))
                .order_by(Payment.created_at.desc())
                .limit(limit)
            )
        ).all()
    return [PaymentView.model_validate(row) for row in rows]


def _period_delta(plan: Plan) -> timedelta:
    # Календарный биллинг можно добавить без изменения API; в этой минимальной
    # версии используется фиксированный период из исходной спецификации.
    return timedelta(days=365 if plan.period is BillingPeriod.year else 30)


async def _process_succeeded_payment(
    session: AsyncSession, local: Payment, provider_payment: ProviderPayment
) -> UUID | None:
    now = datetime.now(UTC)
    local.status = PaymentStatus.succeeded
    local.paid_at = now
    local.payment_method_id = getattr(provider_payment, "payment_method_id", None)
    if local.purpose is PaymentPurpose.subscription:
        if local.subscription_id is None:
            raise ConflictError("Платёж не связан с подпиской", code="payment_relation_missing")
        subscription = await session.get(Subscription, local.subscription_id, with_for_update=True)
        target_id = local.provider_payload.get("targetPlanId")
        target = await session.get(Plan, UUID(str(target_id))) if target_id else None
        if subscription is None or target is None:
            raise ConflictError("Подписка или тариф не найдены", code="payment_relation_missing")
        subscription.plan_id = target.id
        subscription.status = SubscriptionStatus.active
        subscription.current_period_start = now
        subscription.current_period_end = now + _period_delta(target)
        subscription.auto_renew = True
        subscription.dunning_attempts = 0
        subscription.next_dunning_at = None
        subscription.grace_period_end = None
        subscription.canceled_at = None
        if local.payment_method_id:
            subscription.payment_method_id = local.payment_method_id
        return subscription.owner_id
    elif local.purpose is PaymentPurpose.custom_landing:
        if local.custom_landing_order_id is None:
            raise ConflictError("Платёж не связан с заявкой", code="payment_relation_missing")
        order = await session.get(
            CustomLandingOrder,
            local.custom_landing_order_id,
            with_for_update=True,
        )
        if order is None:
            raise ConflictError("Заявка не найдена", code="payment_relation_missing")
        order.status = CustomLandingStatus.paid
        superadmin_ids = list(
            await session.scalars(
                select(PlatformUser.id).where(
                    PlatformUser.role == PlatformRole.superadmin,
                    PlatformUser.status == PlatformUserStatus.active,
                )
            )
        )
        session.add_all(
            [
                Notification(
                    tenant_id=None,
                    target_type=NotificationTargetType.platform_user,
                    target_id=admin_id,
                    channel=NotificationChannel.email,
                    template="custom_landing_paid",
                    payload={
                        "orderId": str(order.id),
                        "tenantId": str(order.tenant_id),
                    },
                    status=NotificationStatus.queued,
                    scheduled_at=now,
                )
                for admin_id in superadmin_ids
            ]
        )
    elif local.purpose is PaymentPurpose.prepayment:
        if local.appointment_id is None:
            raise ConflictError("Платёж не связан с записью", code="payment_relation_missing")
        appointment = await session.get(Appointment, local.appointment_id, with_for_update=True)
        if appointment is None:
            raise ConflictError("Запись не найдена", code="payment_relation_missing")
        if (
            appointment.status in {AppointmentStatus.new, AppointmentStatus.confirmed}
            and appointment.start_at > now
        ):
            appointment.prepaid = True
        else:
            local.provider_payload = {
                **local.provider_payload,
                "manualResolution": "late_prepayment_for_inactive_appointment",
            }
            site = await session.get(Site, appointment.tenant_id)
            if site is not None:
                session.add(
                    Notification(
                        tenant_id=None,
                        target_type=NotificationTargetType.platform_user,
                        target_id=site.owner_id,
                        channel=NotificationChannel.email,
                        template="late_appointment_prepayment",
                        payload={
                            "appointmentId": str(appointment.id),
                            "paymentId": str(local.id),
                        },
                        status=NotificationStatus.queued,
                        scheduled_at=now,
                    )
                )
    return None


def _provider_metadata_matches_local(
    local: Payment,
    provider_payment: ProviderPayment,
) -> bool:
    """Проверить доверенные идентификаторы, переданные при создании платежа."""

    metadata = provider_payment.metadata
    if metadata.get("local_payment_id") != str(local.id):
        return False
    if metadata.get("purpose") != local.purpose.value:
        return False
    if local.purpose is PaymentPurpose.subscription:
        target_plan_id = local.provider_payload.get("targetPlanId")
        return bool(target_plan_id) and metadata.get("target_plan_id") == str(target_plan_id)
    if local.purpose is PaymentPurpose.custom_landing:
        return local.custom_landing_order_id is not None and metadata.get("order_id") == str(
            local.custom_landing_order_id
        )
    if local.purpose is PaymentPurpose.prepayment:
        return local.appointment_id is not None and metadata.get("appointment_id") == str(
            local.appointment_id
        )
    return False


async def _local_payment_for_webhook(
    session: AsyncSession,
    provider_payment: ProviderPayment,
    *,
    provider_name: str,
) -> Payment | None:
    local = await session.scalar(
        select(Payment)
        .where(
            Payment.provider == provider_name,
            Payment.provider_payment_id == provider_payment.id,
        )
        .with_for_update()
    )
    if local is not None:
        if not _provider_metadata_matches_local(local, provider_payment):
            raise ConflictError(
                "Метаданные платежа не совпадают",
                code="payment_metadata_mismatch",
            )
        return local

    raw_local_id = provider_payment.metadata.get("local_payment_id")
    if not isinstance(raw_local_id, str):
        return None
    try:
        local_id = UUID(raw_local_id)
    except ValueError:
        return None
    local = cast(
        Payment | None,
        await session.scalar(
            select(Payment)
            .where(Payment.id == local_id, Payment.provider == provider_name)
            .with_for_update()
        ),
    )
    if local is None:
        return None
    if local.provider_payment_id is not None and local.provider_payment_id != provider_payment.id:
        raise ConflictError(
            "Локальный платёж уже связан с другой операцией",
            code="payment_provider_mismatch",
        )
    if not _provider_metadata_matches_local(local, provider_payment):
        raise ConflictError(
            "Метаданные платежа не совпадают",
            code="payment_metadata_mismatch",
        )
    return local


@router.post("/webhooks/yookassa", include_in_schema=True)
async def yookassa_webhook(
    request: Request,
    settings: Settings = Depends(settings_dep),
) -> dict[str, bool]:
    try:
        payload = await request.json()
    except ValueError as exc:
        raise BadRequestError("Некорректный JSON", code="invalid_webhook") from exc
    if not isinstance(payload, dict):
        raise BadRequestError("Некорректный webhook", code="invalid_webhook")
    source_ip = str(client_ip_from_request(request, settings.trusted_proxy_networks))
    try:
        verified = await _gateway(request).verify_notification(payload, source_ip=source_ip)
    except InvalidPaymentNotification as exc:
        raise BadRequestError("Webhook не прошёл проверку", code="invalid_webhook") from exc
    except PaymentProviderError as exc:
        raise ServiceUnavailableError(
            "Не удалось проверить платёж",
            code="payment_verification_failed",
        ) from exc

    owner_to_invalidate: UUID | None = None
    async with AdminSession() as session:
        async with session.begin():
            event_id = verified.idempotency_key
            await session.execute(
                text("SELECT pg_advisory_xact_lock(hashtextextended(:key, 2))"),
                {"key": f"yookassa:{event_id}"},
            )
            existing = await session.scalar(
                select(WebhookEvent).where(
                    WebhookEvent.provider == "yookassa", WebhookEvent.event_id == event_id
                )
            )
            if existing is not None and existing.status in {
                WebhookEventStatus.processed,
                WebhookEventStatus.ignored,
            }:
                return {"ok": True}
            local = await _local_payment_for_webhook(
                session,
                verified.payment,
                provider_name=_provider_name(request),
            )
            if local is None:
                # Подлинное событие провайдера для другого проекта или магазина
                # подтверждается, но не может изменить локальное состояние.
                if existing is None:
                    session.add(
                        WebhookEvent(
                            provider="yookassa",
                            event_id=event_id,
                            event_type=verified.event,
                            payload=payload,
                            headers={},
                            signature_verified=True,
                            status=WebhookEventStatus.ignored,
                            processed_at=datetime.now(UTC),
                        )
                    )
                return {"ok": True}
            if (
                verified.payment.amount != local.amount
                or verified.payment.currency != local.currency
            ):
                raise ConflictError("Сумма платежа не совпадает", code="payment_amount_mismatch")
            _record_provider_result(local, verified.payment)
            event = existing or WebhookEvent(
                tenant_id=local.tenant_id,
                provider="yookassa",
                event_id=event_id,
                event_type=verified.event,
                payload=payload,
                headers={},
                signature_verified=True,
                status=WebhookEventStatus.received,
            )
            if existing is None:
                session.add(event)
            if verified.payment.status is ProviderPaymentStatus.SUCCEEDED and verified.payment.paid:
                if local.status is not PaymentStatus.succeeded:
                    owner_to_invalidate = await _process_succeeded_payment(
                        session, local, verified.payment
                    )
                event.status = WebhookEventStatus.processed
            elif verified.payment.status is ProviderPaymentStatus.CANCELED:
                if local.status is not PaymentStatus.succeeded:
                    local.status = PaymentStatus.canceled
                event.status = WebhookEventStatus.processed
            else:
                event.status = WebhookEventStatus.ignored
            event.processed_at = datetime.now(UTC)
    if owner_to_invalidate is not None:
        await _invalidate_owner_site(request, owner_to_invalidate)
    return {"ok": True}
