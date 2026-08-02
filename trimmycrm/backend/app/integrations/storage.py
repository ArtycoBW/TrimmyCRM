"""Приватное хранилище медиафайлов S3 с карантином и проверкой ClamAV."""

from __future__ import annotations

import asyncio
import struct
import uuid
from dataclasses import dataclass
from enum import StrEnum
from pathlib import PurePath
from typing import Any, Protocol

from botocore.exceptions import BotoCoreError, ClientError  # type: ignore[import-untyped]

from app.core.config import Settings


class StorageError(RuntimeError):
    pass


class UploadRejected(ValueError):
    pass


class MalwareDetected(UploadRejected):
    pass


class ScannerUnavailable(StorageError):
    pass


class ScanStatus(StrEnum):
    CLEAN = "clean"
    INFECTED = "infected"


@dataclass(frozen=True, slots=True)
class ScanResult:
    status: ScanStatus
    signature: str | None = None


class MalwareScanner(Protocol):
    async def scan(self, content: bytes) -> ScanResult: ...


class ClamAVScanner:
    """Минимальная реализация протокола INSTREAM clamd с префиксом длины."""

    def __init__(
        self,
        host: str,
        port: int = 3310,
        *,
        timeout_seconds: float = 15.0,
        chunk_size: int = 64 * 1024,
    ) -> None:
        if not host:
            raise ValueError("ClamAV host is required")
        self.host = host
        self.port = port
        self.timeout = timeout_seconds
        self.chunk_size = chunk_size

    async def scan(self, content: bytes) -> ScanResult:
        async def operation() -> ScanResult:
            reader, writer = await asyncio.open_connection(self.host, self.port)
            try:
                writer.write(b"zINSTREAM\0")
                for offset in range(0, len(content), self.chunk_size):
                    chunk = content[offset : offset + self.chunk_size]
                    writer.write(struct.pack("!I", len(chunk)))
                    writer.write(chunk)
                    await writer.drain()
                writer.write(struct.pack("!I", 0))
                await writer.drain()
                response = await reader.readuntil(b"\0")
            finally:
                writer.close()
                await writer.wait_closed()
            text = response.rstrip(b"\0").decode("utf-8", errors="replace")
            if text.endswith(" OK"):
                return ScanResult(ScanStatus.CLEAN)
            if text.endswith(" FOUND"):
                signature = text.rsplit(": ", 1)[-1].removesuffix(" FOUND")
                return ScanResult(ScanStatus.INFECTED, signature=signature)
            raise ScannerUnavailable("ClamAV returned an indeterminate result")

        try:
            return await asyncio.wait_for(operation(), timeout=self.timeout)
        except (TimeoutError, OSError, asyncio.IncompleteReadError) as exc:
            raise ScannerUnavailable("ClamAV is unavailable") from exc


class DevelopmentNoopScanner:
    """Явный обход сканера для локальной среды и тестов."""

    def __init__(self, environment: str) -> None:
        if environment not in {"development", "test"}:
            raise ValueError("noop malware scanner is development/test only")

    async def scan(self, content: bytes) -> ScanResult:
        del content
        return ScanResult(ScanStatus.CLEAN)


@dataclass(frozen=True, slots=True)
class UploadPolicy:
    max_bytes: int
    allowed_mime_types: frozenset[str]

    def validate(self, *, filename: str, content_type: str, size: int) -> None:
        _validate_filename(filename)
        if size < 1 or size > self.max_bytes:
            raise UploadRejected(f"file size must be within 1..{self.max_bytes} bytes")
        if content_type not in self.allowed_mime_types:
            raise UploadRejected("file MIME type is not allowed")


@dataclass(frozen=True, slots=True)
class PresignedUpload:
    key: str
    url: str
    fields: dict[str, str]
    expires_in: int


@dataclass(frozen=True, slots=True)
class StoredObject:
    key: str
    content_type: str
    size: int
    etag: str | None = None


@dataclass(frozen=True, slots=True)
class StoredDownload:
    """Объект с ограниченным размером, полученный для проксирования через API.

    Медиафайлы этого сервиса намеренно малы: ``UploadPolicy`` применяется и при
    чтении. Поэтому буферизация ограниченного объекта не связывает время жизни
    ответа S3 с FastAPI, но позволяет слою HTTP передавать полученные байты
    вызывающей стороне в потоковом режиме.
    """

    content: bytes
    content_type: str
    size: int
    etag: str | None = None


class ObjectStorage(Protocol):
    async def create_upload(
        self,
        *,
        tenant_id: uuid.UUID,
        filename: str,
        content_type: str,
        size: int,
    ) -> PresignedUpload: ...

    async def finalize_upload(
        self, *, tenant_id: uuid.UUID, quarantine_key: str
    ) -> StoredObject: ...

    async def upload(
        self,
        *,
        tenant_id: uuid.UUID,
        filename: str,
        content_type: str,
        content: bytes,
    ) -> StoredObject: ...

    async def presigned_download(self, key: str, *, expires_in: int = 300) -> str: ...

    async def download(self, key: str, *, tenant_id: uuid.UUID) -> StoredDownload: ...

    async def delete(self, key: str, *, tenant_id: uuid.UUID) -> None: ...


class S3MediaStorage:
    """Приватное S3-совместимое хранилище медиафайлов.

    Загрузки из браузера попадают в ``quarantine/``. Метод ``finalize_upload``
    проверяет фактический размер и MIME-тип, сканирует байты, затем копирует объект
    в ``media/``. Вызывающая сторона никогда не должна сохранять или раскрывать
    карантинный ключ как URL клиентского изображения или логотипа.
    """

    def __init__(
        self,
        *,
        bucket: str,
        endpoint_url: str,
        region: str,
        access_key: str,
        secret_key: str,
        scanner: MalwareScanner,
        policy: UploadPolicy,
        presign_ttl_seconds: int = 600,
        scan_fail_closed: bool = True,
        client: Any | None = None,
    ) -> None:
        if not bucket or not access_key or not secret_key:
            raise ValueError("S3 bucket and credentials are required")
        if client is None:
            import boto3  # type: ignore[import-untyped]

            client = boto3.client(
                "s3",
                endpoint_url=endpoint_url,
                region_name=region,
                aws_access_key_id=access_key,
                aws_secret_access_key=secret_key,
            )
        self.client = client
        self.bucket = bucket
        self.scanner = scanner
        self.policy = policy
        self.presign_ttl = presign_ttl_seconds
        self.scan_fail_closed = scan_fail_closed

    async def create_upload(
        self,
        *,
        tenant_id: uuid.UUID,
        filename: str,
        content_type: str,
        size: int,
    ) -> PresignedUpload:
        self.policy.validate(filename=filename, content_type=content_type, size=size)
        extension = _extension_for_mime(content_type)
        key = f"quarantine/{tenant_id}/{uuid.uuid4().hex}{extension}"
        try:
            result = await asyncio.to_thread(
                self.client.generate_presigned_post,
                Bucket=self.bucket,
                Key=key,
                Fields={
                    "Content-Type": content_type,
                    "x-amz-meta-declared-size": str(size),
                },
                Conditions=[
                    {"Content-Type": content_type},
                    {"x-amz-meta-declared-size": str(size)},
                    ["content-length-range", 1, min(size, self.policy.max_bytes)],
                ],
                ExpiresIn=self.presign_ttl,
            )
        except (BotoCoreError, ClientError, OSError) as exc:
            raise StorageError("could not create upload URL") from exc
        return PresignedUpload(
            key=key,
            url=str(result["url"]),
            fields={str(k): str(v) for k, v in result["fields"].items()},
            expires_in=self.presign_ttl,
        )

    async def finalize_upload(self, *, tenant_id: uuid.UUID, quarantine_key: str) -> StoredObject:
        prefix = f"quarantine/{tenant_id}/"
        if not quarantine_key.startswith(prefix) or not _safe_object_key(quarantine_key):
            raise UploadRejected("invalid quarantine object key")
        try:
            head = await asyncio.to_thread(
                self.client.head_object,
                Bucket=self.bucket,
                Key=quarantine_key,
            )
            size = int(head["ContentLength"])
            content_type = str(head.get("ContentType") or "application/octet-stream")
            declared_size = int((head.get("Metadata") or {}).get("declared-size", size))
        except (BotoCoreError, ClientError, KeyError, TypeError, ValueError, OSError) as exc:
            raise StorageError("could not inspect uploaded object") from exc
        filename = PurePath(quarantine_key).name
        try:
            self.policy.validate(filename=filename, content_type=content_type, size=size)
            if declared_size != size:
                raise UploadRejected("uploaded size differs from declared size")
            content = await self._download_bounded(quarantine_key)
            _verify_magic(content, content_type)
            await self._scan(content)
        except UploadRejected:
            await self._delete_unchecked(quarantine_key)
            raise

        # Детерминированное перемещение обеспечивает идемпотентность повторов,
        # если копирование завершилось, а удаление карантинного объекта — нет.
        final_key = f"media/{tenant_id}/{PurePath(quarantine_key).name}"
        try:
            await asyncio.to_thread(
                self.client.copy_object,
                Bucket=self.bucket,
                Key=final_key,
                CopySource={"Bucket": self.bucket, "Key": quarantine_key},
                ContentType=content_type,
                MetadataDirective="REPLACE",
                Metadata={"scanned": "clamav"},
            )
            await self._delete_unchecked(quarantine_key)
            final_head = await asyncio.to_thread(
                self.client.head_object, Bucket=self.bucket, Key=final_key
            )
        except (BotoCoreError, ClientError, OSError) as exc:
            # При ошибке копирования карантинный объект остаётся доступен для повтора.
            raise StorageError("could not finalize uploaded object") from exc
        return StoredObject(
            key=final_key,
            content_type=content_type,
            size=size,
            etag=_clean_etag(final_head.get("ETag")),
        )

    async def upload(
        self,
        *,
        tenant_id: uuid.UUID,
        filename: str,
        content_type: str,
        content: bytes,
    ) -> StoredObject:
        self.policy.validate(
            filename=filename,
            content_type=content_type,
            size=len(content),
        )
        _verify_magic(content, content_type)
        await self._scan(content)
        key = f"media/{tenant_id}/{uuid.uuid4().hex}{_extension_for_mime(content_type)}"
        try:
            result = await asyncio.to_thread(
                self.client.put_object,
                Bucket=self.bucket,
                Key=key,
                Body=content,
                ContentType=content_type,
                Metadata={"scanned": "clamav"},
            )
        except (BotoCoreError, ClientError, OSError) as exc:
            raise StorageError("could not store uploaded object") from exc
        return StoredObject(
            key=key,
            content_type=content_type,
            size=len(content),
            etag=_clean_etag(result.get("ETag")),
        )

    async def presigned_download(self, key: str, *, expires_in: int = 300) -> str:
        if not key.startswith("media/") or not _safe_object_key(key):
            raise ValueError("invalid media object key")
        if not 1 <= expires_in <= 3600:
            raise ValueError("download URL expiry must be 1..3600 seconds")
        try:
            return str(
                await asyncio.to_thread(
                    self.client.generate_presigned_url,
                    "get_object",
                    Params={"Bucket": self.bucket, "Key": key},
                    ExpiresIn=expires_in,
                )
            )
        except (BotoCoreError, ClientError, OSError) as exc:
            raise StorageError("could not create download URL") from exc

    async def download(self, key: str, *, tenant_id: uuid.UUID) -> StoredDownload:
        """Получить принадлежащий владельцу медиафайл без неограниченного чтения."""

        if not key.startswith(f"media/{tenant_id}/") or not _safe_object_key(key):
            raise ValueError("object does not belong to tenant")
        body: Any | None = None
        response: dict[str, Any] = {}
        try:
            response = await asyncio.to_thread(self.client.get_object, Bucket=self.bucket, Key=key)
            body = response["Body"]
            size = int(response["ContentLength"])
            content_type = str(response.get("ContentType") or "application/octet-stream")
            if size < 1 or size > self.policy.max_bytes:
                raise UploadRejected("stored object size is outside the media policy")
            content = await asyncio.to_thread(body.read, self.policy.max_bytes + 1)
        except UploadRejected:
            raise
        except (BotoCoreError, ClientError, KeyError, TypeError, ValueError, OSError) as exc:
            raise StorageError("could not read stored object") from exc
        finally:
            if body is not None:
                try:
                    body.close()
                except OSError:
                    pass
        payload = bytes(content)
        if len(payload) > self.policy.max_bytes or len(payload) != size:
            raise StorageError("stored object size changed while it was being read")
        return StoredDownload(
            content=payload,
            content_type=content_type,
            size=size,
            etag=_clean_etag(response.get("ETag")),
        )

    async def delete(self, key: str, *, tenant_id: uuid.UUID) -> None:
        allowed = (f"media/{tenant_id}/", f"quarantine/{tenant_id}/")
        if not key.startswith(allowed) or not _safe_object_key(key):
            raise ValueError("object does not belong to tenant")
        await self._delete_unchecked(key)

    async def _download_bounded(self, key: str) -> bytes:
        try:
            response = await asyncio.to_thread(self.client.get_object, Bucket=self.bucket, Key=key)
            body = response["Body"]
            try:
                content = await asyncio.to_thread(body.read, self.policy.max_bytes + 1)
            finally:
                body.close()
        except (BotoCoreError, ClientError, KeyError, OSError) as exc:
            raise StorageError("could not read uploaded object") from exc
        if len(content) > self.policy.max_bytes:
            raise UploadRejected("uploaded object is too large")
        return bytes(content)

    async def _scan(self, content: bytes) -> None:
        try:
            result = await self.scanner.scan(content)
        except ScannerUnavailable:
            if self.scan_fail_closed:
                raise
            return
        if result.status is ScanStatus.INFECTED:
            raise MalwareDetected("malware detected in uploaded file")

    async def _delete_unchecked(self, key: str) -> None:
        try:
            await asyncio.to_thread(self.client.delete_object, Bucket=self.bucket, Key=key)
        except (BotoCoreError, ClientError, OSError) as exc:
            raise StorageError("could not delete object") from exc


def build_object_storage(settings: Settings) -> ObjectStorage:
    if not settings.s3_access_key or not settings.s3_secret_key:
        raise ValueError("S3 credentials are not configured")
    scanner: MalwareScanner
    if settings.is_development and not settings.malware_scan_fail_closed:
        # Локальный профиль Compose может явно отказаться от проверки, не ожидая
        # тайм-аута подключения к намеренно отсутствующему контейнеру ClamAV.
        scanner = DevelopmentNoopScanner(settings.environment)
    elif settings.clamav_host:
        scanner = ClamAVScanner(
            settings.clamav_host,
            settings.clamav_port,
            timeout_seconds=settings.clamav_timeout_seconds,
        )
    else:
        scanner = DevelopmentNoopScanner(settings.environment)
    return S3MediaStorage(
        bucket=settings.s3_bucket,
        endpoint_url=str(settings.s3_endpoint_url),
        region=settings.s3_region,
        access_key=settings.s3_access_key.get_secret_value(),
        secret_key=settings.s3_secret_key.get_secret_value(),
        scanner=scanner,
        policy=UploadPolicy(
            max_bytes=settings.upload_max_bytes,
            allowed_mime_types=frozenset(settings.upload_allowed_mime_types),
        ),
        presign_ttl_seconds=settings.s3_presign_ttl_seconds,
        scan_fail_closed=settings.malware_scan_fail_closed,
    )


def _validate_filename(filename: str) -> None:
    if (
        not filename
        or len(filename) > 255
        or PurePath(filename).name != filename
        or "\\" in filename
        or any(ord(char) < 32 for char in filename)
    ):
        raise UploadRejected("invalid filename")


def _safe_object_key(key: str) -> bool:
    return (
        1 <= len(key) <= 1024
        and not key.startswith("/")
        and "\\" not in key
        and all(part not in {"", ".", ".."} for part in key.split("/"))
        and not any(ord(char) < 32 for char in key)
    )


def _extension_for_mime(content_type: str) -> str:
    try:
        return {
            "image/jpeg": ".jpg",
            "image/png": ".png",
            "image/webp": ".webp",
            "application/pdf": ".pdf",
        }[content_type]
    except KeyError as exc:
        raise UploadRejected("unsupported media MIME type") from exc


def _verify_magic(content: bytes, content_type: str) -> None:
    valid = False
    if content_type == "image/jpeg":
        valid = (
            len(content) >= 4
            and content.startswith(b"\xff\xd8\xff")
            and content.endswith(b"\xff\xd9")
        )
    elif content_type == "image/png":
        valid = content.startswith(b"\x89PNG\r\n\x1a\n")
    elif content_type == "image/webp":
        valid = len(content) >= 12 and content[:4] == b"RIFF" and content[8:12] == b"WEBP"
    elif content_type == "application/pdf":
        valid = content.startswith(b"%PDF-") and b"%%EOF" in content[-1024:]
    if not valid:
        raise UploadRejected("file content does not match declared MIME type")


def _clean_etag(value: Any) -> str | None:
    return str(value).strip('"') if value else None
