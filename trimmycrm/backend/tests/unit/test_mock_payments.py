from __future__ import annotations

import asyncio
from decimal import Decimal

from app.integrations.payments import MockPaymentGateway, PaymentRequest, PaymentStatus


def _request() -> PaymentRequest:
    return PaymentRequest(
        amount=Decimal("2490.00"),
        description="Тестовая подписка",
        return_url="http://trimmycrm.localhost:8080/billing/return",
        metadata={"local_payment_id": "00000000-0000-0000-0000-000000000001"},
    )


def test_mock_payment_stays_pending_by_default() -> None:
    gateway = MockPaymentGateway(environment="test")

    payment = asyncio.run(gateway.create_payment(_request(), idempotence_key="payment-1"))

    assert payment.status is PaymentStatus.PENDING
    assert payment.paid is False
    assert payment.confirmation_url is None


def test_mock_payment_can_auto_succeed_in_development() -> None:
    gateway = MockPaymentGateway(environment="development", auto_succeed=True)

    payment = asyncio.run(gateway.create_payment(_request(), idempotence_key="payment-2"))

    assert payment.status is PaymentStatus.SUCCEEDED
    assert payment.paid is True
    assert payment.confirmation_url == "http://trimmycrm.localhost:8080/billing/return"
    assert payment.raw == {"mockAutoSucceeded": True}


def test_mock_payment_idempotency_keeps_same_successful_payment() -> None:
    gateway = MockPaymentGateway(environment="test", auto_succeed=True)

    first = asyncio.run(gateway.create_payment(_request(), idempotence_key="payment-3"))
    second = asyncio.run(gateway.create_payment(_request(), idempotence_key="payment-3"))

    assert second == first
