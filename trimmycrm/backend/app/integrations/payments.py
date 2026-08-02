"""Платёжный шлюз ЮKassa.

Уведомления ЮKassa не используют HMAC-подпись, заданную приложением. Адаптер
проверяет настроенный список разрешённых официальных сетей-источников, а затем
запрашивает платёж через API ЮKassa. Бизнес-обработчики должны использовать
полученный статус и обеспечивать идемпотентность в БД по идентификатору и статусу
платежа у провайдера.
"""

from __future__ import annotations

import ipaddress
import re
import uuid
from collections.abc import Mapping
from dataclasses import dataclass, field
from decimal import ROUND_HALF_UP, Decimal, InvalidOperation
from enum import StrEnum
from typing import Any, Protocol
from urllib.parse import urlsplit

import httpx

from app.core.config import Settings

_IDEMPOTENCE_KEY = re.compile(r"^[A-Za-z0-9._:-]{1,64}$")
_PROVIDER_ID = re.compile(r"^[A-Za-z0-9_-]{1,128}$")


class PaymentProviderError(RuntimeError):
    pass


class InvalidPaymentNotification(ValueError):
    pass


class PaymentStatus(StrEnum):
    PENDING = "pending"
    WAITING_FOR_CAPTURE = "waiting_for_capture"
    SUCCEEDED = "succeeded"
    CANCELED = "canceled"


@dataclass(frozen=True, slots=True)
class PaymentRequest:
    amount: Decimal
    description: str
    return_url: str | None = None
    metadata: Mapping[str, str] = field(default_factory=dict)
    capture: bool = True
    save_payment_method: bool = False
    payment_method_id: str | None = None
    currency: str = "RUB"

    def __post_init__(self) -> None:
        if self.currency != "RUB":
            raise ValueError("only RUB is enabled for this product")
        if not self.description.strip() or len(self.description) > 128:
            raise ValueError("payment description must contain 1..128 characters")
        amount = _money(self.amount)
        if amount <= 0:
            raise ValueError("payment amount must be positive")
        if amount > Decimal("99999999.99"):
            raise ValueError("payment amount is too large")
        if self.payment_method_id is None and not self.return_url:
            raise ValueError("return_url is required for an interactive payment")
        if self.return_url:
            parsed_url = urlsplit(self.return_url)
            if (
                parsed_url.scheme not in {"http", "https"}
                or not parsed_url.hostname
                or parsed_url.username
                or parsed_url.password
            ):
                raise ValueError("invalid payment return_url")
        if self.payment_method_id and not _PROVIDER_ID.fullmatch(self.payment_method_id):
            raise ValueError("invalid payment_method_id")
        if len(self.metadata) > 16 or any(
            len(str(key)) > 64 or len(str(value)) > 512 for key, value in self.metadata.items()
        ):
            raise ValueError("payment metadata is too large")


@dataclass(frozen=True, slots=True)
class Payment:
    id: str
    status: PaymentStatus
    amount: Decimal
    currency: str
    paid: bool
    confirmation_url: str | None = None
    payment_method_id: str | None = None
    metadata: Mapping[str, str] = field(default_factory=dict)
    raw: Mapping[str, Any] = field(default_factory=dict, repr=False)


@dataclass(frozen=True, slots=True)
class VerifiedPaymentNotification:
    event: str
    payment: Payment

    @property
    def idempotency_key(self) -> str:
        return f"yookassa:{self.payment.id}:{self.payment.status.value}"


class PaymentGateway(Protocol):
    async def create_payment(self, request: PaymentRequest, *, idempotence_key: str) -> Payment: ...

    async def get_payment(self, payment_id: str) -> Payment: ...

    async def verify_notification(
        self, payload: Mapping[str, Any], *, source_ip: str
    ) -> VerifiedPaymentNotification: ...


class YooKassaGateway:
    def __init__(
        self,
        *,
        shop_id: str,
        secret_key: str,
        webhook_source_networks: list[str] | tuple[str, ...],
        api_url: str = "https://api.yookassa.ru/v3",
        timeout_seconds: float = 10.0,
        client: httpx.AsyncClient | None = None,
    ) -> None:
        if not shop_id or not secret_key:
            raise ValueError("YooKassa credentials are required")
        self._api_url = api_url.rstrip("/")
        self._networks = tuple(
            ipaddress.ip_network(network, strict=False) for network in webhook_source_networks
        )
        self._auth = httpx.BasicAuth(shop_id, secret_key)
        self._owns_client = client is None
        self._client = client or httpx.AsyncClient(
            timeout=httpx.Timeout(timeout_seconds),
            follow_redirects=False,
            headers={"Accept": "application/json"},
        )

    async def create_payment(self, request: PaymentRequest, *, idempotence_key: str) -> Payment:
        if not _IDEMPOTENCE_KEY.fullmatch(idempotence_key):
            raise ValueError("invalid YooKassa idempotence key")
        body: dict[str, Any] = {
            "amount": {
                "value": format(_money(request.amount), ".2f"),
                "currency": request.currency,
            },
            "capture": request.capture,
            "description": request.description.strip(),
            "save_payment_method": request.save_payment_method,
            "metadata": {str(key): str(value) for key, value in request.metadata.items()},
        }
        if request.payment_method_id:
            body["payment_method_id"] = request.payment_method_id
        else:
            body["confirmation"] = {
                "type": "redirect",
                "return_url": request.return_url,
            }
        payload = await self._request(
            "POST",
            "/payments",
            json=body,
            headers={"Idempotence-Key": idempotence_key},
        )
        return _parse_payment(payload)

    async def get_payment(self, payment_id: str) -> Payment:
        if not _PROVIDER_ID.fullmatch(payment_id):
            raise ValueError("invalid YooKassa payment ID")
        payload = await self._request("GET", f"/payments/{payment_id}")
        return _parse_payment(payload)

    async def verify_notification(
        self, payload: Mapping[str, Any], *, source_ip: str
    ) -> VerifiedPaymentNotification:
        if not self.source_ip_allowed(source_ip):
            raise InvalidPaymentNotification("notification source is not allowed")
        event = payload.get("event")
        obj = payload.get("object")
        if event not in {
            "payment.waiting_for_capture",
            "payment.succeeded",
            "payment.canceled",
        }:
            raise InvalidPaymentNotification("unsupported notification event")
        if not isinstance(obj, Mapping) or not isinstance(obj.get("id"), str):
            raise InvalidPaymentNotification("notification has no payment ID")
        payment_id = str(obj["id"])
        if not _PROVIDER_ID.fullmatch(payment_id):
            raise InvalidPaymentNotification("invalid notification payment ID")

        # Нельзя разрешать изменение состояния по объекту уведомления. Получаем
        # доверенный объект с базовой аутентификацией и используем его статус.
        payment = await self.get_payment(payment_id)
        if payment.id != payment_id:
            raise InvalidPaymentNotification("provider returned a mismatched payment")
        return VerifiedPaymentNotification(event=event, payment=payment)

    def source_ip_allowed(self, source_ip: str) -> bool:
        # Пустой список разрешённых сетей намеренно запрещает доступ. Сети задаются
        # при развёртывании по актуальной официальной документации провайдера.
        if not self._networks:
            return False
        try:
            address = ipaddress.ip_address(source_ip)
        except ValueError:
            return False
        return any(address in network for network in self._networks)

    async def _request(self, method: str, path: str, **kwargs: Any) -> Mapping[str, Any]:
        try:
            response = await self._client.request(
                method,
                f"{self._api_url}{path}",
                auth=self._auth,
                **kwargs,
            )
            response.raise_for_status()
            payload = response.json()
        except (httpx.HTTPError, ValueError) as exc:
            # Нельзя раскрывать тела ответов: они могут содержать внутренние данные провайдера.
            raise PaymentProviderError("YooKassa request failed") from exc
        if not isinstance(payload, Mapping):
            raise PaymentProviderError("YooKassa returned an invalid response")
        return payload

    async def aclose(self) -> None:
        if self._owns_client:
            await self._client.aclose()


class MockPaymentGateway:
    """Провайдер с состоянием для тестов и разработки; создание зависит от окружения."""

    def __init__(self, *, environment: str, auto_succeed: bool = False) -> None:
        if environment not in {"development", "test"}:
            raise ValueError("mock payment provider is development/test only")
        self._auto_succeed = auto_succeed
        self._payments: dict[str, Payment] = {}
        self._idempotency: dict[str, str] = {}

    async def create_payment(self, request: PaymentRequest, *, idempotence_key: str) -> Payment:
        if not _IDEMPOTENCE_KEY.fullmatch(idempotence_key):
            raise ValueError("invalid idempotence key")
        existing_id = self._idempotency.get(idempotence_key)
        if existing_id:
            return self._payments[existing_id]
        payment_id = f"mock_{uuid.uuid4().hex}"
        succeeded = self._auto_succeed
        payment = Payment(
            id=payment_id,
            status=PaymentStatus.SUCCEEDED if succeeded else PaymentStatus.PENDING,
            amount=_money(request.amount),
            currency=request.currency,
            paid=succeeded,
            confirmation_url=request.return_url if succeeded else None,
            metadata=dict(request.metadata),
            raw={"mockAutoSucceeded": succeeded},
        )
        self._payments[payment_id] = payment
        self._idempotency[idempotence_key] = payment_id
        return payment

    async def get_payment(self, payment_id: str) -> Payment:
        try:
            return self._payments[payment_id]
        except KeyError as exc:
            raise PaymentProviderError("mock payment not found") from exc

    async def verify_notification(
        self, payload: Mapping[str, Any], *, source_ip: str
    ) -> VerifiedPaymentNotification:
        del source_ip
        obj = payload.get("object")
        event = payload.get("event")
        if (
            not isinstance(obj, Mapping)
            or not isinstance(obj.get("id"), str)
            or not isinstance(event, str)
        ):
            raise InvalidPaymentNotification("invalid mock notification")
        payment = await self.get_payment(str(obj["id"]))
        return VerifiedPaymentNotification(event=event, payment=payment)

    def set_status(self, payment_id: str, status: PaymentStatus) -> Payment:
        old = self._payments[payment_id]
        updated = Payment(
            id=old.id,
            status=status,
            amount=old.amount,
            currency=old.currency,
            paid=status is PaymentStatus.SUCCEEDED,
            confirmation_url=old.confirmation_url,
            payment_method_id=old.payment_method_id,
            metadata=old.metadata,
            raw=old.raw,
        )
        self._payments[payment_id] = updated
        return updated


def build_payment_gateway(settings: Settings) -> PaymentGateway:
    if settings.payment_provider == "mock":
        return MockPaymentGateway(
            environment=settings.environment,
            auto_succeed=settings.mock_payment_auto_succeed,
        )
    assert settings.yookassa_shop_id is not None
    assert settings.yookassa_secret_key is not None
    return YooKassaGateway(
        shop_id=settings.yookassa_shop_id.get_secret_value(),
        secret_key=settings.yookassa_secret_key.get_secret_value(),
        webhook_source_networks=settings.yookassa_webhook_source_networks,
        api_url=str(settings.yookassa_api_url),
        timeout_seconds=settings.payment_timeout_seconds,
    )


def new_idempotence_key() -> str:
    """Создать для одной бизнес-операции, сохранить и повторно использовать при повторах."""

    return str(uuid.uuid4())


def _money(value: Decimal) -> Decimal:
    try:
        parsed = Decimal(value)
        if not parsed.is_finite():
            raise ValueError("monetary amount must be finite")
        return parsed.quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)
    except (InvalidOperation, ValueError) as exc:
        raise ValueError("invalid monetary amount") from exc


def _parse_payment(payload: Mapping[str, Any]) -> Payment:
    try:
        payment_id = str(payload["id"])
        status = PaymentStatus(str(payload["status"]))
        amount_data = payload["amount"]
        if not isinstance(amount_data, Mapping):
            raise TypeError
        amount = _money(Decimal(str(amount_data["value"])))
        currency = str(amount_data["currency"])
        confirmation = payload.get("confirmation")
        confirmation_url = (
            str(confirmation.get("confirmation_url"))
            if isinstance(confirmation, Mapping) and confirmation.get("confirmation_url")
            else None
        )
        method = payload.get("payment_method")
        payment_method_id = (
            str(method.get("id")) if isinstance(method, Mapping) and method.get("id") else None
        )
        metadata_raw = payload.get("metadata", {})
        metadata = (
            {str(key): str(value) for key, value in metadata_raw.items()}
            if isinstance(metadata_raw, Mapping)
            else {}
        )
    except (KeyError, TypeError, ValueError, InvalidOperation) as exc:
        raise PaymentProviderError("YooKassa returned an invalid payment") from exc
    if not _PROVIDER_ID.fullmatch(payment_id):
        raise PaymentProviderError("YooKassa returned an invalid payment ID")
    return Payment(
        id=payment_id,
        status=status,
        amount=amount,
        currency=currency,
        paid=bool(payload.get("paid", False)),
        confirmation_url=confirmation_url,
        payment_method_id=payment_method_id,
        metadata=metadata,
        raw=dict(payload),
    )
