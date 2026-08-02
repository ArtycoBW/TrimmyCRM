"""Стабильные публичные ошибки API и обработчики исключений FastAPI."""

from __future__ import annotations

import logging
from collections.abc import Mapping
from http import HTTPStatus
from typing import Any

from fastapi import FastAPI, HTTPException, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse

from app.core.logging import get_request_id
from app.core.security import CSRFError, InvalidTokenError, PasswordPolicyError
from app.core.tenant import InvalidHostError, TenantNotFoundError

logger = logging.getLogger(__name__)


class APIError(Exception):
    """Намеренная ошибка для клиента.

    Значение ``message`` безопасно раскрывать. В него нельзя копировать внутренний
    текст исключений провайдера или базы данных.
    """

    def __init__(
        self,
        status_code: int,
        message: str,
        *,
        code: str | None = None,
        error: str | None = None,
        details: Any | None = None,
        headers: Mapping[str, str] | None = None,
    ) -> None:
        self.status_code = status_code
        self.message = message
        self.code = code
        self.error = error or _error_name(status_code)
        self.details = details
        self.headers = dict(headers or {})
        super().__init__(message)


class BadRequestError(APIError):
    def __init__(self, message: str, *, code: str = "bad_request", details: Any = None) -> None:
        super().__init__(400, message, code=code, details=details)


class AuthenticationError(APIError):
    def __init__(
        self,
        message: str = "Требуется авторизация",
        *,
        code: str = "unauthorized",
    ) -> None:
        super().__init__(401, message, code=code, headers={"WWW-Authenticate": "Bearer"})


class ForbiddenError(APIError):
    def __init__(self, message: str = "Недостаточно прав", *, code: str = "forbidden") -> None:
        super().__init__(403, message, code=code)


class NotFoundError(APIError):
    def __init__(self, message: str = "Ресурс не найден", *, code: str = "not_found") -> None:
        super().__init__(404, message, code=code)


class ConflictError(APIError):
    def __init__(self, message: str, *, code: str = "conflict") -> None:
        super().__init__(409, message, code=code)


class RateLimitError(APIError):
    def __init__(self, retry_after: int, *, captcha_required: bool = False) -> None:
        code = "captcha_required" if captcha_required else "rate_limited"
        message = "Необходимо пройти проверку" if captcha_required else "Слишком много запросов"
        super().__init__(
            429,
            message,
            code=code,
            details={"retryAfter": retry_after, "captchaRequired": captcha_required},
            headers={"Retry-After": str(max(1, retry_after))},
        )


class ServiceUnavailableError(APIError):
    def __init__(
        self,
        message: str = "Сервис временно недоступен",
        *,
        code: str = "unavailable",
    ) -> None:
        super().__init__(503, message, code=code)


def register_error_handlers(app: FastAPI) -> None:
    @app.exception_handler(APIError)
    async def api_error_handler(_request: Request, exc: APIError) -> JSONResponse:
        return _response(
            exc.status_code,
            error=exc.error,
            message=exc.message,
            code=exc.code,
            details=exc.details,
            headers=exc.headers,
        )

    @app.exception_handler(RequestValidationError)
    async def validation_error_handler(
        _request: Request, exc: RequestValidationError
    ) -> JSONResponse:
        details = [
            {
                "field": ".".join(str(part) for part in item.get("loc", ()) if part != "body"),
                "message": str(item.get("msg", "Invalid value")),
                "type": str(item.get("type", "value_error")),
            }
            for item in exc.errors()
        ]
        return _response(
            422,
            error="ValidationError",
            message="Ошибка валидации",
            code="validation_error",
            details=details,
        )

    @app.exception_handler(PasswordPolicyError)
    async def password_policy_error_handler(
        _request: Request, exc: PasswordPolicyError
    ) -> JSONResponse:
        return _response(
            422,
            error="ValidationError",
            message=("Пароль не соответствует требованиям безопасности"),
            code="weak_password",
            details={"violations": list(exc.violations)},
        )

    @app.exception_handler(CSRFError)
    async def csrf_error_handler(_request: Request, _exc: CSRFError) -> JSONResponse:
        return _response(
            403,
            error="Forbidden",
            message=("Проверка безопасности запроса не пройдена"),
            code="csrf_failed",
        )

    @app.exception_handler(InvalidTokenError)
    async def invalid_token_handler(_request: Request, _exc: InvalidTokenError) -> JSONResponse:
        return _response(
            401,
            error="Unauthorized",
            message="Токен недействителен или истёк",
            code="invalid_token",
            headers={"WWW-Authenticate": "Bearer"},
        )

    @app.exception_handler(InvalidHostError)
    async def invalid_host_handler(_request: Request, _exc: InvalidHostError) -> JSONResponse:
        return _response(
            400,
            error="BadRequest",
            message="Некорректный домен запроса",
            code="invalid_host",
        )

    @app.exception_handler(TenantNotFoundError)
    async def tenant_not_found_handler(
        _request: Request, _exc: TenantNotFoundError
    ) -> JSONResponse:
        return _response(
            404,
            error="NotFound",
            message="Салон не найден",
            code="tenant_not_found",
        )

    @app.exception_handler(HTTPException)
    async def http_error_handler(_request: Request, exc: HTTPException) -> JSONResponse:
        message = (
            exc.detail if isinstance(exc.detail, str) else _public_status_message(exc.status_code)
        )
        return _response(
            exc.status_code,
            error=_error_name(exc.status_code),
            message=message,
            code="http_error",
            details=None if isinstance(exc.detail, str) else exc.detail,
            headers=exc.headers,
        )

    @app.exception_handler(Exception)
    async def unexpected_error_handler(request: Request, exc: Exception) -> JSONResponse:
        logger.exception(
            "unhandled_request_error",
            extra={"request_id": get_request_id(), "path": request.url.path},
        )
        return _response(
            500,
            error="InternalServerError",
            message="Внутренняя ошибка сервера",
            code="internal_error",
        )


def _response(
    status_code: int,
    *,
    error: str,
    message: str,
    code: str | None = None,
    details: Any | None = None,
    headers: Mapping[str, str] | None = None,
) -> JSONResponse:
    payload: dict[str, Any] = {
        "statusCode": status_code,
        "error": error,
        "message": message,
    }
    if code:
        payload["code"] = code
    if details is not None:
        payload["details"] = details
    request_id = get_request_id()
    if request_id:
        payload["requestId"] = request_id
    return JSONResponse(status_code=status_code, content=payload, headers=dict(headers or {}))


def _error_name(status_code: int) -> str:
    names = {
        400: "BadRequest",
        401: "Unauthorized",
        403: "Forbidden",
        404: "NotFound",
        409: "Conflict",
        422: "ValidationError",
        429: "TooManyRequests",
        500: "InternalServerError",
        503: "ServiceUnavailable",
    }
    return names.get(status_code, "Error")


def _public_status_message(status_code: int) -> str:
    try:
        return HTTPStatus(status_code).phrase
    except ValueError:
        return "Request failed"
