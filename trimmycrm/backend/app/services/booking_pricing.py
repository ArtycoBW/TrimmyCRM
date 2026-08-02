"""Pure server-side pricing for immutable appointment item snapshots."""

from __future__ import annotations

from dataclasses import dataclass
from decimal import Decimal
from uuid import UUID


class BookingQuoteError(ValueError):
    """The selected catalog combination cannot produce a valid booking quote."""


@dataclass(frozen=True, slots=True)
class CatalogAddonChoice:
    id: UUID
    name: str
    price_delta: Decimal
    duration_delta_min: int


@dataclass(frozen=True, slots=True)
class CatalogVariantChoice:
    id: UUID
    label: str
    price_delta: Decimal
    duration_delta_min: int


@dataclass(frozen=True, slots=True)
class CatalogBookingItem:
    service_id: UUID
    service_name: str
    base_price: Decimal
    base_duration_min: int
    buffer_before_min: int = 0
    buffer_after_min: int = 0
    currency: str = "RUB"
    variant: CatalogVariantChoice | None = None
    addons: tuple[CatalogAddonChoice, ...] = ()


@dataclass(frozen=True, slots=True)
class AppointmentAddonSnapshot:
    addon_id: UUID
    name: str
    price: Decimal
    duration_min: int


@dataclass(frozen=True, slots=True)
class AppointmentItemSnapshot:
    service_id: UUID
    service_name: str
    variant_id: UUID | None
    variant_label: str | None
    unit_price: Decimal
    duration_min: int
    buffer_before_min: int
    buffer_after_min: int
    currency: str
    sort_order: int
    addons: tuple[AppointmentAddonSnapshot, ...]


@dataclass(frozen=True, slots=True)
class AppointmentQuote:
    items: tuple[AppointmentItemSnapshot, ...]
    total_price: Decimal
    duration_min: int
    buffer_before_min: int
    buffer_after_min: int
    currency: str


def calculate_appointment_quote(items: tuple[CatalogBookingItem, ...]) -> AppointmentQuote:
    if not items:
        raise BookingQuoteError("Добавьте хотя бы одну услугу")
    if len(items) > 10:
        raise BookingQuoteError("В одной записи может быть не более 10 услуг")
    service_ids = [item.service_id for item in items]
    if len(set(service_ids)) != len(service_ids):
        raise BookingQuoteError("Одна услуга не должна повторяться в записи")
    currencies = {item.currency for item in items}
    if currencies != {"RUB"}:
        raise BookingQuoteError("Все позиции записи должны быть в RUB")

    snapshots: list[AppointmentItemSnapshot] = []
    for position, item in enumerate(items):
        if item.base_price < 0 or item.base_duration_min <= 0:
            raise BookingQuoteError("Некорректная цена или длительность услуги")
        if item.buffer_before_min < 0 or item.buffer_after_min < 0:
            raise BookingQuoteError("Буфер услуги не может быть отрицательным")
        addon_ids = [addon.id for addon in item.addons]
        if len(set(addon_ids)) != len(addon_ids):
            raise BookingQuoteError("Дополнение не должно повторяться в позиции")
        modifiers = ([item.variant] if item.variant is not None else []) + list(item.addons)
        if any(value.price_delta < 0 or value.duration_delta_min < 0 for value in modifiers):
            raise BookingQuoteError("Доплата и дополнительное время не могут быть отрицательными")

        unit_price = item.base_price + sum(
            (value.price_delta for value in modifiers),
            start=Decimal("0"),
        )
        duration_min = item.base_duration_min + sum(value.duration_delta_min for value in modifiers)
        snapshots.append(
            AppointmentItemSnapshot(
                service_id=item.service_id,
                service_name=item.service_name,
                variant_id=item.variant.id if item.variant is not None else None,
                variant_label=item.variant.label if item.variant is not None else None,
                unit_price=unit_price.quantize(Decimal("0.01")),
                duration_min=duration_min,
                buffer_before_min=item.buffer_before_min,
                buffer_after_min=item.buffer_after_min,
                currency=item.currency,
                sort_order=position,
                addons=tuple(
                    AppointmentAddonSnapshot(
                        addon_id=addon.id,
                        name=addon.name,
                        price=addon.price_delta.quantize(Decimal("0.01")),
                        duration_min=addon.duration_delta_min,
                    )
                    for addon in item.addons
                ),
            )
        )

    total_price = sum((item.unit_price for item in snapshots), start=Decimal("0"))
    return AppointmentQuote(
        items=tuple(snapshots),
        total_price=total_price.quantize(Decimal("0.01")),
        duration_min=sum(item.duration_min for item in snapshots),
        buffer_before_min=snapshots[0].buffer_before_min,
        buffer_after_min=snapshots[-1].buffer_after_min,
        currency="RUB",
    )
