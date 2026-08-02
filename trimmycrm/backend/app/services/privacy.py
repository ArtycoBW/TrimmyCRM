"""Транзакционная анонимизация персональных данных с сохранением истории учёта."""

from __future__ import annotations

from datetime import UTC, datetime
from uuid import UUID

from sqlalchemy import delete, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.integrations.storage import ObjectStorage
from app.models import (
    Appointment,
    ClientHairProfile,
    MediaObject,
    MediaStatus,
    Notification,
    NotificationPreference,
    NotificationStatus,
    Pet,
    PetDocument,
    PetPhoto,
    Review,
    TenantUser,
    TenantUserStatus,
)


async def tenant_user_media_keys(session: AsyncSession, user: TenantUser) -> list[str]:
    """Return ready private-object keys owned through a tenant user's pets."""

    pet_ids = list(
        await session.scalars(
            select(Pet.id).where(Pet.tenant_id == user.tenant_id, Pet.owner_id == user.id)
        )
    )
    if not pet_ids:
        return []

    photo_media_ids = list(
        await session.scalars(
            select(PetPhoto.media_object_id).where(
                PetPhoto.tenant_id == user.tenant_id,
                PetPhoto.pet_id.in_(pet_ids),
            )
        )
    )
    document_media_ids = list(
        await session.scalars(
            select(PetDocument.media_object_id).where(
                PetDocument.tenant_id == user.tenant_id,
                PetDocument.pet_id.in_(pet_ids),
            )
        )
    )
    media_ids = [
        media_id for media_id in {*photo_media_ids, *document_media_ids} if media_id is not None
    ]
    if not media_ids:
        return []
    return list(
        await session.scalars(
            select(MediaObject.object_key).where(
                MediaObject.tenant_id == user.tenant_id,
                MediaObject.id.in_(media_ids),
                MediaObject.status == MediaStatus.ready,
            )
        )
    )


async def erase_tenant_user_media(
    storage: ObjectStorage,
    *,
    tenant_id: UUID,
    keys: list[str],
) -> None:
    """Physically remove personal pet files before their database records are anonymized."""

    for key in keys:
        await storage.delete(key, tenant_id=tenant_id)


async def anonymize_tenant_user(session: AsyncSession, user: TenantUser) -> None:
    """Удалить прямые и чувствительные данные профиля, не нарушая обязательный учёт."""

    now = datetime.now(UTC)
    pet_ids = list(
        await session.scalars(
            select(Pet.id).where(
                Pet.tenant_id == user.tenant_id,
                Pet.owner_id == user.id,
            )
        )
    )
    media_ids: list[UUID] = []
    if pet_ids:
        photo_media_ids = list(
            await session.scalars(
                select(PetPhoto.media_object_id).where(
                    PetPhoto.tenant_id == user.tenant_id,
                    PetPhoto.pet_id.in_(pet_ids),
                )
            )
        )
        document_media_ids = list(
            await session.scalars(
                select(PetDocument.media_object_id).where(
                    PetDocument.tenant_id == user.tenant_id,
                    PetDocument.pet_id.in_(pet_ids),
                )
            )
        )
        media_ids = [
            media_id for media_id in {*photo_media_ids, *document_media_ids} if media_id is not None
        ]
        await session.execute(
            delete(PetPhoto).where(
                PetPhoto.tenant_id == user.tenant_id,
                PetPhoto.pet_id.in_(pet_ids),
            )
        )
        await session.execute(
            delete(PetDocument).where(
                PetDocument.tenant_id == user.tenant_id,
                PetDocument.pet_id.in_(pet_ids),
            )
        )
        await session.execute(
            update(Pet)
            .where(Pet.tenant_id == user.tenant_id, Pet.id.in_(pet_ids))
            .values(
                name="Удалённый питомец",
                species=None,
                breed=None,
                birth_date=None,
                weight_kg=None,
                coat_type=None,
                temperament=None,
                allergies=None,
                medical_notes=None,
                vaccinated_until=None,
                archived_at=now,
            )
        )
    if media_ids:
        await session.execute(
            update(MediaObject)
            .where(
                MediaObject.tenant_id == user.tenant_id,
                MediaObject.id.in_(media_ids),
            )
            .values(
                status=MediaStatus.deleted,
                public_url=None,
                deleted_at=now,
                original_filename=None,
                checksum_sha256=None,
            )
        )
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
