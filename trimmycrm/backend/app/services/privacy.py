"""Транзакционная анонимизация персональных данных с сохранением истории учёта."""

from __future__ import annotations

from datetime import UTC, datetime
from uuid import UUID

from sqlalchemy import delete, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.integrations.storage import ObjectStorage
from app.models import (
    Appointment,
    ClientHairProfile,
    Notification,
    NotificationPreference,
    NotificationStatus,
    Review,
    TenantUser,
    TenantUserStatus,
)


async def tenant_user_media_keys(session: AsyncSession, user: TenantUser) -> list[str]:
    """Вернуть приватные файлы клиента, если такие связи появятся в продукте."""

    return []


async def erase_tenant_user_media(
    storage: ObjectStorage,
    *,
    tenant_id: UUID,
    keys: list[str],
) -> None:
    """Физически удалить связанные с клиентом приватные файлы."""

    for key in keys:
        await storage.delete(key, tenant_id=tenant_id)


async def anonymize_tenant_user(session: AsyncSession, user: TenantUser) -> None:
    """Удалить прямые и чувствительные данные профиля, не нарушая обязательный учёт."""

    now = datetime.now(UTC)
    await session.execute(
        delete(ClientHairProfile).where(
            ClientHairProfile.tenant_id == user.tenant_id,
            ClientHairProfile.client_id == user.id,
        )
    )
    await session.execute(
        update(Appointment)
        .where(
            Appointment.tenant_id == user.tenant_id,
            Appointment.tenant_user_id == user.id,
        )
        .values(notes=None, cancellation_reason=None)
    )
    await session.execute(
        update(Review)
        .where(
            Review.tenant_id == user.tenant_id,
            Review.tenant_user_id == user.id,
        )
        .values(text=None)
    )
    await session.execute(
        update(Notification)
        .where(
            Notification.tenant_id == user.tenant_id,
            Notification.target_id == user.id,
            Notification.status.in_([NotificationStatus.queued, NotificationStatus.processing]),
        )
        .values(status=NotificationStatus.canceled, payload={})
    )
    await session.execute(
        delete(NotificationPreference).where(
            NotificationPreference.tenant_id == user.tenant_id,
            NotificationPreference.tenant_user_id == user.id,
        )
    )
    user.email = None
    user.password_hash = None
    user.full_name = None
    user.phone = None
    user.email_verified = False
    user.status = TenantUserStatus.anonymized
    user.personal_data_consent_at = None
    user.anonymized_at = now
