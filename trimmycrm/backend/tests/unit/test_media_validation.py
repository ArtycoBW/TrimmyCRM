from __future__ import annotations

import os
from uuid import UUID

import pytest

# Импорт зависимостей API создает движки SQLAlchemy, но не открывает подключения.
os.environ.setdefault(
    "DATABASE_URL", "postgresql+asyncpg://trimmycrm:trimmycrm@localhost/trimmycrm_test"
)

from app.api.routes.media import (  # noqa: E402
    _delete_pet_document,
    is_public_purpose,
    media_api_path,
    normalize_content_type,
    pet_document_api_path,
    pet_photo_api_path,
    validate_media_target,
)
from app.integrations.storage import (  # noqa: E402
    UploadPolicy,
    UploadRejected,
    _safe_object_key,
    _verify_magic,
)
from app.models import MediaKind, MediaObject, MediaStatus, PetDocument  # noqa: E402


def test_upload_policy_rejects_paths_mime_and_size() -> None:
    policy = UploadPolicy(
        max_bytes=16,
        allowed_mime_types=frozenset({"image/png"}),
    )
    policy.validate(filename="pet.png", content_type="image/png", size=16)

    with pytest.raises(UploadRejected):
        policy.validate(filename="../pet.png", content_type="image/png", size=1)
    with pytest.raises(UploadRejected):
        policy.validate(filename=r"C:\pet.png", content_type="image/png", size=1)
    with pytest.raises(UploadRejected):
        policy.validate(filename="pet.png", content_type="image/jpeg", size=1)
    with pytest.raises(UploadRejected):
        policy.validate(filename="pet.png", content_type="image/png", size=17)


@pytest.mark.parametrize(
    ("content_type", "content"),
    [
        ("image/jpeg", b"\xff\xd8\xffimage\xff\xd9"),
        ("image/png", b"\x89PNG\r\n\x1a\nimage"),
        ("image/webp", b"RIFF\x04\x00\x00\x00WEBPimage"),
    ],
)
def test_magic_validation_accepts_supported_images(content_type: str, content: bytes) -> None:
    _verify_magic(content, content_type)


def test_magic_validation_accepts_pdf_documents() -> None:
    _verify_magic(b"%PDF-1.7\npassport\n%%EOF", "application/pdf")


def test_magic_validation_rejects_spoofed_mime() -> None:
    with pytest.raises(UploadRejected):
        _verify_magic(b"not a png", "image/png")


def test_object_key_validation_is_path_safe() -> None:
    assert _safe_object_key("media/tenant/object.png")
    assert not _safe_object_key("media/tenant/../object.png")
    assert not _safe_object_key(r"media\tenant\object.png")
    assert not _safe_object_key("/media/tenant/object.png")


def test_media_target_and_publicity_are_explicit() -> None:
    staff_id = UUID("aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa")
    assert validate_media_target("staff", staff_id) == "staff"
    assert validate_media_target("logo", None) == "logo"
    assert is_public_purpose("logo")
    assert is_public_purpose("gallery")
    assert is_public_purpose("staff")
    assert not is_public_purpose("pet_photo")

    with pytest.raises(UploadRejected):
        validate_media_target("staff", None)
    with pytest.raises(UploadRejected):
        validate_media_target("logo", staff_id)
    with pytest.raises(UploadRejected):
        validate_media_target("avatar", None)


def test_media_paths_never_contain_storage_hostnames() -> None:
    media_id = UUID("aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa")
    pet_id = UUID("bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb")
    photo_id = UUID("cccccccc-cccc-4ccc-8ccc-cccccccccccc")
    document_id = UUID("dddddddd-dddd-4ddd-8ddd-dddddddddddd")
    assert media_api_path("/api/v1", media_id, public=True) == (f"/api/v1/public/media/{media_id}")
    assert pet_photo_api_path("api/v1/", pet_id, photo_id) == (
        f"/api/v1/pets/{pet_id}/photos/{photo_id}/content"
    )
    assert pet_document_api_path("api/v1/", pet_id, document_id) == (
        f"/api/v1/pets/{pet_id}/documents/{document_id}/content"
    )


def test_content_type_normalization_does_not_guess() -> None:
    assert normalize_content_type(" Image/PNG; charset=binary ") == "image/png"
    with pytest.raises(UploadRejected):
        normalize_content_type(None)


class _RecordingStorage:
    def __init__(self) -> None:
        self.deleted: list[tuple[str, UUID]] = []

    async def delete(self, key: str, *, tenant_id: UUID) -> None:
        self.deleted.append((key, tenant_id))


class _RecordingSession:
    def __init__(self) -> None:
        self.deleted: list[object] = []
        self.flushed = False

    async def delete(self, row: object) -> None:
        self.deleted.append(row)

    async def flush(self) -> None:
        self.flushed = True


@pytest.mark.asyncio
async def test_pet_document_deletion_erases_file_and_unlinks_document() -> None:
    tenant_id = UUID("11111111-1111-4111-8111-111111111111")
    pet_id = UUID("bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb")
    media_id = UUID("cccccccc-cccc-4ccc-8ccc-cccccccccccc")
    document = PetDocument(
        id=UUID("dddddddd-dddd-4ddd-8ddd-dddddddddddd"),
        tenant_id=tenant_id,
        pet_id=pet_id,
        media_object_id=media_id,
        document_type="passport",
        original_filename="passport.pdf",
        url="/api/v1/pets/document/content",
    )
    media = MediaObject(
        id=media_id,
        tenant_id=tenant_id,
        bucket="private",
        object_key=f"media/{tenant_id}/passport.pdf",
        original_filename="passport.pdf",
        content_type="application/pdf",
        size_bytes=12,
        checksum_sha256="checksum",
        kind=MediaKind.document,
        status=MediaStatus.ready,
        metadata_json={"purpose": "pet_document"},
    )
    storage = _RecordingStorage()
    session = _RecordingSession()

    await _delete_pet_document(
        session,  # type: ignore[arg-type]
        storage=storage,  # type: ignore[arg-type]
        tenant_id=tenant_id,
        document=document,
        media=media,
    )

    assert storage.deleted == [(media.object_key, tenant_id)]
    assert session.deleted == [document]
    assert session.flushed
    assert media.status is MediaStatus.deleted
    assert media.original_filename is None
    assert media.checksum_sha256 is None
    assert media.metadata_json["deleted_at"]
