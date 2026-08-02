from __future__ import annotations

import re
from datetime import date, datetime
from decimal import Decimal
from typing import Annotated, Any, Literal
from urllib.parse import urlsplit
from uuid import UUID

from pydantic import (
    AliasGenerator,
    BaseModel,
    ConfigDict,
    EmailStr,
    Field,
    HttpUrl,
    StringConstraints,
    field_validator,
    model_validator,
)

from app.models import SalonType
from app.services.scheduling import ScheduleError, parse_timezone, validate_schedule

Slug = Annotated[
    str,
    StringConstraints(
        strip_whitespace=True, to_lower=True, pattern=r"^[a-z0-9](?:[a-z0-9-]{1,61}[a-z0-9])?$"
    ),
]
Phone = Annotated[str, StringConstraints(strip_whitespace=True, min_length=7, max_length=32)]
Password = Annotated[str, StringConstraints(min_length=10, max_length=128)]
ServiceFocus = Literal[
    "haircut",
    "color",
    "styling",
    "care",
    "extensions",
    "hair_replacement",
    "beard",
    "shaving",
    "gray_blending",
]
PublicMediaPath = Annotated[
    str,
    StringConstraints(
        max_length=128,
        pattern=(
            r"^/api/v1/public/media/"
            r"[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-5][0-9a-fA-F]{3}-"
            r"[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}$"
        ),
    ),
]


def _validate_social_url(value: str) -> str:
    if len(value) > 2048:
        raise ValueError("Ссылка слишком длинная")
    try:
        parsed = urlsplit(value)
        _ = parsed.port
    except ValueError as exc:
        raise ValueError("Некорректная ссылка") from exc
    if (
        parsed.scheme != "https"
        or not parsed.hostname
        or parsed.username is not None
        or parsed.password is not None
    ):
        raise ValueError("Разрешены только HTTPS-ссылки без логина и пароля")
    return value


def _camel_to_snake(value: str) -> str:
    return re.sub(r"(?<!^)(?=[A-Z])", "_", value).lower()


class APIModel(BaseModel):
    model_config = ConfigDict(
        from_attributes=True,
        populate_by_name=True,
        alias_generator=AliasGenerator(
            validation_alias=_camel_to_snake,
            serialization_alias=lambda field_name: field_name,
        ),
    )


class Message(APIModel):
    message: str


class ErrorResponse(APIModel):
    statusCode: int
    error: str
    message: str | list[dict[str, Any]]
    code: str | None = None
    requestId: str | None = None


class Pagination(APIModel):
    page: int = Field(1, ge=1)
    limit: int = Field(20, ge=1, le=100)


class Paginated(APIModel):
    items: list[Any]
    total: int
    page: int
    limit: int


class Registration(APIModel):
    email: EmailStr
    phone: Phone
    password: Password
    passwordConfirm: str = Field(min_length=1, max_length=128)
    termsAccepted: Literal[True]
    consent: Literal[True]

    @model_validator(mode="after")
    def passwords_match(self) -> Registration:
        if self.password != self.passwordConfirm:
            raise ValueError("Пароли не совпадают")
        return self


class PlatformRegistration(Registration):
    dataProcessingInstructionAccepted: Literal[True]
    salonName: str = Field(min_length=2, max_length=160)
    salonType: SalonType
    city: str | None = Field(default=None, max_length=160)
    timezone: str = Field(default="Europe/Moscow", max_length=64)

    @field_validator("salonName")
    @classmethod
    def non_blank_salon_name(cls, value: str) -> str:
        value = value.strip()
        if len(value) < 2:
            raise ValueError("Введите название салона")
        return value

    @field_validator("city")
    @classmethod
    def clean_city(cls, value: str | None) -> str | None:
        cleaned = value.strip() if value is not None else None
        return cleaned or None

    @field_validator("timezone")
    @classmethod
    def known_registration_timezone(cls, value: str) -> str:
        try:
            parse_timezone(value)
        except ScheduleError as exc:
            raise ValueError(str(exc)) from exc
        return value


class FeedbackCreate(APIModel):
    phone: Phone
    message: str = Field(min_length=10, max_length=5000)

    @field_validator("message")
    @classmethod
    def non_blank_message(cls, value: str) -> str:
        value = value.strip()
        if len(value) < 10:
            raise ValueError("Опишите вопрос подробнее")
        return value


class FeedbackReadUpdate(APIModel):
    read: bool


class LandingLeadCreate(APIModel):
    kind: Literal["question", "callback"]
    name: str = Field(min_length=2, max_length=160)
    phone: Phone
    question: str | None = Field(default=None, max_length=5000)
    preferredTime: str | None = Field(default=None, max_length=80)
    consent: Literal[True]

    @model_validator(mode="after")
    def valid_lead(self) -> LandingLeadCreate:
        self.name = self.name.strip()
        if len(self.name) < 2:
            raise ValueError("Укажите имя")
        if self.kind == "question" and not (self.question or "").strip():
            raise ValueError("Опишите вопрос")
        if self.kind == "callback" and not self.preferredTime:
            raise ValueError("Укажите удобное время для звонка")
        return self


class ChatLeadCreate(APIModel):
    name: str = Field(min_length=2, max_length=160)
    phone: Phone
    question: str | None = Field(default=None, max_length=5000)
    consent: Literal[True]

    @field_validator("name")
    @classmethod
    def non_blank_name(cls, value: str) -> str:
        value = value.strip()
        if len(value) < 2:
            raise ValueError("Укажите имя")
        return value


class Login(APIModel):
    email: EmailStr
    password: str = Field(min_length=1, max_length=128)
    captchaToken: str | None = Field(default=None, max_length=4096)


class EmailRequest(APIModel):
    email: EmailStr


class TokenRequest(APIModel):
    token: str = Field(min_length=32, max_length=1024)


class ResetPassword(TokenRequest):
    password: Password
    passwordConfirm: str = Field(min_length=1, max_length=128)

    @model_validator(mode="after")
    def passwords_match(self) -> ResetPassword:
        if self.password != self.passwordConfirm:
            raise ValueError("Пароли не совпадают")
        return self


class ChangePassword(APIModel):
    oldPassword: str = Field(min_length=1, max_length=128)
    newPassword: Password


class AuthResponse(APIModel):
    accessToken: str
    tokenType: Literal["bearer"] = "bearer"
    expiresIn: int


class UserView(APIModel):
    id: UUID
    email: EmailStr
    role: str | None = None
    fullName: str | None = None
    phone: str | None = None
    emailVerified: bool
    status: str
    createdAt: datetime
    tenantId: UUID | None = None


class PlanView(APIModel):
    id: UUID
    code: str
    name: str
    price: Decimal
    period: str
    limits: dict[str, int | None]
    features: list[str]
    isActive: bool


class PlanUpdate(APIModel):
    name: str | None = Field(default=None, min_length=2, max_length=120)
    price: Decimal | None = Field(default=None, ge=0, max_digits=10, decimal_places=2)
    limits: dict[str, int | None] | None = None
    features: list[str] | None = Field(default=None, max_length=100)
    isActive: bool | None = None


class SubscriptionView(APIModel):
    id: UUID
    plan: PlanView
    status: str
    currentPeriodStart: datetime | None = None
    currentPeriodEnd: datetime | None = None
    autoRenew: bool
    graceUntil: datetime | None = None


class MeResponse(APIModel):
    user: UserView
    subscription: SubscriptionView | None = None


class DashboardTourClaim(APIModel):
    shouldShow: bool


class SiteCreate(APIModel):
    name: str = Field(min_length=2, max_length=160)
    salonType: SalonType
    serviceFocuses: list[ServiceFocus] = Field(default_factory=list, max_length=20)
    locale: Literal["ru-RU"] = "ru-RU"
    currency: Literal["RUB"] = "RUB"
    slug: Slug | None = None
    city: str | None = Field(default=None, max_length=160)
    timezone: str = Field(default="Europe/Moscow", max_length=64)

    @field_validator("timezone")
    @classmethod
    def known_timezone(cls, value: str) -> str:
        try:
            parse_timezone(value)
        except ScheduleError as exc:
            raise ValueError(str(exc)) from exc
        return value


class SiteUpdate(APIModel):
    name: str | None = Field(default=None, min_length=2, max_length=160)
    salonType: SalonType | None = None
    serviceFocuses: list[ServiceFocus] | None = Field(default=None, max_length=20)
    description: str | None = Field(default=None, max_length=5000)
    city: str | None = Field(default=None, max_length=160)
    street: str | None = Field(default=None, max_length=300)
    phone: Phone | None = None
    workHours: dict[str, Any] | None = None
    socials: dict[str, str] | None = Field(default=None, max_length=20)
    logoUrl: PublicMediaPath | None = None
    theme: dict[str, Any] | None = None
    timezone: str | None = Field(default=None, max_length=64)

    @field_validator("timezone")
    @classmethod
    def known_optional_timezone(cls, value: str | None) -> str | None:
        if value is not None:
            try:
                parse_timezone(value)
            except ScheduleError as exc:
                raise ValueError(str(exc)) from exc
        return value

    @field_validator("workHours")
    @classmethod
    def valid_work_hours(cls, value: dict[str, Any] | None) -> dict[str, Any] | None:
        if value is not None:
            try:
                validate_schedule(value)
            except ScheduleError as exc:
                raise ValueError(str(exc)) from exc
        return value

    @field_validator("socials")
    @classmethod
    def valid_socials(cls, value: dict[str, str] | None) -> dict[str, str] | None:
        if value is None:
            return None
        normalized: dict[str, str] = {}
        for key, url in value.items():
            clean_key = key.strip().lower()
            if not re.fullmatch(r"[a-z0-9_-]{2,32}", clean_key):
                raise ValueError("Некорректное название социальной сети")
            normalized[clean_key] = _validate_social_url(url.strip())
        return normalized


class SiteView(APIModel):
    id: UUID
    ownerId: UUID
    name: str
    slug: str
    salonType: SalonType
    serviceFocuses: list[str]
    locale: str
    currency: str
    customDomain: str | None = None
    domainVerified: bool
    description: str | None = None
    city: str | None = None
    street: str | None = None
    phone: str | None = None
    workHours: dict[str, Any]
    socials: dict[str, Any]
    logoUrl: str | None = None
    theme: dict[str, Any]
    timezone: str
    templateKey: str
    status: str
    publishedAt: datetime | None = None
    draftVersion: int
    publishedVersion: int | None = None
    createdAt: datetime
    updatedAt: datetime


class SiteBlockInput(APIModel):
    type: str = Field(min_length=2, max_length=64)
    position: int = Field(ge=0, le=99)
    config: dict[str, Any] = Field(default_factory=dict)
    enabled: bool = True


class SiteBlockView(SiteBlockInput):
    id: UUID


class BlocksUpdate(APIModel):
    blocks: list[SiteBlockInput] = Field(max_length=32)
    expectedVersion: int | None = Field(default=None, ge=0)

    @field_validator("blocks")
    @classmethod
    def unique_positions_and_types(cls, value: list[SiteBlockInput]) -> list[SiteBlockInput]:
        positions = [block.position for block in value]
        if len(positions) != len(set(positions)):
            raise ValueError("Позиции блоков должны быть уникальны")
        return value


class BlockCatalogItem(APIModel):
    type: str
    name: str
    allowed: bool
    lockedReason: str | None = None
    defaultConfig: dict[str, Any]


class PreviewResponse(APIModel):
    previewToken: str
    previewUrl: str
    expiresAt: datetime


class PublishResponse(APIModel):
    url: str
    version: int
    publishedAt: datetime


class DomainRequest(APIModel):
    domain: str = Field(min_length=4, max_length=253)


class DomainChallenge(APIModel):
    domain: str
    recordType: Literal["TXT"] = "TXT"
    recordName: str
    recordValue: str
    verified: bool


class ServiceCreate(APIModel):
    name: str = Field(min_length=2, max_length=160)
    description: str | None = Field(default=None, max_length=3000)
    price: Decimal = Field(ge=0, max_digits=10, decimal_places=2)
    durationMin: int = Field(ge=15, le=1440, multiple_of=5)
    bufferBeforeMin: int = Field(default=0, ge=0, le=240)
    bufferAfterMin: int = Field(default=0, ge=0, le=240)
    category: str | None = Field(default=None, max_length=100)
    isActive: bool = True


class ServiceUpdate(APIModel):
    name: str | None = Field(default=None, min_length=2, max_length=160)
    description: str | None = Field(default=None, max_length=3000)
    price: Decimal | None = Field(default=None, ge=0, max_digits=10, decimal_places=2)
    durationMin: int | None = Field(default=None, ge=15, le=1440, multiple_of=5)
    bufferBeforeMin: int | None = Field(default=None, ge=0, le=240)
    bufferAfterMin: int | None = Field(default=None, ge=0, le=240)
    category: str | None = Field(default=None, max_length=100)
    isActive: bool | None = None


class ServiceView(ServiceCreate):
    id: UUID
    tenantId: UUID
    createdAt: datetime
    updatedAt: datetime


class PublicServiceView(APIModel):
    id: UUID
    name: str
    description: str | None = None
    price: Decimal
    durationMin: int
    bufferBeforeMin: int
    bufferAfterMin: int


class StaffCreate(APIModel):
    name: str = Field(min_length=2, max_length=160)
    email: EmailStr | None = None
    specialization: str | None = Field(default=None, max_length=500)
    photoUrl: PublicMediaPath | None = None
    schedule: dict[str, Any] = Field(default_factory=dict)
    serviceIds: list[UUID] = Field(default_factory=list)
    isActive: bool = True

    @field_validator("schedule")
    @classmethod
    def valid_schedule(cls, value: dict[str, Any]) -> dict[str, Any]:
        try:
            return validate_schedule(value)
        except ScheduleError as exc:
            raise ValueError(str(exc)) from exc


class StaffUpdate(APIModel):
    name: str | None = Field(default=None, min_length=2, max_length=160)
    specialization: str | None = Field(default=None, max_length=500)
    photoUrl: PublicMediaPath | None = None
    schedule: dict[str, Any] | None = None
    serviceIds: list[UUID] | None = None
    isActive: bool | None = None

    @field_validator("schedule")
    @classmethod
    def valid_optional_schedule(cls, value: dict[str, Any] | None) -> dict[str, Any] | None:
        if value is not None:
            try:
                validate_schedule(value)
            except ScheduleError as exc:
                raise ValueError(str(exc)) from exc
        return value


class StaffView(APIModel):
    id: UUID
    tenantId: UUID
    userId: UUID | None = None
    name: str
    specialization: str | None = None
    photoUrl: str | None = None
    schedule: dict[str, Any]
    serviceIds: list[UUID] = Field(default_factory=list)
    isActive: bool
    createdAt: datetime
    updatedAt: datetime


class PublicStaffView(APIModel):
    id: UUID
    name: str
    specialization: str | None = None
    photoUrl: str | None = None
    serviceIds: list[UUID] = Field(default_factory=list)


class ScheduleExceptionCreate(APIModel):
    startsAt: datetime
    endsAt: datetime
    kind: Literal["day_off", "working", "break"]
    reason: str | None = Field(default=None, max_length=300)

    @model_validator(mode="after")
    def valid_range(self) -> ScheduleExceptionCreate:
        if self.startsAt.tzinfo is None or self.endsAt.tzinfo is None:
            raise ValueError("Границы исключения должны содержать timezone")
        if self.endsAt <= self.startsAt:
            raise ValueError("endsAt должен быть позже startsAt")
        return self


class ScheduleExceptionUpdate(APIModel):
    startsAt: datetime | None = None
    endsAt: datetime | None = None
    kind: Literal["day_off", "working", "break"] | None = None
    reason: str | None = Field(default=None, max_length=300)

    @field_validator("startsAt", "endsAt")
    @classmethod
    def timezone_required(cls, value: datetime | None) -> datetime | None:
        if value is not None and value.tzinfo is None:
            raise ValueError("Граница исключения должна содержать timezone")
        return value


class ScheduleExceptionView(APIModel):
    id: UUID
    staffId: UUID
    startsAt: datetime
    endsAt: datetime
    kind: Literal["day_off", "working", "break"]
    reason: str | None = None
    createdAt: datetime
    updatedAt: datetime


class ClientCreate(APIModel):
    email: EmailStr | None = None
    fullName: str = Field(min_length=2, max_length=160)
    phone: Phone | None = None
    consent: bool = False


class ClientUpdate(APIModel):
    email: EmailStr | None = None
    fullName: str | None = Field(default=None, min_length=2, max_length=160)
    phone: Phone | None = None
    status: Literal["crm_only", "pending", "active", "blocked", "anonymized"] | None = None


class PetCreate(APIModel):
    name: str = Field(min_length=1, max_length=100)
    species: Literal["dog", "cat", "other"] = "dog"
    breed: str | None = Field(default=None, max_length=160)
    birthDate: date | None = None
    weightKg: Decimal | None = Field(default=None, gt=0, le=999, decimal_places=2)
    coatType: str | None = Field(default=None, max_length=160)
    temperament: str | None = Field(default=None, max_length=1000)
    allergies: str | None = Field(default=None, max_length=3000)
    medicalNotes: str | None = Field(default=None, max_length=5000)
    additionalInfo: str | None = Field(default=None, max_length=5000)
    vaccinatedUntil: date | None = None


class PetUpdate(APIModel):
    name: str | None = Field(default=None, min_length=1, max_length=100)
    species: Literal["dog", "cat", "other"] | None = None
    breed: str | None = Field(default=None, max_length=160)
    birthDate: date | None = None
    weightKg: Decimal | None = Field(default=None, gt=0, le=999, decimal_places=2)
    coatType: str | None = Field(default=None, max_length=160)
    temperament: str | None = Field(default=None, max_length=1000)
    allergies: str | None = Field(default=None, max_length=3000)
    medicalNotes: str | None = Field(default=None, max_length=5000)
    additionalInfo: str | None = Field(default=None, max_length=5000)
    vaccinatedUntil: date | None = None


class PhotoView(APIModel):
    id: UUID
    url: str
    isCover: bool
    position: int
    uploadedAt: datetime


class PetDocumentView(APIModel):
    id: UUID
    type: Literal["passport"]
    filename: str | None = None
    url: str
    uploadedAt: datetime


class MediaView(APIModel):
    id: UUID
    url: str
    purpose: Literal["logo", "gallery", "staff"]
    isPublic: bool
    contentType: str
    sizeBytes: int
    createdAt: datetime


class PetView(PetCreate):
    id: UUID
    tenantId: UUID
    ownerId: UUID
    photos: list[PhotoView] = Field(default_factory=list)
    documents: list[PetDocumentView] = Field(default_factory=list)
    ageYears: int | None = None
    vaccinationCurrent: bool | None = None
    archivedAt: datetime | None = None
    createdAt: datetime


class ClientView(APIModel):
    id: UUID
    tenantId: UUID
    email: EmailStr | None = None
    fullName: str | None = None
    phone: str | None = None
    emailVerified: bool
    status: str
    createdAt: datetime
    pets: list[PetView] = Field(default_factory=list)


class ClientAppointmentSummary(APIModel):
    id: UUID
    petId: UUID
    serviceId: UUID
    staffId: UUID | None = None
    startAt: datetime
    endAt: datetime
    status: str
    price: Decimal | None = None
    prepaid: bool
    petName: str | None = None
    serviceName: str | None = None
    staffName: str | None = None


class ClientDetailsView(ClientView):
    appointmentHistory: list[ClientAppointmentSummary] = Field(default_factory=list)


class SlotView(APIModel):
    startAt: datetime
    endAt: datetime
    available: bool


class SlotsResponse(APIModel):
    timezone: str
    serviceId: UUID
    staffId: UUID
    slots: list[SlotView]


class BookingCreate(APIModel):
    serviceId: UUID
    staffId: UUID
    petId: UUID
    startAt: datetime
    promotionCode: str | None = Field(default=None, max_length=64)


class AdminAppointmentCreate(APIModel):
    tenantUserId: UUID
    serviceId: UUID
    staffId: UUID | None = None
    petId: UUID
    startAt: datetime
    notes: str | None = Field(default=None, max_length=5000)


class AppointmentUpdate(APIModel):
    status: Literal["new", "confirmed", "completed", "cancelled", "no_show"] | None = None
    staffId: UUID | None = None
    startAt: datetime | None = None
    notes: str | None = Field(default=None, max_length=5000)
    expectedVersion: int | None = Field(default=None, ge=1)


class RescheduleRequest(APIModel):
    startAt: datetime
    staffId: UUID | None = None
    expectedVersion: int | None = Field(default=None, ge=1)


class CancelRequest(APIModel):
    reason: str | None = Field(default=None, max_length=500)


class AppointmentView(APIModel):
    id: UUID
    tenantId: UUID
    tenantUserId: UUID
    petId: UUID
    serviceId: UUID
    staffId: UUID | None = None
    startAt: datetime
    endAt: datetime
    status: str
    price: Decimal
    prepaid: bool
    notes: str | None = None
    version: int
    createdAt: datetime
    clientName: str | None = None
    petName: str | None = None
    serviceName: str | None = None
    staffName: str | None = None


class ReviewCreate(APIModel):
    appointmentId: UUID
    rating: int = Field(ge=1, le=5)
    text: str | None = Field(default=None, max_length=5000)


class ReviewModerate(APIModel):
    status: Literal["published", "rejected"]


class ReviewView(APIModel):
    id: UUID
    tenantUserId: UUID
    appointmentId: UUID | None = None
    rating: int
    text: str | None = None
    status: str
    authorName: str | None = None
    createdAt: datetime


class PublicReviewView(APIModel):
    id: UUID
    rating: int
    text: str | None = None
    authorName: str | None = None
    createdAt: datetime


class PromotionCreate(APIModel):
    title: str = Field(min_length=2, max_length=160)
    description: str | None = Field(default=None, max_length=3000)
    discountPercent: int = Field(ge=0, le=100)
    promoCode: str | None = Field(default=None, min_length=3, max_length=64)
    validFrom: date | None = None
    validTo: date | None = None
    maxUses: int | None = Field(default=None, ge=1)
    isActive: bool = True

    @model_validator(mode="after")
    def valid_dates(self) -> PromotionCreate:
        if self.validFrom and self.validTo and self.validTo < self.validFrom:
            raise ValueError("validTo не может быть раньше validFrom")
        return self


class PromotionUpdate(APIModel):
    title: str | None = Field(default=None, min_length=2, max_length=160)
    description: str | None = Field(default=None, max_length=3000)
    discountPercent: int | None = Field(default=None, ge=0, le=100)
    promoCode: str | None = Field(default=None, min_length=3, max_length=64)
    validFrom: date | None = None
    validTo: date | None = None
    maxUses: int | None = Field(default=None, ge=1)
    isActive: bool | None = None


class PromotionValidate(APIModel):
    promoCode: str = Field(min_length=3, max_length=64)


class PromotionView(PromotionCreate):
    id: UUID
    usedCount: int
    createdAt: datetime
    updatedAt: datetime


class PublicPromotionView(APIModel):
    id: UUID
    title: str
    description: str | None = None
    discountPercent: int = Field(ge=0, le=100)
    promoCode: str | None = None
    validFrom: date | None = None
    validTo: date | None = None


class NotificationPreferenceUpdate(APIModel):
    emailEnabled: bool | None = None
    smsEnabled: bool | None = None
    telegramEnabled: bool | None = None
    reminderHours: list[int] | None = Field(default=None, min_length=1, max_length=8)
    telegramChatId: str | None = Field(default=None, max_length=100)

    @field_validator("reminderHours")
    @classmethod
    def valid_reminder_hours(cls, value: list[int] | None) -> list[int] | None:
        if value is None:
            return None
        if any(isinstance(item, bool) or not 1 <= item <= 168 for item in value):
            raise ValueError("Часы напоминаний должны быть в диапазоне 1..168")
        if len(value) != len(set(value)):
            raise ValueError("Часы напоминаний не должны повторяться")
        return sorted(value, reverse=True)


class LoyaltyView(APIModel):
    balance: int
    lifetimeEarned: int
    lifetimeSpent: int


class LoyaltyAdjust(APIModel):
    tenantUserId: UUID
    points: int = Field(ge=-1_000_000, le=1_000_000)
    reason: str = Field(min_length=2, max_length=300)

    @field_validator("points")
    @classmethod
    def nonzero_points(cls, value: int) -> int:
        if value == 0:
            raise ValueError("Количество баллов не может быть равно нулю")
        return value


class SubscribeRequest(APIModel):
    planId: UUID
    returnUrl: HttpUrl


class CheckoutResponse(APIModel):
    paymentId: UUID
    confirmationUrl: str


class CustomLandingRequest(APIModel):
    contact: str = Field(min_length=3, max_length=500)
    notes: str | None = Field(default=None, max_length=5000)
    returnUrl: HttpUrl


class PrepaymentRequest(APIModel):
    returnUrl: HttpUrl
    amount: Decimal | None = Field(default=None, gt=0, max_digits=10, decimal_places=2)


class PaymentView(APIModel):
    id: UUID
    purpose: str
    amount: Decimal
    currency: str
    provider: str
    providerPaymentId: str | None = None
    status: str
    createdAt: datetime


class TenantAdminUpdate(APIModel):
    status: Literal["draft", "published", "suspended"] | None = None
    planId: UUID | None = None
    subscriptionStatus: Literal["trialing", "active", "past_due", "canceled", "expired"] | None = (
        None
    )
    currentPeriodEnd: datetime | None = None


class TemplateUpdate(APIModel):
    templateKey: Annotated[str, StringConstraints(pattern=r"^(default|custom-[0-9a-fA-F-]{36})$")]
    orderStatus: Literal["in_progress", "delivered"] | None = None


class CustomLandingStatusUpdate(APIModel):
    status: Literal["requested", "paid", "in_progress", "delivered", "cancelled"]


class HealthResponse(APIModel):
    status: Literal["ok", "degraded"]
    checks: dict[str, str] = Field(default_factory=dict)


def normalize_promo_code(value: str) -> str:
    return re.sub(r"\s+", "", value).upper()
