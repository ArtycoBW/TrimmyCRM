"""Журналирование в JSON со связкой запросов и скрытием секретов."""

from __future__ import annotations

import contextvars
import json
import logging
import re
import sys
import time
import uuid
from collections.abc import Mapping
from datetime import UTC, datetime
from typing import Any

from starlette.types import ASGIApp, Message, Receive, Scope, Send

_request_id: contextvars.ContextVar[str | None] = contextvars.ContextVar("request_id", default=None)
_tenant_id: contextvars.ContextVar[str | None] = contextvars.ContextVar(
    "logging_tenant_id", default=None
)
_SAFE_REQUEST_ID = re.compile(r"^[A-Za-z0-9._-]{1,64}$")
_SENSITIVE_KEYS = frozenset(
    {
        "authorization",
        "cookie",
        "set-cookie",
        "password",
        "passwordconfirm",
        "oldpassword",
        "newpassword",
        "token",
        "accesstoken",
        "refreshtoken",
        "secret",
        "api_key",
        "apikey",
        "card",
    }
)
_NORMALIZED_SENSITIVE_KEYS = frozenset(
    item.replace("-", "").replace("_", "") for item in _SENSITIVE_KEYS
)
_SECRET_TEXT_PATTERNS = (
    re.compile(r"(?i)((?:password|secret|token|authorization|cookie)\s*[=:]\s*)[^\s,;]+"),
    re.compile(r"(https://api\.telegram\.org/bot)[^/\s]+", re.IGNORECASE),
    re.compile(r"(\b)eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b"),
    re.compile(r"([a-z][a-z0-9+.-]*://[^:/\s]+:)[^@/\s]+@", re.IGNORECASE),
)


def get_request_id() -> str | None:
    return _request_id.get()


def set_logging_tenant(tenant_id: str | None) -> contextvars.Token[str | None]:
    return _tenant_id.set(tenant_id)


def reset_logging_tenant(token: contextvars.Token[str | None]) -> None:
    _tenant_id.reset(token)


class JSONFormatter(logging.Formatter):
    def format(self, record: logging.LogRecord) -> str:
        payload: dict[str, Any] = {
            "timestamp": datetime.now(UTC).isoformat(),
            "level": record.levelname.lower(),
            "logger": record.name,
            "message": record.getMessage(),
        }
        request_id = getattr(record, "request_id", None) or get_request_id()
        tenant_id = getattr(record, "tenant_id", None) or _tenant_id.get()
        if request_id:
            payload["request_id"] = request_id
        if tenant_id:
            payload["tenant_id"] = tenant_id
        for name in ("method", "path", "status_code", "duration_ms", "event", "user_id"):
            value = getattr(record, name, None)
            if value is not None:
                payload[name] = value
        if record.exc_info:
            # Трассировки нужны в серверном журнале, но сообщения исключений могут
            # содержать данные провайдера. Секреты скрываются в сериализованной строке.
            payload["exception"] = _redact_text(self.formatException(record.exc_info))
        return json.dumps(redact(payload), ensure_ascii=False, default=str)


def configure_logging(*, debug: bool = False) -> None:
    handler = logging.StreamHandler(sys.stdout)
    handler.setFormatter(JSONFormatter())
    root = logging.getLogger()
    root.handlers.clear()
    root.addHandler(handler)
    root.setLevel(logging.DEBUG if debug else logging.INFO)
    for noisy in ("httpcore", "httpx", "botocore", "boto3"):
        logging.getLogger(noisy).setLevel(logging.WARNING)


def redact(value: Any, *, key: str | None = None) -> Any:
    normalized_key = (key or "").replace("-", "").replace("_", "").casefold()
    if normalized_key in _NORMALIZED_SENSITIVE_KEYS:
        return "[REDACTED]"
    if isinstance(value, Mapping):
        return {str(k): redact(v, key=str(k)) for k, v in value.items()}
    if isinstance(value, (list, tuple)):
        return [redact(item) for item in value]
    return value


def _redact_text(value: str) -> str:
    result = value
    for pattern in _SECRET_TEXT_PATTERNS:
        result = pattern.sub(r"\1[REDACTED]", result)
    return result


class RequestContextMiddleware:
    """Небольшой чистый ASGI-компонент, охватывающий также ответы с исключениями."""

    def __init__(self, app: ASGIApp) -> None:
        self.app = app
        self.logger = logging.getLogger("trimmycrm.request")

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return
        headers = {k.decode("latin1").lower(): v.decode("latin1") for k, v in scope["headers"]}
        supplied = headers.get("x-request-id", "")
        request_id = supplied if _SAFE_REQUEST_ID.fullmatch(supplied) else str(uuid.uuid4())
        token = _request_id.set(request_id)
        started = time.perf_counter()
        status_code = 500

        async def send_with_context(message: Message) -> None:
            nonlocal status_code
            if message["type"] == "http.response.start":
                status_code = int(message["status"])
                response_headers = list(message.get("headers", []))
                response_headers.append((b"x-request-id", request_id.encode("ascii")))
                message["headers"] = response_headers
            await send(message)

        try:
            await self.app(scope, receive, send_with_context)
        finally:
            duration_ms = round((time.perf_counter() - started) * 1000, 2)
            self.logger.info(
                "request_completed",
                extra={
                    "method": scope.get("method"),
                    "path": scope.get("path"),
                    "status_code": status_code,
                    "duration_ms": duration_ms,
                },
            )
            _request_id.reset(token)
