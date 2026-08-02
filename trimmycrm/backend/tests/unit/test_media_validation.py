from __future__ import annotations

import os
from uuid import UUID

import pytest

# Импорт зависимостей API создает движки SQLAlchemy, но не открывает подключения.
os.environ.setdefault(
    "DATABASE_URL", "postgresql+asyncpg://trimmycrm:trimmycrm@localhost/trimmycrm_test"
)

from app.api.routes.media import (  # noqa: E402
    is_public_purpose,
    media_api_path,
    normalize_content_type,
    validate_media_target,
)
from app.integrations.storage import (  # noqa: E402
    UploadPolicy,
    UploadRejected,
    _safe_object_key,
    _verify_magic,
)


def test_upload_policy_rejects_paths_mime_and_size() -> None:
    policy = UploadPolicy(
        max_bytes=16,
        allowed_mime_types=frozenset({"image/png"}),
    )
    policy.validate(filename="portrait.png", content_type="image/png", size=16)

    with pytest.raises(UploadRejected):
        policy.validate(filename="../portrait.png", content_type="image/png", size=1)
    with pytest.raises(UploadRejected):
        policy.validate(filename=r"C:\portrait.png", content_type="image/png", size=1)
    with pytest.raises(UploadRejected):
        policy.validate(filename="portrait.png", content_type="image/jpeg", size=1)
    with pytest.raises(UploadRejected):
        policy.validate(filename="portrait.png", content_type="image/png", size=17)


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
    assert not is_public_purpose("private_upload")

    with pytest.raises(UploadRejected):
        validate_media_target("staff", None)
    with pytest.raises(UploadRejected):
        validate_media_target("logo", staff_id)
    with pytest.raises(UploadRejected):
        validate_media_target("avatar", None)


def test_media_paths_never_contain_storage_hostnames() -> None:
    media_id = UUID("aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa")
    assert media_api_path("/api/v1", media_id, public=True) == (f"/api/v1/public/media/{media_id}")


def test_content_type_normalization_does_not_guess() -> None:
    assert normalize_content_type(" Image/PNG; charset=binary ") == "image/png"
    with pytest.raises(UploadRejected):
        normalize_content_type(None)
