"""Надёжные фоновые задачи для уведомлений, напоминаний и биллинга.

Межтенантные обходы используют намеренно привилегированное административное
соединение только для поиска работы. Затем каждая принадлежащая тенанту строка
читается и изменяется через ``tenant_transaction``, чтобы RLS PostgreSQL оставался
активной границей безопасности в обработчиках, как и в HTTP-запросах.

Ни одна задача этого модуля не журналирует тела сообщений, адреса, телефоны,
идентификаторы чатов, токены аутентификации или ответы платёжного провайдера.
"""

from __future__ import annotations

import asyncio
import html
import uuid
from collections.abc import Coroutine
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from decimal import Decimal
from typing import Any
from urllib.parse import urlencode, urlsplit, urlunsplit
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from celery import Task  # type: ignore[import-untyped]
from sqlalchemy import delete, or_, select, text
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import Settings, get_settings
from app.core.errors import ForbiddenError, NotFoundError
from app.core.logging import reset_logging_tenant, set_logging_tenant
from app.core.tenant import InvalidHostError, normalize_host
from app.db.session import (
    admin_engine,
    admin_transaction,
    runtime_engine,
    tenant_transaction,
)
from app.integrations.email import (
    Email,
    EmailDelivery,
    EmailDeliveryError,
    SMTPEmailSender,
)
from app.integrations.notifications import (
    SMS,
    SMSDelivery,
    TelegramDelivery,
    TelegramMessage,
    build_sms_sender,
    build_telegram_sender,
)
from app.integrations.payments import (
    Payment as ProviderPayment,
)
from app.integrations.payments import (
    PaymentProviderError,
    PaymentRequest,
    build_payment_gateway,
)
from app.integrations.payments import (
    PaymentStatus as ProviderPaymentStatus,
)
from app.integrations.storage import ObjectStorage, StorageError, build_object_storage
from app.models import (
    Appointment,
    AppointmentStatus,
    AuthToken,
    BillingPeriod,
    IdempotencyKey,
    MediaObject,
    MediaStatus,
    Notification,
    NotificationChannel,
    NotificationPreference,
    NotificationStatus,
    NotificationTargetType,
    Payment,
    PaymentPurpose,
    PaymentStatus,
    Pet,
    PetPhoto,
    Plan,
    PlatformUser,
    RefreshToken,
    Service,
    Site,
    Staff,
    Subscription,
    SubscriptionStatus,
    TenantUser,
)
from app.services.access import plan_access_for_tenant
from app.tasks.celery_app import celery_app

AUTH_EMAIL_KINDS = frozenset(
    {
        "platform_verify",
        "platform_reset",
        "tenant_verify",
        "tenant_reset",
        "staff_invite",
    }
)
MAX_NOTIFICATION_ATTEMPTS = 5
NOTIFICATION_BATCH_SIZE = 200
MEDIA_PURGE_BATCH_SIZE = 200
STALE_NOTIFICATION_AFTER = timedelta(minutes=15)
REMINDER_LOOKAHEAD = timedelta(days=8)
REMINDER_LATE_TOLERANCE = timedelta(minutes=15)
DUNNING_RETRY_GAPS = (timedelta(days=1), timedelta(days=2), timedelta(days=2))


class _DeliveryUnavailable(RuntimeError):
    """Повторяемая ошибка внешнего канала без данных провайдера."""


class _CancelNotification(RuntimeError):
    """Неустранимая ошибка политики или получателя, которую не следует повторять."""


@dataclass(frozen=True, slots=True)
class _OutboundMessage:
    channel: NotificationChannel
    destination: str
    subject: str
    text: str


@dataclass(frozen=True, slots=True)
class _RenewalIntent:
    subscription_id: uuid.UUID
    plan_id: uuid.UUID
    payment_id: uuid.UUID
    amount: Decimal
    plan_name: str
    payment_method_id: str
    provider_payment_id: str | None


def _provider_matches_renewal_intent(
    intent: _RenewalIntent, provider_payment: ProviderPayment
) -> bool:
    metadata = provider_payment.metadata
    return (
        provider_payment.amount == intent.amount
        and provider_payment.currency == "RUB"
        and metadata.get("local_payment_id") == str(intent.payment_id)
        and metadata.get("purpose") == "subscription"
        and metadata.get("target_plan_id") == str(intent.plan_id)
        and metadata.get("renewal") == "true"
    )


class _DevelopmentEmailSender:
    """Приёмник без сохранения, используемый без SMTP только в разработке и тестах."""

    async def send(self, message: Email) -> EmailDelivery:
        return EmailDelivery(
            message_id=f"dev-null-{uuid.uuid4().hex}",
            accepted_recipients=message.to,
        )


class _DevelopmentSMSSender:
    async def send(self, message: SMS) -> SMSDelivery:
        del message
        return SMSDelivery(provider_id=f"dev-null-{uuid.uuid4().hex}", segments=1)


class _DevelopmentTelegramSender:
    async def send(self, message: TelegramMessage) -> TelegramDelivery:
        return TelegramDelivery(message_id=0, chat_id=message.chat_id)


def _run_database[T](coro: Coroutine[Any, Any, T]) -> T:
    """Выполнить асинхронную задачу и затем сбросить привязанные к циклу пулы asyncpg.

    Обработчики Celery с предварительным порождением процессов вызывают синхронные
    функции задач. ``asyncio.run`` создаёт отдельный цикл для каждого вызова, а
    соединения asyncpg привязаны к циклу; освобождение обоих пулов не позволяет
    следующей задаче использовать соединение закрытого цикла.
    """

    async def runner() -> T:
        try:
            return await coro
        finally:
            await asyncio.gather(
                runtime_engine.dispose(),
                admin_engine.dispose(),
                return_exceptions=True,
            )

    return asyncio.run(runner())


def _validate_auth_email_input(
    kind: str,
    email: str,
    token: str,
    tenant_host: str | None,
    tenant_name: str | None = None,
) -> None:
    if kind not in AUTH_EMAIL_KINDS:
        raise ValueError("unsupported authentication email kind")
    if not email or len(email) > 320 or "@" not in email or "\r" in email or "\n" in email:
        raise ValueError("invalid authentication email recipient")
    if not 16 <= len(token) <= 2048 or any(char.isspace() for char in token):
        raise ValueError("invalid authentication email token")
    if kind.startswith("tenant_") and not tenant_host:
        raise ValueError("tenant host is required for tenant authentication email")
    if tenant_name is not None and (
        not tenant_name.strip()
        or len(tenant_name) > 160
        or "\r" in tenant_name
        or "\n" in tenant_name
    ):
        raise ValueError("invalid tenant name")


def _tenant_origin(settings: Settings, tenant_host: str) -> str:
    try:
        parsed_host = urlsplit(f"//{tenant_host}")
        tenant_port = parsed_host.port
        canonical_host = normalize_host(tenant_host, allow_ip=settings.is_development)
    except (InvalidHostError, ValueError):
        raise ValueError("invalid tenant host") from None
    public = urlsplit(str(settings.public_base_url))
    port = tenant_port if tenant_port is not None else public.port
    netloc = f"[{canonical_host}]" if ":" in canonical_host else canonical_host
    if port is not None:
        netloc = f"{netloc}:{port}"
    return urlunsplit((public.scheme, netloc, "", "", ""))


def _auth_email(
    settings: Settings,
    kind: str,
    recipient: str,
    token: str,
    tenant_host: str | None,
    tenant_name: str | None = None,
) -> Email:
    public_origin = str(settings.public_base_url).rstrip("/")
    if kind.startswith("tenant_"):
        assert tenant_host is not None
        origin = _tenant_origin(settings, tenant_host)
    else:
        origin = public_origin

    brand_name = tenant_name.strip() if kind.startswith("tenant_") and tenant_name else "TrimmyCRM"

    if kind in {"platform_verify", "tenant_verify"}:
        subject = f"Подтвердите email в {brand_name}"
        intro = "Для завершения регистрации подтвердите адрес электронной почты."
        path = "/verify-email"
    elif kind == "staff_invite":
        subject = "Приглашение в TrimmyCRM"
        intro = "Вас пригласили в команду салона. Задайте пароль для входа."
        path = "/reset-password"
    else:
        subject = "Восстановление пароля TrimmyCRM"
        intro = "Откройте ссылку, чтобы задать новый пароль."
        path = "/reset-password"

    link = f"{origin}{path}?{urlencode({'token': token})}"
    text_body = (
        f"{intro}\n\n{link}\n\nЕсли вы не запрашивали это действие, просто проигнорируйте письмо."
    )
    html_body = (
        f"<p>{html.escape(intro)}</p>"
        f'<p><a href="{html.escape(link, quote=True)}">Продолжить</a></p>'
        "<p>Если вы не запрашивали это действие, просто проигнорируйте "
        "письмо.</p>"
    )
    return Email(
        to=(recipient,),
        subject=subject,
        text=text_body,
        html=html_body,
        from_name=brand_name,
        headers={"Auto-Submitted": "auto-generated"},
    )


async def _send_auth_email(
    kind: str,
    recipient: str,
    token: str,
    tenant_host: str | None,
    tenant_name: str | None = None,
) -> None:
    settings = get_settings()
    message = _auth_email(settings, kind, recipient, token, tenant_host, tenant_name)
    sender: SMTPEmailSender | _DevelopmentEmailSender
    if settings.smtp_host:
        try:
            sender = SMTPEmailSender.from_settings(settings)
        except ValueError:
            raise _DeliveryUnavailable("email channel configuration is invalid") from None
    elif settings.is_development:
        sender = _DevelopmentEmailSender()
    else:
        raise _DeliveryUnavailable("email channel is not configured")
    try:
        await sender.send(message)
    except (EmailDeliveryError, OSError) as exc:
        del exc
        raise _DeliveryUnavailable("authentication email delivery failed") from None


@celery_app.task(  # type: ignore[untyped-decorator]
    bind=True,
    name="app.tasks.send_auth_email",
    ignore_result=True,
    max_retries=5,
    acks_late=True,
)
def send_auth_email(
    self: Task,
    kind: str,
    email: str,
    token: str,
    tenant_host: str | None = None,
    tenant_name: str | None = None,
) -> None:
    """Доставить письмо аутентификации, не раскрывая его аргументы."""

    _validate_auth_email_input(kind, email, token, tenant_host, tenant_name)
    try:
        asyncio.run(_send_auth_email(kind, email, token, tenant_host, tenant_name))
    except _DeliveryUnavailable:
        countdown = min(60 * (2 ** int(self.request.retries)), 60 * 60)
        raise self.retry(
            exc=_DeliveryUnavailable("authentication email delivery failed"),
            countdown=countdown,
        ) from None


def enqueue_auth_email(
    kind: str,
    email: str,
    token: str,
    tenant_host: str | None = None,
    tenant_name: str | None = None,
) -> None:
    """Обратный вызов FastAPI ``BackgroundTasks``, публикующий задачу SMTP.

    ``argsrepr`` и ``kwargsrepr`` явно скрыты, чтобы инспекция обработчика и отчёты
    об ошибках не могли вывести одноразовый токен или персональные данные.
    """

    _validate_auth_email_input(kind, email, token, tenant_host, tenant_name)
    send_auth_email.apply_async(
        kwargs={
            "kind": kind,
            "email": email,
            "token": token,
            "tenant_host": tenant_host,
            "tenant_name": tenant_name,
        },
        argsrepr="()",
        kwargsrepr="{'kind': '[REDACTED]', 'email': '[REDACTED]', "
        "'token': '[REDACTED]', 'tenant_host': '[REDACTED]'}",
        shadow="authentication-email",
    )


def _notification_backoff(attempts: int) -> timedelta:
    minutes = (1, 5, 15, 60, 360)
    return timedelta(minutes=minutes[min(max(attempts - 1, 0), len(minutes) - 1)])


async def _channel_allowed(
    session: AsyncSession,
    notification: Notification,
    preference: NotificationPreference | None,
) -> None:
    if notification.tenant_id is None:
        return
    try:
        access = await plan_access_for_tenant(session, notification.tenant_id)
    except (ForbiddenError, NotFoundError) as exc:
        del exc
        raise _CancelNotification("subscription is unavailable") from None

    required_feature = {
        NotificationChannel.email: "email_notifications",
        NotificationChannel.sms: "sms",
        NotificationChannel.telegram: "telegram",
    }[notification.channel]
    if required_feature not in access.features:
        raise _CancelNotification("channel is not included in the current plan")

    if notification.target_type is not NotificationTargetType.tenant_user:
        return
    is_appointment = notification.template == "appointment_reminder"
    is_marketing = bool(notification.payload.get("marketing")) or notification.template.startswith(
        "marketing_"
    )
    if is_marketing and (preference is None or not preference.marketing_enabled):
        raise _CancelNotification("marketing notifications require recipient opt-in")
    if preference is not None:
        channel_enabled = {
            NotificationChannel.email: preference.email_enabled,
            NotificationChannel.sms: preference.sms_enabled,
            NotificationChannel.telegram: preference.telegram_enabled,
        }[notification.channel]
        if not channel_enabled:
            raise _CancelNotification("channel is disabled by recipient preference")
        if is_appointment and not preference.appointment_reminders_enabled:
            raise _CancelNotification("appointment reminders are disabled")
    elif notification.channel is not NotificationChannel.email:
        raise _CancelNotification("channel requires recipient opt-in")


async def _recipient(
    session: AsyncSession,
    notification: Notification,
) -> tuple[str, NotificationPreference | None]:
    preference: NotificationPreference | None = None
    if notification.target_type is NotificationTargetType.tenant_user:
        if notification.tenant_id is None:
            raise _CancelNotification("tenant notification has no tenant")
        tenant_user = await session.scalar(
            select(TenantUser).where(
                TenantUser.id == notification.target_id,
                TenantUser.tenant_id == notification.tenant_id,
            )
        )
        if tenant_user is None:
            raise _CancelNotification("recipient does not exist")
        preference = await session.scalar(
            select(NotificationPreference).where(
                NotificationPreference.tenant_id == notification.tenant_id,
                NotificationPreference.tenant_user_id == notification.target_id,
            )
        )
        if notification.channel is NotificationChannel.email:
            destination = tenant_user.email
        elif notification.channel is NotificationChannel.sms:
            destination = tenant_user.phone
        else:
            destination = preference.telegram_chat_id if preference else None
    else:
        platform_user = await session.get(PlatformUser, notification.target_id)
        if platform_user is None:
            raise _CancelNotification("recipient does not exist")
        if notification.channel is NotificationChannel.email:
            destination = platform_user.email
        elif notification.channel is NotificationChannel.sms:
            destination = platform_user.phone
        else:
            destination = None
    if not destination:
        raise _CancelNotification("recipient has no address for this channel")
    return str(destination), preference


def _safe_timezone(value: str) -> ZoneInfo:
    try:
        return ZoneInfo(value)
    except (ZoneInfoNotFoundError, ValueError):
        return ZoneInfo("UTC")


async def _appointment_content(
    session: AsyncSession,
    notification: Notification,
) -> tuple[str, str]:
    raw_id = notification.payload.get("appointmentId")
    try:
        appointment_id = uuid.UUID(str(raw_id))
    except (TypeError, ValueError, AttributeError) as exc:
        del exc
        raise _CancelNotification("appointment reminder has invalid payload") from None
    appointment = await session.scalar(
        select(Appointment).where(
            Appointment.id == appointment_id,
            Appointment.tenant_id == notification.tenant_id,
            Appointment.tenant_user_id == notification.target_id,
        )
    )
    if appointment is None or appointment.status not in {
        AppointmentStatus.new,
        AppointmentStatus.confirmed,
    }:
        raise _CancelNotification("appointment is no longer active")
    if appointment.start_at <= datetime.now(UTC):
        raise _CancelNotification("appointment has already started")

    site = await session.get(Site, appointment.tenant_id)
    service = await session.get(Service, appointment.service_id)
    pet = await session.get(Pet, appointment.pet_id)
    staff = await session.get(Staff, appointment.staff_id) if appointment.staff_id else None
    local_start = appointment.start_at.astimezone(_safe_timezone(site.timezone if site else "UTC"))
    details = [
        f"Дата и время: {local_start:%d.%m.%Y %H:%M}",
        f"Салон: {site.name}" if site else "",
        f"Услуга: {service.name}" if service else "",
        f"Питомец: {pet.name}" if pet else "",
        f"Мастер: {staff.name}" if staff else "",
    ]
    text_body = "Напоминаем о предстоящей записи.\n\n" + "\n".join(item for item in details if item)
    return "Напоминание о записи", text_body


async def _notification_content(
    session: AsyncSession,
    notification: Notification,
) -> tuple[str, str]:
    if notification.template == "appointment_reminder":
        return await _appointment_content(session, notification)
    if notification.template == "subscription_payment_failed":
        attempt = notification.payload.get("attempt")
        suffix = f" (попытка {attempt})" if isinstance(attempt, int) and attempt > 0 else ""
        return (
            "Не удалось продлить подписку TrimmyCRM",
            "Не удалось выполнить автоматический платёж"
            f"{suffix}. Проверьте сохранённый способ оплаты в разделе "
            "биллинга.",
        )
    if notification.template == "subscription_canceled":
        return (
            "Автопродление TrimmyCRM остановлено",
            "Повторные попытки оплаты исчерпаны. Подписку можно возобновить в разделе биллинга.",
        )
    if notification.template == "subscription_payment_integrity_failed":
        return (
            "Требуется проверка платежа TrimmyCRM",
            "Ответ платёжного провайдера не совпал с созданным счётом. "
            "Автопродление не применено; обратитесь в поддержку.",
        )
    if notification.template == "custom_landing_paid":
        return (
            "Оплачена заявка на индивидуальный лендинг",
            "В суперадминке появилась оплаченная заявка на индивидуальный лендинг.",
        )
    if notification.template == "late_appointment_prepayment":
        return (
            "Предоплата поступила после изменения записи",
            "Проверьте платёж и статус записи в CRM; может потребоваться возврат клиенту.",
        )
    subject = notification.payload.get("subject")
    body = notification.payload.get("text")
    if not isinstance(subject, str) or not isinstance(body, str):
        return (
            "Уведомление TrimmyCRM",
            "У вас новое уведомление в TrimmyCRM.",
        )
    subject = " ".join(subject.splitlines()).strip()[:180]
    body = body.strip()[:10_000]
    if not subject or not body:
        raise _CancelNotification("notification content is empty")
    return subject, body


async def _prepare_outbound(
    session: AsyncSession,
    notification: Notification,
) -> _OutboundMessage:
    destination, preference = await _recipient(session, notification)
    await _channel_allowed(session, notification, preference)
    subject, body = await _notification_content(session, notification)
    if notification.channel is NotificationChannel.sms:
        body = f"{subject}. {body}"[:1000]
    elif notification.channel is NotificationChannel.telegram:
        body = f"{subject}\n\n{body}"[:4096]
    return _OutboundMessage(
        channel=notification.channel,
        destination=destination,
        subject=subject,
        text=body,
    )


async def _deliver_notification(message: _OutboundMessage) -> None:
    settings = get_settings()
    sender: Any
    if message.channel is NotificationChannel.email:
        if (
            "@" not in message.destination
            or len(message.destination) > 320
            or "\r" in message.destination
            or "\n" in message.destination
        ):
            raise _CancelNotification("recipient has an invalid email address")
        if settings.smtp_host:
            try:
                sender = SMTPEmailSender.from_settings(settings)
            except ValueError:
                raise _DeliveryUnavailable("email channel configuration is invalid") from None
        elif settings.is_development:
            sender = _DevelopmentEmailSender()
        else:
            raise _DeliveryUnavailable("email channel is not configured")
        outbound: Any = Email(
            to=(message.destination,),
            subject=message.subject,
            text=message.text,
            headers={"Auto-Submitted": "auto-generated"},
        )
    elif message.channel is NotificationChannel.sms:
        try:
            outbound = SMS(phone=message.destination, text=message.text)
        except ValueError:
            raise _CancelNotification("recipient has an invalid phone number") from None
        try:
            sender = build_sms_sender(settings)
        except ValueError:
            raise _DeliveryUnavailable("SMS channel configuration is invalid") from None
        if sender is None and settings.is_development:
            sender = _DevelopmentSMSSender()
        if sender is None:
            raise _DeliveryUnavailable("SMS channel is not configured")
    else:
        try:
            outbound = TelegramMessage(chat_id=message.destination, text=message.text)
        except ValueError:
            raise _CancelNotification("recipient has an invalid Telegram chat ID") from None
        try:
            sender = build_telegram_sender(settings)
        except ValueError:
            raise _DeliveryUnavailable("Telegram channel configuration is invalid") from None
        if sender is None and settings.is_development:
            sender = _DevelopmentTelegramSender()
        if sender is None:
            raise _DeliveryUnavailable("Telegram channel is not configured")

    try:
        await sender.send(outbound)
    except (OSError, RuntimeError, ValueError) as exc:
        del exc
        raise _DeliveryUnavailable("notification delivery failed") from None
    finally:
        close = getattr(sender, "aclose", None)
        if close is not None:
            try:
                await close()
            except Exception:  # noqa: BLE001 - очистка не должна менять состояние доставки
                close = None


async def _dispatch_notification(notification_id: uuid.UUID, tenant_id: uuid.UUID | None) -> None:
    async with tenant_transaction(
        tenant_id,
        platform_scope=tenant_id is None,
    ) as session:
        notification = await session.scalar(
            select(Notification).where(Notification.id == notification_id).with_for_update()
        )
        if notification is None:
            return
        if notification.tenant_id != tenant_id:
            return
        if notification.status not in {
            NotificationStatus.queued,
            NotificationStatus.processing,
        }:
            return
        now = datetime.now(UTC)
        if notification.scheduled_at and notification.scheduled_at > now:
            notification.status = NotificationStatus.queued
            return

        notification.status = NotificationStatus.processing
        notification.attempts += 1
        try:
            outbound = await _prepare_outbound(session, notification)
            await _deliver_notification(outbound)
        except _CancelNotification as exc:
            notification.status = NotificationStatus.canceled
            notification.last_error = str(exc)
            return
        except _DeliveryUnavailable:
            notification.last_error = "delivery_failed"
            if notification.attempts >= MAX_NOTIFICATION_ATTEMPTS:
                notification.status = NotificationStatus.failed
            else:
                notification.status = NotificationStatus.queued
                notification.scheduled_at = now + _notification_backoff(notification.attempts)
            return

        notification.status = NotificationStatus.sent
        notification.sent_at = now
        notification.last_error = None


@celery_app.task(  # type: ignore[untyped-decorator]
    name="app.tasks.dispatch_notification",
    ignore_result=True,
    acks_late=True,
)
def dispatch_notification(notification_id: str, tenant_id: str | None = None) -> None:
    parsed_notification_id = uuid.UUID(notification_id)
    parsed_tenant_id = uuid.UUID(tenant_id) if tenant_id else None
    log_token = set_logging_tenant(tenant_id)
    try:
        _run_database(_dispatch_notification(parsed_notification_id, parsed_tenant_id))
    finally:
        reset_logging_tenant(log_token)


async def _claim_due_notifications() -> list[tuple[uuid.UUID, uuid.UUID | None]]:
    now = datetime.now(UTC)
    stale_before = now - STALE_NOTIFICATION_AFTER
    async with admin_transaction() as session:
        stale = (
            await session.scalars(
                select(Notification)
                .where(
                    Notification.status == NotificationStatus.processing,
                    Notification.updated_at <= stale_before,
                )
                .with_for_update(skip_locked=True)
                .limit(NOTIFICATION_BATCH_SIZE)
            )
        ).all()
        for row in stale:
            if row.attempts >= MAX_NOTIFICATION_ATTEMPTS:
                row.status = NotificationStatus.failed
                row.last_error = "worker_interrupted"
            else:
                row.status = NotificationStatus.queued
                row.scheduled_at = now
                row.last_error = "worker_interrupted"

        rows = (
            await session.scalars(
                select(Notification)
                .where(
                    Notification.status == NotificationStatus.queued,
                    or_(
                        Notification.scheduled_at.is_(None),
                        Notification.scheduled_at <= now,
                    ),
                )
                .order_by(Notification.scheduled_at.asc().nullsfirst(), Notification.created_at)
                .with_for_update(skip_locked=True)
                .limit(NOTIFICATION_BATCH_SIZE)
            )
        ).all()
        claimed: list[tuple[uuid.UUID, uuid.UUID | None]] = []
        for row in rows:
            row.status = NotificationStatus.processing
            claimed.append((row.id, row.tenant_id))
        return claimed


async def _release_notification_claim(notification_id: uuid.UUID) -> None:
    async with admin_transaction() as session:
        row = await session.get(Notification, notification_id, with_for_update=True)
        if row is not None and row.status is NotificationStatus.processing:
            row.status = NotificationStatus.queued
            row.scheduled_at = datetime.now(UTC) + timedelta(minutes=1)
            row.last_error = "queue_publish_failed"


@celery_app.task(  # type: ignore[untyped-decorator]
    name="app.tasks.dispatch_queued_notifications",
    ignore_result=True,
    acks_late=True,
)
def dispatch_queued_notifications() -> None:
    claimed = _run_database(_claim_due_notifications())
    for notification_id, tenant_id in claimed:
        try:
            dispatch_notification.apply_async(
                args=(str(notification_id), str(tenant_id) if tenant_id else None),
                argsrepr="('[notification-id]', '[tenant-id]')",
                expires=60 * 60,
            )
        except Exception:  # noqa: BLE001 - ошибки брокера намеренно обезличиваются
            _run_database(_release_notification_claim(notification_id))


async def _discover_reminder_tenants() -> list[uuid.UUID]:
    now = datetime.now(UTC)
    async with admin_transaction() as session:
        return list(
            await session.scalars(
                select(Appointment.tenant_id)
                .where(
                    Appointment.status.in_([AppointmentStatus.new, AppointmentStatus.confirmed]),
                    Appointment.start_at > now,
                    Appointment.start_at <= now + REMINDER_LOOKAHEAD,
                )
                .distinct()
            )
        )


def _preference_hours(preference: NotificationPreference | None) -> tuple[int, ...]:
    if preference is None:
        # Соответствуем значению БД по умолчанию, не создавая строку настроек
        # как побочный эффект планировщика.
        return (24,)
    candidates: list[object] = list(preference.reminder_hours or [])
    if not candidates:
        candidates.append(preference.reminder_hours_before)
    return tuple(
        sorted(
            {
                int(value)
                for value in candidates
                if isinstance(value, int) and not isinstance(value, bool) and 1 <= value <= 168
            },
            reverse=True,
        )
    )


async def _schedule_tenant_reminders(tenant_id: uuid.UUID) -> None:
    now = datetime.now(UTC)
    async with tenant_transaction(tenant_id) as session:
        await session.execute(
            text("SELECT pg_advisory_xact_lock(hashtextextended(:key, 0))"),
            {"key": f"appointment-reminders:{tenant_id}"},
        )
        try:
            access = await plan_access_for_tenant(session, tenant_id)
        except (ForbiddenError, NotFoundError):
            return
        appointments = (
            await session.scalars(
                select(Appointment).where(
                    Appointment.tenant_id == tenant_id,
                    Appointment.status.in_([AppointmentStatus.new, AppointmentStatus.confirmed]),
                    Appointment.start_at > now,
                    Appointment.start_at <= now + REMINDER_LOOKAHEAD,
                )
            )
        ).all()
        if not appointments:
            return
        user_ids = {row.tenant_user_id for row in appointments}
        preferences = {
            row.tenant_user_id: row
            for row in (
                await session.scalars(
                    select(NotificationPreference).where(
                        NotificationPreference.tenant_id == tenant_id,
                        NotificationPreference.tenant_user_id.in_(user_ids),
                    )
                )
            ).all()
        }
        appointment_ids = {str(row.id) for row in appointments}
        current = (
            await session.scalars(
                select(Notification).where(
                    Notification.tenant_id == tenant_id,
                    Notification.template == "appointment_reminder",
                    Notification.status.in_(
                        [
                            NotificationStatus.queued,
                            NotificationStatus.processing,
                            NotificationStatus.sent,
                        ]
                    ),
                )
            )
        ).all()
        existing = {
            (
                str(row.payload.get("appointmentId")),
                row.payload.get("hoursBefore"),
                row.channel.value,
            )
            for row in current
            if str(row.payload.get("appointmentId")) in appointment_ids
        }

        for appointment in appointments:
            preference = preferences.get(appointment.tenant_user_id)
            if preference is not None and not preference.appointment_reminders_enabled:
                continue
            enabled_channels: list[NotificationChannel] = []
            if preference is None or preference.email_enabled:
                if "email_notifications" in access.features:
                    enabled_channels.append(NotificationChannel.email)
            if preference is not None and preference.sms_enabled and "sms" in access.features:
                enabled_channels.append(NotificationChannel.sms)
            if (
                preference is not None
                and preference.telegram_enabled
                and preference.telegram_chat_id
                and "telegram" in access.features
            ):
                enabled_channels.append(NotificationChannel.telegram)
            for hours in _preference_hours(preference):
                scheduled_at = appointment.start_at - timedelta(hours=hours)
                if scheduled_at < now - REMINDER_LATE_TOLERANCE:
                    continue
                if scheduled_at < now:
                    scheduled_at = now
                for channel in enabled_channels:
                    key = (str(appointment.id), hours, channel.value)
                    if key in existing:
                        continue
                    session.add(
                        Notification(
                            tenant_id=tenant_id,
                            target_type=NotificationTargetType.tenant_user,
                            target_id=appointment.tenant_user_id,
                            channel=channel,
                            template="appointment_reminder",
                            payload={
                                "appointmentId": str(appointment.id),
                                "hoursBefore": hours,
                            },
                            status=NotificationStatus.queued,
                            scheduled_at=scheduled_at,
                        )
                    )
                    existing.add(key)


@celery_app.task(  # type: ignore[untyped-decorator]
    name="app.tasks.schedule_tenant_appointment_reminders",
    ignore_result=True,
    acks_late=True,
)
def schedule_tenant_appointment_reminders(tenant_id: str) -> None:
    parsed_tenant_id = uuid.UUID(tenant_id)
    log_token = set_logging_tenant(tenant_id)
    try:
        _run_database(_schedule_tenant_reminders(parsed_tenant_id))
    finally:
        reset_logging_tenant(log_token)


@celery_app.task(  # type: ignore[untyped-decorator]
    name="app.tasks.schedule_appointment_reminders",
    ignore_result=True,
    acks_late=True,
)
def schedule_appointment_reminders() -> None:
    for tenant_id in _run_database(_discover_reminder_tenants()):
        schedule_tenant_appointment_reminders.apply_async(
            args=(str(tenant_id),),
            argsrepr="('[tenant-id]',)",
            expires=4 * 60,
        )


def _billing_period(plan: Plan) -> timedelta:
    return timedelta(days=365 if plan.period is BillingPeriod.year else 30)


async def _queue_subscription_notice(
    session: AsyncSession,
    subscription: Subscription,
    *,
    template: str,
    attempt: int,
) -> None:
    candidates = (
        await session.scalars(
            select(Notification).where(
                Notification.tenant_id.is_(None),
                Notification.target_type == NotificationTargetType.platform_user,
                Notification.target_id == subscription.owner_id,
                Notification.template == template,
            )
        )
    ).all()
    key = (str(subscription.id), attempt)
    if any(
        (str(row.payload.get("subscriptionId")), row.payload.get("attempt")) == key
        for row in candidates
    ):
        return
    session.add(
        Notification(
            tenant_id=None,
            target_type=NotificationTargetType.platform_user,
            target_id=subscription.owner_id,
            channel=NotificationChannel.email,
            template=template,
            payload={"subscriptionId": str(subscription.id), "attempt": attempt},
            status=NotificationStatus.queued,
            scheduled_at=datetime.now(UTC),
        )
    )


async def _renewal_failed(
    session: AsyncSession,
    subscription: Subscription,
    payment: Payment | None,
    now: datetime,
) -> None:
    if payment is not None:
        payment.status = PaymentStatus.canceled
        payment.provider_payload = {
            **payment.provider_payload,
            "renewalOutcome": "failed",
        }
    if subscription.status is SubscriptionStatus.past_due:
        subscription.dunning_attempts += 1
        attempt = subscription.dunning_attempts
    else:
        subscription.status = SubscriptionStatus.past_due
        subscription.dunning_attempts = 0
        attempt = 0
        subscription.grace_period_end = now + timedelta(days=get_settings().grace_period_days)
    subscription.last_payment_attempt_at = now

    if attempt >= len(DUNNING_RETRY_GAPS):
        subscription.status = SubscriptionStatus.canceled
        subscription.auto_renew = False
        subscription.next_dunning_at = None
        subscription.canceled_at = now
        await _queue_subscription_notice(
            session,
            subscription,
            template="subscription_canceled",
            attempt=attempt,
        )
        return
    subscription.next_dunning_at = now + DUNNING_RETRY_GAPS[attempt]
    await _queue_subscription_notice(
        session,
        subscription,
        template="subscription_payment_failed",
        attempt=attempt,
    )


def _renewal_succeeded(
    subscription: Subscription,
    plan: Plan,
    payment: Payment,
    now: datetime,
    *,
    provider_payment_id: str,
    payment_method_id: str | None,
) -> None:
    payment.provider_payment_id = provider_payment_id
    payment.payment_method_id = payment_method_id
    payment.status = PaymentStatus.succeeded
    payment.paid_at = now
    payment.provider_payload = {
        **payment.provider_payload,
        "renewalOutcome": "succeeded",
    }
    subscription.status = SubscriptionStatus.active
    subscription.current_period_start = now
    subscription.current_period_end = now + _billing_period(plan)
    subscription.dunning_attempts = 0
    subscription.next_dunning_at = None
    subscription.grace_period_end = None
    subscription.canceled_at = None
    subscription.last_payment_attempt_at = now
    if payment_method_id:
        subscription.payment_method_id = payment_method_id


async def _pending_renewal_payment(
    session: AsyncSession,
    subscription_id: uuid.UUID,
) -> Payment | None:
    candidates = (
        await session.scalars(
            select(Payment)
            .where(
                Payment.tenant_id.is_(None),
                Payment.subscription_id == subscription_id,
                Payment.purpose == PaymentPurpose.subscription,
                Payment.status == PaymentStatus.pending,
            )
            .order_by(Payment.created_at.desc())
            .with_for_update()
        )
    ).all()
    return next((row for row in candidates if row.provider_payload.get("renewal") is True), None)


async def _prepare_subscription_renewal(
    subscription_id: uuid.UUID,
) -> _RenewalIntent | None:
    settings = get_settings()
    async with tenant_transaction(None, platform_scope=True) as session:
        subscription = await session.scalar(
            select(Subscription).where(Subscription.id == subscription_id).with_for_update()
        )
        if subscription is None or subscription.status is SubscriptionStatus.expired:
            return None
        plan = await session.get(Plan, subscription.plan_id)
        if plan is None:
            return None
        now = datetime.now(UTC)

        if subscription.status is SubscriptionStatus.canceled:
            if subscription.current_period_end and subscription.current_period_end <= now:
                subscription.status = SubscriptionStatus.expired
            return None
        if subscription.status is SubscriptionStatus.trialing and (
            not subscription.payment_method_id or not subscription.auto_renew
        ):
            if subscription.current_period_end and subscription.current_period_end <= now:
                subscription.status = SubscriptionStatus.expired
                subscription.auto_renew = False
            return None
        if subscription.status in {SubscriptionStatus.active, SubscriptionStatus.trialing}:
            if not subscription.current_period_end or subscription.current_period_end > now:
                return None
            if not subscription.auto_renew:
                subscription.status = SubscriptionStatus.expired
                return None
        elif subscription.status is SubscriptionStatus.past_due:
            if not subscription.auto_renew:
                subscription.status = SubscriptionStatus.canceled
                subscription.canceled_at = now
                return None
            if subscription.dunning_attempts >= len(DUNNING_RETRY_GAPS):
                subscription.status = SubscriptionStatus.canceled
                subscription.auto_renew = False
                subscription.next_dunning_at = None
                subscription.canceled_at = now
                await _queue_subscription_notice(
                    session,
                    subscription,
                    template="subscription_canceled",
                    attempt=subscription.dunning_attempts,
                )
                return None
            if subscription.next_dunning_at and subscription.next_dunning_at > now:
                return None

        if not subscription.payment_method_id:
            await _renewal_failed(session, subscription, None, now)
            return None

        payment = await _pending_renewal_payment(session, subscription.id)
        if payment is None:
            payment = Payment(
                tenant_id=None,
                subscription_id=subscription.id,
                purpose=PaymentPurpose.subscription,
                amount=plan.price,
                currency="RUB",
                provider="mock" if settings.payment_provider == "mock" else "yookassa",
                status=PaymentStatus.pending,
                provider_payload={
                    "renewal": True,
                    "targetPlanId": str(plan.id),
                    "dunningAttempt": subscription.dunning_attempts,
                },
            )
            session.add(payment)
            await session.flush()

        if settings.payment_provider == "mock":
            _renewal_succeeded(
                subscription,
                plan,
                payment,
                now,
                provider_payment_id=f"mock_renewal_{payment.id.hex}",
                payment_method_id=subscription.payment_method_id,
            )
            return None

        return _RenewalIntent(
            subscription_id=subscription.id,
            plan_id=plan.id,
            payment_id=payment.id,
            amount=payment.amount,
            plan_name=plan.name,
            payment_method_id=subscription.payment_method_id,
            provider_payment_id=payment.provider_payment_id,
        )


async def _record_payment_provider_unavailable(intent: _RenewalIntent) -> None:
    settings = get_settings()
    now = datetime.now(UTC)
    async with tenant_transaction(None, platform_scope=True) as session:
        subscription = await session.scalar(
            select(Subscription).where(Subscription.id == intent.subscription_id).with_for_update()
        )
        payment = await session.get(Payment, intent.payment_id, with_for_update=True)
        if (
            subscription is None
            or payment is None
            or payment.subscription_id != subscription.id
            or payment.status is not PaymentStatus.pending
        ):
            return
        subscription.last_payment_attempt_at = now
        if subscription.status in {
            SubscriptionStatus.active,
            SubscriptionStatus.trialing,
        }:
            subscription.status = SubscriptionStatus.past_due
            subscription.grace_period_end = now + timedelta(days=settings.grace_period_days)
        if subscription.status is SubscriptionStatus.past_due:
            subscription.next_dunning_at = now + timedelta(days=1)


async def _record_payment_integrity_failure(
    intent: _RenewalIntent, provider_payment: ProviderPayment
) -> None:
    """Запретить доступ, если провайдер вернул платёж для другого намерения."""

    now = datetime.now(UTC)
    async with tenant_transaction(None, platform_scope=True) as session:
        subscription = await session.scalar(
            select(Subscription).where(Subscription.id == intent.subscription_id).with_for_update()
        )
        payment = await session.get(Payment, intent.payment_id, with_for_update=True)
        if (
            subscription is None
            or payment is None
            or payment.subscription_id != subscription.id
            or payment.status is not PaymentStatus.pending
        ):
            return
        payment.provider_payment_id = provider_payment.id
        await _renewal_failed(session, subscription, payment, now)
        payment.provider_payload = {
            **payment.provider_payload,
            "renewalOutcome": "integrity_failure",
        }
        await _queue_subscription_notice(
            session,
            subscription,
            template="subscription_payment_integrity_failed",
            attempt=subscription.dunning_attempts,
        )


async def _apply_provider_payment(
    intent: _RenewalIntent,
    provider_payment: ProviderPayment,
) -> None:
    settings = get_settings()
    now = datetime.now(UTC)
    async with tenant_transaction(None, platform_scope=True) as session:
        subscription = await session.scalar(
            select(Subscription).where(Subscription.id == intent.subscription_id).with_for_update()
        )
        payment = await session.get(Payment, intent.payment_id, with_for_update=True)
        plan = await session.get(Plan, intent.plan_id)
        if (
            subscription is None
            or payment is None
            or plan is None
            or payment.subscription_id != subscription.id
        ):
            return
        if payment.status is PaymentStatus.succeeded:
            return

        payment.provider_payment_id = provider_payment.id
        if provider_payment.status is ProviderPaymentStatus.SUCCEEDED and provider_payment.paid:
            _renewal_succeeded(
                subscription,
                plan,
                payment,
                now,
                provider_payment_id=provider_payment.id,
                payment_method_id=(
                    provider_payment.payment_method_id or subscription.payment_method_id
                ),
            )
            return
        if payment.status is not PaymentStatus.pending:
            return
        if provider_payment.status is ProviderPaymentStatus.CANCELED:
            await _renewal_failed(session, subscription, payment, now)
            return

        subscription.last_payment_attempt_at = now
        if payment.created_at <= now - timedelta(days=1):
            # Обычно регулярный карточный платёж быстро достигает конечного состояния.
            # Через сутки запускается предусмотренный график взыскания; более поздний
            # доверенный вебхук всё ещё может отметить платёж успешным.
            await _renewal_failed(session, subscription, payment, now)
        elif subscription.status in {
            SubscriptionStatus.active,
            SubscriptionStatus.trialing,
        }:
            subscription.status = SubscriptionStatus.past_due
            subscription.grace_period_end = now + timedelta(days=settings.grace_period_days)
            subscription.next_dunning_at = now + timedelta(days=1)
        elif subscription.status is SubscriptionStatus.past_due:
            subscription.next_dunning_at = now + timedelta(days=1)


async def _process_subscription(subscription_id: uuid.UUID) -> None:
    intent = await _prepare_subscription_renewal(subscription_id)
    if intent is None:
        return
    settings = get_settings()
    gateway = build_payment_gateway(settings)
    try:
        try:
            if intent.provider_payment_id:
                provider_payment = await gateway.get_payment(intent.provider_payment_id)
            else:
                provider_payment = await gateway.create_payment(
                    PaymentRequest(
                        amount=intent.amount,
                        description=(f"Продление подписки TrimmyCRM: {intent.plan_name}")[:128],
                        payment_method_id=intent.payment_method_id,
                        metadata={
                            "local_payment_id": str(intent.payment_id),
                            "purpose": "subscription",
                            "target_plan_id": str(intent.plan_id),
                            "renewal": "true",
                        },
                    ),
                    idempotence_key=str(intent.payment_id),
                )
        except PaymentProviderError:
            await _record_payment_provider_unavailable(intent)
            return
        if not _provider_matches_renewal_intent(intent, provider_payment):
            await _record_payment_integrity_failure(intent, provider_payment)
            return
        await _apply_provider_payment(intent, provider_payment)
    finally:
        close = getattr(gateway, "aclose", None)
        if close is not None:
            try:
                await close()
            except Exception:  # noqa: BLE001 - только очистка
                close = None


async def _discover_subscription_work() -> list[uuid.UUID]:
    now = datetime.now(UTC)
    async with admin_transaction() as session:
        return list(
            await session.scalars(
                select(Subscription.id).where(
                    or_(
                        (
                            Subscription.status.in_(
                                [
                                    SubscriptionStatus.active,
                                    SubscriptionStatus.trialing,
                                    SubscriptionStatus.canceled,
                                ]
                            )
                            & (Subscription.current_period_end.is_not(None))
                            & (Subscription.current_period_end <= now)
                        ),
                        (
                            (Subscription.status == SubscriptionStatus.past_due)
                            & or_(
                                Subscription.next_dunning_at.is_(None),
                                Subscription.next_dunning_at <= now,
                            )
                        ),
                    )
                )
            )
        )


@celery_app.task(  # type: ignore[untyped-decorator]
    name="app.tasks.process_one_subscription",
    ignore_result=True,
    acks_late=True,
)
def process_one_subscription(subscription_id: str) -> None:
    _run_database(_process_subscription(uuid.UUID(subscription_id)))


@celery_app.task(  # type: ignore[untyped-decorator]
    name="app.tasks.process_subscription_lifecycle",
    ignore_result=True,
    acks_late=True,
)
def process_subscription_lifecycle() -> None:
    for subscription_id in _run_database(_discover_subscription_work()):
        process_one_subscription.apply_async(
            args=(str(subscription_id),),
            argsrepr="('[subscription-id]',)",
            expires=6 * 60 * 60,
        )


async def _cleanup_security_records() -> list[tuple[uuid.UUID, uuid.UUID]]:
    now = datetime.now(UTC)
    used_auth_cutoff = now - timedelta(days=1)
    async with admin_transaction() as session:
        await session.execute(
            delete(AuthToken).where(
                or_(
                    AuthToken.expires_at <= now,
                    (AuthToken.used_at.is_not(None)) & (AuthToken.created_at <= used_auth_cutoff),
                )
            )
        )
        await session.execute(delete(RefreshToken).where(RefreshToken.expires_at <= now))
        await session.execute(delete(IdempotencyKey).where(IdempotencyKey.expires_at <= now))
        rows = (
            await session.execute(
                select(MediaObject.id, MediaObject.tenant_id)
                .where(
                    MediaObject.status == MediaStatus.deleted,
                    MediaObject.deleted_at.is_not(None),
                    MediaObject.tenant_id.is_not(None),
                )
                .order_by(MediaObject.deleted_at, MediaObject.id)
                .limit(MEDIA_PURGE_BATCH_SIZE)
            )
        ).all()
        return [(media_id, tenant_id) for media_id, tenant_id in rows if tenant_id is not None]


async def _purge_deleted_media_object(
    storage: ObjectStorage,
    *,
    media_id: uuid.UUID,
    tenant_id: uuid.UUID,
    expected_bucket: str,
) -> None:
    """Удалить помеченный объект S3, а затем его постоянную строку в базе данных.

    Операция DELETE в S3 идемпотентна. Строка БД намеренно сохраняется, когда
    провайдер недоступен или ключ не прошёл проверку принадлежности тенанту, чтобы
    последующий запуск очистки мог повториться без потери намерения удалить объект.
    """

    async with tenant_transaction(tenant_id) as session:
        media = await session.scalar(
            select(MediaObject).where(
                MediaObject.id == media_id,
                MediaObject.tenant_id == tenant_id,
                MediaObject.status == MediaStatus.deleted,
                MediaObject.deleted_at.is_not(None),
            )
        )
        if media is None or media.bucket != expected_bucket:
            return
        object_key = media.object_key

    try:
        await storage.delete(object_key, tenant_id=tenant_id)
    except (StorageError, ValueError):
        return

    async with tenant_transaction(tenant_id) as session:
        media = await session.scalar(
            select(MediaObject)
            .where(
                MediaObject.id == media_id,
                MediaObject.tenant_id == tenant_id,
            )
            .with_for_update()
        )
        if (
            media is None
            or media.status is not MediaStatus.deleted
            or media.deleted_at is None
            or media.object_key != object_key
            or media.bucket != expected_bucket
        ):
            return
        # Обычно процессы защиты данных сразу удаляют связь. Это идемпотентная
        # страховка для прерванных транзакций и старых данных.
        await session.execute(
            delete(PetPhoto).where(
                PetPhoto.tenant_id == tenant_id,
                PetPhoto.media_object_id == media.id,
            )
        )
        await session.delete(media)


async def _cleanup_expired_records() -> None:
    candidates = await _cleanup_security_records()
    if not candidates:
        return
    settings = get_settings()
    try:
        storage = build_object_storage(settings)
    except ValueError:
        return
    for media_id, tenant_id in candidates:
        await _purge_deleted_media_object(
            storage,
            media_id=media_id,
            tenant_id=tenant_id,
            expected_bucket=settings.s3_bucket,
        )


@celery_app.task(  # type: ignore[untyped-decorator]
    name="app.tasks.cleanup_expired_records",
    ignore_result=True,
    acks_late=True,
)
def cleanup_expired_records() -> None:
    _run_database(_cleanup_expired_records())


@celery_app.task(  # type: ignore[untyped-decorator]
    name="app.tasks.health_ping", ignore_result=False
)
def health_ping() -> dict[str, str]:
    """Небольшая задача без чувствительных данных для проверки обработчика и планировщика."""

    return {"status": "ok"}


__all__ = [
    "cleanup_expired_records",
    "dispatch_notification",
    "dispatch_queued_notifications",
    "enqueue_auth_email",
    "health_ping",
    "process_one_subscription",
    "process_subscription_lifecycle",
    "schedule_appointment_reminders",
    "schedule_tenant_appointment_reminders",
    "send_auth_email",
]
