"""Безопасные для тенантов эндпоинты загрузки, выдачи и удаления медиафайлов."""

from __future__ import annotations

import hashlib
from collections.abc import AsyncIterator
from datetime import UTC, datetime
from typing import Annotated, Literal, cast
from uuid import UUID, uuid4

from fastapi import APIRouter, Depends, File, Form, Request, Response, UploadFile, status
from fastapi.responses import StreamingResponse
from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import (
    TenantContext,
    actor_tenant_db,
    actor_tenant_id,
    require_crm_actor,
    require_owner,
    settings_dep,
    tenant_context,
    tenant_db,
)
from app.core.config import Settings
from app.core.errors import (
    BadRequestError,
    NotFoundError,
    ServiceUnavailableError,
)
from app.integrations.storage import (
    ObjectStorage,
    ScannerUnavailable,
    StorageError,
    StoredObject,
    UploadRejected,
)
from app.models import (
    MediaKind,
    MediaObject,
    MediaStatus,
    PlatformUser,
    Site,
    Staff,
)
from app.schemas import MediaView

router = APIRouter(tags=["Media"])

MediaPurpose = Literal["logo", "gallery", "staff"]
PUBLIC_PURPOSES = frozenset({"logo", "gallery", "staff"})
IMAGE_CONTENT_TYPES = frozenset({"image/jpeg", "image/png", "image/webp"})
_READ_CHUNK_SIZE = 64 * 1024


def normalize_content_type(value: str | None) -> str:
    """Нормализовать MIME-тип multipart, не определяя его по имени файла."""

    normalized = (value or "").split(";", 1)[0].strip().lower()
    if not normalized:
        raise UploadRejected("file MIME type is required")
    return normalized


def validate_media_target(purpose: str, target_id: UUID | None) -> MediaPurpose:
    """Проверить правила привязки при обычной загрузке медиафайла салона."""

    if purpose not in {"logo", "gallery", "staff"}:
        raise UploadRejected("unsupported media purpose")
    if purpose == "staff" and target_id is None:
        raise UploadRejected("targetId is required for a staff photo")
    if purpose != "staff" and target_id is not None:
        raise UploadRejected("targetId is only allowed for a staff photo")
    return cast(MediaPurpose, purpose)


def is_public_purpose(value: object) -> bool:
    """Вернуть истину только для медиафайла, предназначенного для публичного блока."""

    return isinstance(value, str) and value in PUBLIC_PURPOSES


def media_api_path(api_prefix: str, media_id: UUID, *, public: bool) -> str:
    prefix = "/" + api_prefix.strip("/") if api_prefix.strip("/") else ""
    scope = "public/media" if public else "media"
    return f"{prefix}/{scope}/{media_id}"


async def _read_upload_bounded(upload: UploadFile, max_bytes: int) -> bytes:
    """Прочитать из multipart-загрузки не более ``max_bytes + 1`` байт."""

    if upload.size is not None and upload.size > max_bytes:
        raise UploadRejected(f"file size must be within 1..{max_bytes} bytes")
    chunks: list[bytes] = []
    size = 0
    while True:
        chunk = await upload.read(min(_READ_CHUNK_SIZE, max_bytes - size + 1))
        if not chunk:
            break
        chunks.append(chunk)
        size += len(chunk)
        if size > max_bytes:
            raise UploadRejected(f"file size must be within 1..{max_bytes} bytes")
    if size == 0:
        raise UploadRejected(f"file size must be within 1..{max_bytes} bytes")
    return b"".join(chunks)


def _storage(request: Request) -> ObjectStorage:
    value = getattr(request.app.state, "storage", None)
    if value is None:
        raise ServiceUnavailableError(
            "Хранилище медиа временно недоступно",
            code="media_storage_unavailable",
        )
    return cast(ObjectStorage, value)


async def _validated_upload(
    upload: UploadFile,
    *,
    tenant_id: UUID,
    storage: ObjectStorage,
    settings: Settings,
    allowed_content_types: frozenset[str],
) -> tuple[str, bytes, StoredObject]:
    filename = upload.filename or "upload"
    try:
        content_type = normalize_content_type(upload.content_type)
        if content_type not in allowed_content_types:
            raise UploadRejected("file MIME type is not allowed for this upload")
        content = await _read_upload_bounded(upload, settings.upload_max_bytes)
        stored = await storage.upload(
            tenant_id=tenant_id,
            filename=filename,
            content_type=content_type,
            content=content,
        )
    except UploadRejected as exc:
        raise BadRequestError(str(exc), code="invalid_media") from exc
    except ScannerUnavailable as exc:
        raise ServiceUnavailableError(
            "Проверка файла временно недоступна",
            code="media_scan_unavailable",
        ) from exc
    except StorageError as exc:
        raise ServiceUnavailableError(
            "Хранилище медиа временно недоступно",
            code="media_storage_unavailable",
        ) from exc
    return filename, content, stored


async def _remove_stored_object(storage: ObjectStorage, *, key: str, tenant_id: UUID) -> None:
    try:
        await storage.delete(key, tenant_id=tenant_id)
    except (StorageError, ValueError) as exc:
        raise ServiceUnavailableError(
            "Хранилище медиа временно недоступно",
            code="media_storage_unavailable",
        ) from exc


async def _discard_after_failed_insert(
    storage: ObjectStorage, *, key: str, tenant_id: UUID
) -> None:
    """По возможности компенсировать объект после ошибки вставки в БД."""

    try:
        await storage.delete(key, tenant_id=tenant_id)
    except (StorageError, ValueError):
        # Сохраняем исходное исключение БД. Объект без ссылки сможет удалить
        # задача сверки хранилища.
        pass


def _new_media(
    *,
    media_id: UUID,
    tenant_id: UUID,
    bucket: str,
    key: str,
    filename: str,
    content_type: str,
    content: bytes,
    size: int,
    platform_user_id: UUID | None = None,
    tenant_user_id: UUID | None = None,
    public_url: str | None = None,
    metadata: dict[str, object],
    kind: MediaKind = MediaKind.image,
) -> MediaObject:
    return MediaObject(
        id=media_id,
        tenant_id=tenant_id,
        bucket=bucket,
        object_key=key,
        original_filename=filename,
        content_type=content_type,
        size_bytes=size,
        checksum_sha256=hashlib.sha256(content).hexdigest(),
        kind=kind,
        status=MediaStatus.ready,
        uploaded_by_platform_user_id=platform_user_id,
        uploaded_by_tenant_user_id=tenant_user_id,
        public_url=public_url,
        metadata_json=metadata,
    )


@router.post("/media", response_model=MediaView, status_code=status.HTTP_201_CREATED)
async def upload_salon_media(
    request: Request,
    file: Annotated[UploadFile, File(description="JPEG, PNG or WebP image")],
    purpose: Annotated[str, Form()],
    target_id: Annotated[UUID | None, Form(alias="targetId")] = None,
    owner: PlatformUser = Depends(require_owner),
    tenant_id: UUID = Depends(actor_tenant_id),
    session: AsyncSession = Depends(actor_tenant_db, scope="function"),
    settings: Settings = Depends(settings_dep),
) -> MediaView:
    try:
        validated_purpose = validate_media_target(purpose, target_id)
    except UploadRejected as exc:
        raise BadRequestError(str(exc), code="invalid_media_target") from exc

    target_staff: Staff | None = None
    if validated_purpose == "staff":
        target_staff = await session.scalar(
            select(Staff).where(Staff.tenant_id == tenant_id, Staff.id == target_id)
        )
        if target_staff is None:
            raise NotFoundError("Мастер не найден")

    storage = _storage(request)
    try:
        filename, content, stored_value = await _validated_upload(
            file,
            tenant_id=tenant_id,
            storage=storage,
            settings=settings,
            allowed_content_types=IMAGE_CONTENT_TYPES,
        )
    finally:
        await file.close()
    stored = stored_value
    media_id = uuid4()
    public = is_public_purpose(validated_purpose)
    url = media_api_path(settings.api_v1_prefix, media_id, public=public)
    metadata: dict[str, object] = {"purpose": validated_purpose}
    if target_id is not None:
        metadata["target_id"] = str(target_id)
    media = _new_media(
        media_id=media_id,
        tenant_id=tenant_id,
        bucket=settings.s3_bucket,
        key=stored.key,
        filename=filename,
        content_type=stored.content_type,
        content=content,
        size=stored.size,
        platform_user_id=owner.id,
        public_url=url if public else None,
        metadata=metadata,
    )
    session.add(media)
    if validated_purpose == "logo":
        site = await session.scalar(select(Site).where(Site.id == tenant_id).with_for_update())
        if site is None:
            await _discard_after_failed_insert(storage, key=stored.key, tenant_id=tenant_id)
            raise NotFoundError("Салон не найден")
        site.logo_url = url
    elif target_staff is not None:
        target_staff.photo_url = url
    try:
        await session.flush()
    except Exception:
        await _discard_after_failed_insert(storage, key=stored.key, tenant_id=tenant_id)
        raise
    return MediaView.model_validate(
        {
            "id": media.id,
            "url": url,
            "purpose": validated_purpose,
            "is_public": public,
            "content_type": media.content_type,
            "size_bytes": media.size_bytes,
            "created_at": media.created_at,
        }
    )


@router.get("/media/{media_id}")
async def get_private_salon_media(
    media_id: UUID,
    request: Request,
    _actor: PlatformUser = Depends(require_crm_actor),
    tenant_id: UUID = Depends(actor_tenant_id),
    session: AsyncSession = Depends(actor_tenant_db, scope="function"),
) -> StreamingResponse:
    media = await session.scalar(
        select(MediaObject).where(
            MediaObject.tenant_id == tenant_id,
            MediaObject.id == media_id,
            MediaObject.status == MediaStatus.ready,
        )
    )
    if media is None:
        raise NotFoundError("Медиафайл не найден")
    return await _proxy_response(_storage(request), media=media, tenant_id=tenant_id, public=False)


@router.get("/public/media/{media_id}")
async def get_public_salon_media(
    media_id: UUID,
    request: Request,
    context: TenantContext = Depends(tenant_context),
    session: AsyncSession = Depends(tenant_db, scope="function"),
) -> StreamingResponse:
    media = await session.scalar(
        select(MediaObject).where(
            MediaObject.tenant_id == context.id,
            MediaObject.id == media_id,
            MediaObject.status == MediaStatus.ready,
            MediaObject.public_url.is_not(None),
        )
    )
    if media is None or not is_public_purpose(media.metadata_json.get("purpose")):
        # Намеренно неотличимо от отсутствующего объекта: вызывающая сторона
        # не должна иметь возможность перебирать идентификаторы приватных медиа.
        raise NotFoundError("Медиафайл не найден")
    return await _proxy_response(_storage(request), media=media, tenant_id=context.id, public=True)


@router.delete("/media/{media_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_salon_media(
    media_id: UUID,
    request: Request,
    _owner: PlatformUser = Depends(require_owner),
    tenant_id: UUID = Depends(actor_tenant_id),
    session: AsyncSession = Depends(actor_tenant_db, scope="function"),
    settings: Settings = Depends(settings_dep),
) -> Response:
    media = await session.scalar(
        select(MediaObject)
        .where(
            MediaObject.tenant_id == tenant_id,
            MediaObject.id == media_id,
            MediaObject.status == MediaStatus.ready,
        )
        .with_for_update()
    )
    if media is None:
        raise NotFoundError("Медиафайл не найден")
    purpose = media.metadata_json.get("purpose")
    if purpose not in {"logo", "gallery", "staff"}:
        raise NotFoundError("Медиафайл не найден")
    await _remove_stored_object(_storage(request), key=media.object_key, tenant_id=tenant_id)
    old_url = media.public_url or media_api_path(settings.api_v1_prefix, media.id, public=False)
    target_id = media.metadata_json.get("target_id")
    if purpose == "logo":
        await session.execute(
            update(Site).where(Site.id == tenant_id, Site.logo_url == old_url).values(logo_url=None)
        )
    elif purpose == "staff" and isinstance(target_id, str):
        try:
            staff_id = UUID(target_id)
        except ValueError:
            staff_id = None
        if staff_id is not None:
            await session.execute(
                update(Staff)
                .where(
                    Staff.tenant_id == tenant_id,
                    Staff.id == staff_id,
                    Staff.photo_url == old_url,
                )
                .values(photo_url=None)
            )
    now = datetime.now(UTC)
    media.status = MediaStatus.deleted
    media.deleted_at = now
    media.public_url = None
    media.metadata_json = {**media.metadata_json, "deleted_at": now.isoformat()}
    await session.flush()
    return Response(status_code=status.HTTP_204_NO_CONTENT)


async def _proxy_response(
    storage: ObjectStorage,
    *,
    media: MediaObject,
    tenant_id: UUID,
    public: bool,
) -> StreamingResponse:
    try:
        downloaded = await storage.download(media.object_key, tenant_id=tenant_id)
    except UploadRejected as exc:
        raise ServiceUnavailableError(
            "Медиафайл временно недоступен", code="media_object_invalid"
        ) from exc
    except (StorageError, ValueError) as exc:
        raise ServiceUnavailableError(
            "Хранилище медиа временно недоступно",
            code="media_storage_unavailable",
        ) from exc
    checksum_matches = (
        media.checksum_sha256 is None
        or hashlib.sha256(downloaded.content).hexdigest() == media.checksum_sha256
    )
    if (
        downloaded.size != media.size_bytes
        or downloaded.content_type != media.content_type
        or not checksum_matches
    ):
        raise ServiceUnavailableError("Медиафайл временно недоступен", code="media_object_invalid")
    headers = {
        "Content-Length": str(downloaded.size),
        "Cache-Control": ("public, max-age=86400" if public else "private, no-store"),
        "X-Content-Type-Options": "nosniff",
    }
    if downloaded.etag:
        headers["ETag"] = f'"{downloaded.etag}"'
    return StreamingResponse(
        _iter_chunks(downloaded.content),
        media_type=media.content_type,
        headers=headers,
    )


async def _iter_chunks(content: bytes) -> AsyncIterator[bytes]:
    for offset in range(0, len(content), _READ_CHUNK_SIZE):
        yield content[offset : offset + _READ_CHUNK_SIZE]
