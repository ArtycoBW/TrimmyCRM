"""Полная модель хранения TrimmyCRM на SQLAlchemy 2.x.

Ключ тенанта всегда называется ``tenant_id`` и ссылается на ``sites.id``. Каждая
связь, потенциально пересекающая границы тенантов, дополнительно содержит составной
внешний ключ с ``tenant_id``. Это исключает случайные межсалонные ссылки ещё до
проверки политик безопасности на уровне строк.
"""

from __future__ import annotations

import uuid
from datetime import date, datetime
from decimal import Decimal
from enum import StrEnum
from typing import Any

from sqlalchemy import (
    Boolean,
    CheckConstraint,
    Date,
    DateTime,
    ForeignKey,
    ForeignKeyConstraint,
    Index,
    Integer,
    Numeric,
    SmallInteger,
    Text,
    UniqueConstraint,
    func,
)
from sqlalchemy import text as sql_text
from sqlalchemy.dialects.postgresql import CITEXT, JSONB, UUID, ExcludeConstraint
from sqlalchemy.dialects.postgresql import ENUM as PGEnum
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base, TimestampMixin, UUIDPrimaryKeyMixin


class PlatformRole(StrEnum):
    superadmin = "superadmin"
    owner = "owner"
    staff = "staff"


class PlatformUserStatus(StrEnum):
    active = "active"
    blocked = "blocked"
    pending = "pending"


class BillingPeriod(StrEnum):
    month = "month"
    year = "year"


class SubscriptionStatus(StrEnum):
    trialing = "trialing"
    active = "active"
    past_due = "past_due"
    canceled = "canceled"
    expired = "expired"


class SiteStatus(StrEnum):
    draft = "draft"
    published = "published"
    suspended = "suspended"


class SalonType(StrEnum):
    women_hair_salon = "women_hair_salon"
    barbershop = "barbershop"
    unisex_hair_salon = "unisex_hair_salon"


class ServiceAudience(StrEnum):
    women = "women"
    men = "men"
    all = "all"
    kids = "kids"


class ServicePriceType(StrEnum):
    fixed = "fixed"
    from_ = "from"
    range = "range"
    consultation = "consultation"


class DomainVerificationStatus(StrEnum):
    not_configured = "not_configured"
    pending = "pending"
    verified = "verified"
    failed = "failed"


class TLSStatus(StrEnum):
    not_requested = "not_requested"
    pending = "pending"
    issued = "issued"
    failed = "failed"


class SiteVersionStatus(StrEnum):
    draft = "draft"
    published = "published"
    archived = "archived"


class TenantUserStatus(StrEnum):
    crm_only = "crm_only"
    pending = "pending"
    active = "active"
    blocked = "blocked"
    anonymized = "anonymized"


class PetSpecies(StrEnum):
    dog = "dog"
    cat = "cat"
    other = "other"


class ScheduleExceptionType(StrEnum):
    unavailable = "unavailable"
    available = "available"


class AppointmentStatus(StrEnum):
    new = "new"
    confirmed = "confirmed"
    completed = "completed"
    cancelled = "cancelled"
    no_show = "no_show"


class ReviewStatus(StrEnum):
    pending = "pending"
    published = "published"
    rejected = "rejected"


class NotificationTargetType(StrEnum):
    tenant_user = "tenant_user"
    platform_user = "platform_user"


class NotificationChannel(StrEnum):
    email = "email"
    sms = "sms"
    telegram = "telegram"


class NotificationStatus(StrEnum):
    queued = "queued"
    processing = "processing"
    sent = "sent"
    failed = "failed"
    canceled = "canceled"


class PaymentPurpose(StrEnum):
    subscription = "subscription"
    custom_landing = "custom_landing"
    prepayment = "prepayment"


class PaymentStatus(StrEnum):
    pending = "pending"
    succeeded = "succeeded"
    canceled = "canceled"
    refunded = "refunded"


class CustomLandingStatus(StrEnum):
    requested = "requested"
    paid = "paid"
    in_progress = "in_progress"
    delivered = "delivered"
    cancelled = "cancelled"


class AuthUserType(StrEnum):
    platform = "platform"
    tenant = "tenant"


class AuthTokenType(StrEnum):
    email_verify = "email_verify"
    password_reset = "password_reset"  # noqa: S105


class LoyaltyTransactionType(StrEnum):
    earn = "earn"
    spend = "spend"
    adjustment = "adjustment"
    expire = "expire"


class MediaKind(StrEnum):
    image = "image"
    document = "document"


class MediaStatus(StrEnum):
    pending = "pending"
    ready = "ready"
    rejected = "rejected"
    deleted = "deleted"


class AuditActorType(StrEnum):
    platform_user = "platform_user"
    tenant_user = "tenant_user"
    system = "system"


class WebhookEventStatus(StrEnum):
    received = "received"
    processed = "processed"
    ignored = "ignored"
    failed = "failed"


class IdempotencyStatus(StrEnum):
    processing = "processing"
    completed = "completed"
    failed = "failed"


class PlatformUser(UUIDPrimaryKeyMixin, TimestampMixin, Base):
    __tablename__ = "platform_users"

    email: Mapped[str] = mapped_column(CITEXT(), nullable=False, unique=True)
    password_hash: Mapped[str] = mapped_column(Text, nullable=False)
    role: Mapped[PlatformRole] = mapped_column(
        PGEnum(PlatformRole, name="platform_user_role", create_type=False),
        nullable=False,
        server_default=sql_text("'owner'"),
    )
    full_name: Mapped[str | None] = mapped_column(Text)
    phone: Mapped[str | None] = mapped_column(Text)
    email_verified: Mapped[bool] = mapped_column(
        Boolean, nullable=False, server_default=sql_text("false")
    )
    status: Mapped[PlatformUserStatus] = mapped_column(
        PGEnum(
            PlatformUserStatus,
            name="platform_user_status",
            create_type=False,
        ),
        nullable=False,
        server_default=sql_text("'pending'"),
    )
    personal_data_consent_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    personal_data_consent_version: Mapped[str | None] = mapped_column(Text)
    terms_accepted_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    terms_version: Mapped[str | None] = mapped_column(Text)
    data_processing_instruction_accepted_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True)
    )
    data_processing_instruction_version: Mapped[str | None] = mapped_column(Text)
    last_login_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    dashboard_tour_completed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))


class FeedbackMessage(UUIDPrimaryKeyMixin, TimestampMixin, Base):
    __tablename__ = "feedback_messages"
    __table_args__ = (
        Index("ix_feedback_messages_author_id", "author_id"),
        Index("ix_feedback_messages_created_at", "created_at"),
        Index("ix_feedback_messages_read_at", "read_at"),
    )

    author_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("platform_users.id", ondelete="CASCADE"),
        nullable=False,
    )
    message: Mapped[str] = mapped_column(Text, nullable=False)
    read_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))


class LandingLead(UUIDPrimaryKeyMixin, TimestampMixin, Base):
    __tablename__ = "landing_leads"
    __table_args__ = (
        CheckConstraint("kind IN ('question', 'callback')", name="landing_leads_kind_valid"),
        Index("ix_landing_leads_kind_created_at", "kind", "created_at"),
        Index("ix_landing_leads_read_at", "read_at"),
    )

    kind: Mapped[str] = mapped_column(Text, nullable=False)
    name: Mapped[str] = mapped_column(Text, nullable=False)
    phone: Mapped[str] = mapped_column(Text, nullable=False)
    question: Mapped[str | None] = mapped_column(Text)
    preferred_time: Mapped[str | None] = mapped_column(Text)
    consent_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    read_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))


class ChatLead(UUIDPrimaryKeyMixin, TimestampMixin, Base):
    __tablename__ = "chat_leads"
    __table_args__ = (
        Index("ix_chat_leads_created_at", "created_at"),
        Index("ix_chat_leads_read_at", "read_at"),
    )

    name: Mapped[str] = mapped_column(Text, nullable=False)
    phone: Mapped[str] = mapped_column(Text, nullable=False)
    question: Mapped[str | None] = mapped_column(Text)
    consent_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    read_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))


class Plan(UUIDPrimaryKeyMixin, Base):
    __tablename__ = "plans"

    code: Mapped[str] = mapped_column(Text, nullable=False, unique=True)
    name: Mapped[str] = mapped_column(Text, nullable=False)
    price: Mapped[Decimal] = mapped_column(Numeric(10, 2), nullable=False)
    period: Mapped[BillingPeriod] = mapped_column(
        PGEnum(BillingPeriod, name="billing_period", create_type=False),
        nullable=False,
        server_default=sql_text("'month'"),
    )
    limits: Mapped[dict[str, Any]] = mapped_column(
        JSONB, nullable=False, server_default=sql_text("'{}'::jsonb")
    )
    features: Mapped[list[str]] = mapped_column(
        JSONB, nullable=False, server_default=sql_text("'[]'::jsonb")
    )
    is_active: Mapped[bool] = mapped_column(
        Boolean, nullable=False, server_default=sql_text("true")
    )


class Subscription(UUIDPrimaryKeyMixin, TimestampMixin, Base):
    __tablename__ = "subscriptions"
    __table_args__ = (
        Index("ix_subscriptions_owner_id", "owner_id"),
        Index("ix_subscriptions_status", "status"),
        Index("ix_subscriptions_current_period_end", "current_period_end"),
        Index(
            "ix_subscriptions_dunning_due",
            "next_dunning_at",
            postgresql_where=sql_text("status = 'past_due'"),
        ),
    )

    owner_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("platform_users.id", ondelete="RESTRICT"),
        nullable=False,
    )
    plan_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("plans.id", ondelete="RESTRICT"), nullable=False
    )
    status: Mapped[SubscriptionStatus] = mapped_column(
        PGEnum(SubscriptionStatus, name="subscription_status", create_type=False),
        nullable=False,
    )
    current_period_start: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    current_period_end: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    auto_renew: Mapped[bool] = mapped_column(
        Boolean, nullable=False, server_default=sql_text("true")
    )
    provider_sub_id: Mapped[str | None] = mapped_column(Text)
    payment_method_id: Mapped[str | None] = mapped_column(Text)
    dunning_attempts: Mapped[int] = mapped_column(
        SmallInteger, nullable=False, server_default=sql_text("0")
    )
    next_dunning_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    last_payment_attempt_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    grace_period_end: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    canceled_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))


class Site(UUIDPrimaryKeyMixin, TimestampMixin, Base):
    __tablename__ = "sites"
    __table_args__ = (
        CheckConstraint(
            "slug ~ '^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$'",
            name="valid_slug",
        ),
        Index("ix_sites_status", "status"),
    )

    owner_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("platform_users.id", ondelete="RESTRICT"),
        nullable=False,
        unique=True,
    )
    name: Mapped[str] = mapped_column(Text, nullable=False)
    slug: Mapped[str] = mapped_column(CITEXT(), nullable=False, unique=True)
    salon_type: Mapped[SalonType] = mapped_column(
        PGEnum(SalonType, name="salon_type", create_type=False),
        nullable=False,
        server_default=sql_text("'unisex_hair_salon'"),
    )
    service_focuses: Mapped[list[str]] = mapped_column(
        JSONB, nullable=False, server_default=sql_text("'[]'::jsonb")
    )
    locale: Mapped[str] = mapped_column(Text, nullable=False, server_default=sql_text("'ru-RU'"))
    currency: Mapped[str] = mapped_column(Text, nullable=False, server_default=sql_text("'RUB'"))
    custom_domain: Mapped[str | None] = mapped_column(CITEXT(), unique=True)
    domain_verified: Mapped[bool] = mapped_column(
        Boolean, nullable=False, server_default=sql_text("false")
    )
    domain_verification_status: Mapped[DomainVerificationStatus] = mapped_column(
        PGEnum(
            DomainVerificationStatus,
            name="domain_verification_status",
            create_type=False,
        ),
        nullable=False,
        server_default=sql_text("'not_configured'"),
    )
    domain_verification_token: Mapped[str | None] = mapped_column(Text)
    domain_verification_requested_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True)
    )
    domain_verified_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    domain_last_checked_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    domain_verification_error: Mapped[str | None] = mapped_column(Text)
    tls_status: Mapped[TLSStatus] = mapped_column(
        PGEnum(TLSStatus, name="tls_status", create_type=False),
        nullable=False,
        server_default=sql_text("'not_requested'"),
    )
    tls_issued_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    description: Mapped[str | None] = mapped_column(Text)
    city: Mapped[str | None] = mapped_column(Text)
    street: Mapped[str | None] = mapped_column(Text)
    phone: Mapped[str | None] = mapped_column(Text)
    timezone: Mapped[str] = mapped_column(
        Text, nullable=False, server_default=sql_text("'Europe/Moscow'")
    )
    work_hours: Mapped[dict[str, Any]] = mapped_column(
        JSONB, nullable=False, server_default=sql_text("'{}'::jsonb")
    )
    socials: Mapped[dict[str, Any]] = mapped_column(
        JSONB, nullable=False, server_default=sql_text("'{}'::jsonb")
    )
    logo_url: Mapped[str | None] = mapped_column(Text)
    theme: Mapped[dict[str, Any]] = mapped_column(
        JSONB, nullable=False, server_default=sql_text("'{}'::jsonb")
    )
    template_key: Mapped[str] = mapped_column(
        Text, nullable=False, server_default=sql_text("'default'")
    )
    status: Mapped[SiteStatus] = mapped_column(
        PGEnum(SiteStatus, name="site_status", create_type=False),
        nullable=False,
        server_default=sql_text("'draft'"),
    )
    published_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))


class SiteBlock(UUIDPrimaryKeyMixin, TimestampMixin, Base):
    __tablename__ = "site_blocks"
    __table_args__ = (
        UniqueConstraint("tenant_id", "id", name="uq_site_blocks_tenant_id_id"),
        UniqueConstraint("tenant_id", "position", name="uq_site_blocks_tenant_position"),
        CheckConstraint("position >= 0", name="nonnegative_position"),
        Index("ix_site_blocks_tenant_position", "tenant_id", "position"),
    )

    tenant_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("sites.id", ondelete="CASCADE"), nullable=False
    )
    type: Mapped[str] = mapped_column(Text, nullable=False)
    position: Mapped[int] = mapped_column(Integer, nullable=False)
    config: Mapped[dict[str, Any]] = mapped_column(
        JSONB, nullable=False, server_default=sql_text("'{}'::jsonb")
    )
    enabled: Mapped[bool] = mapped_column(Boolean, nullable=False, server_default=sql_text("true"))


class SiteVersion(UUIDPrimaryKeyMixin, Base):
    """Неизменяемый снимок сайта для безопасной публикации и отката."""

    __tablename__ = "site_versions"
    __table_args__ = (
        UniqueConstraint("tenant_id", "id", name="uq_site_versions_tenant_id_id"),
        UniqueConstraint("tenant_id", "version_no", name="uq_site_versions_tenant_version_no"),
        CheckConstraint("version_no > 0", name="positive_version_no"),
        Index("ix_site_versions_tenant_status", "tenant_id", "status"),
    )

    tenant_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("sites.id", ondelete="CASCADE"), nullable=False
    )
    version_no: Mapped[int] = mapped_column(Integer, nullable=False)
    status: Mapped[SiteVersionStatus] = mapped_column(
        PGEnum(SiteVersionStatus, name="site_version_status", create_type=False),
        nullable=False,
        server_default=sql_text("'draft'"),
    )
    snapshot: Mapped[dict[str, Any]] = mapped_column(JSONB, nullable=False)
    created_by_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("platform_users.id", ondelete="SET NULL")
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )
    published_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))


class ServiceCategory(UUIDPrimaryKeyMixin, TimestampMixin, Base):
    __tablename__ = "service_categories"
    __table_args__ = (
        UniqueConstraint("tenant_id", "id", name="uq_service_categories_tenant_id_id"),
        UniqueConstraint("tenant_id", "slug", name="uq_service_categories_tenant_slug"),
        CheckConstraint("sort_order >= 0", name="nonnegative_sort_order"),
        Index("ix_service_categories_tenant_active", "tenant_id", "is_active"),
    )

    tenant_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("sites.id", ondelete="CASCADE"), nullable=False
    )
    name: Mapped[str] = mapped_column(Text, nullable=False)
    slug: Mapped[str] = mapped_column(Text, nullable=False)
    audience: Mapped[ServiceAudience] = mapped_column(
        PGEnum(ServiceAudience, name="service_audience", create_type=False),
        nullable=False,
        server_default=sql_text("'all'"),
    )
    sort_order: Mapped[int] = mapped_column(Integer, nullable=False, server_default=sql_text("0"))
    is_active: Mapped[bool] = mapped_column(
        Boolean, nullable=False, server_default=sql_text("true")
    )


class Service(UUIDPrimaryKeyMixin, TimestampMixin, Base):
    __tablename__ = "services"
    __table_args__ = (
        UniqueConstraint("tenant_id", "id", name="uq_services_tenant_id_id"),
        ForeignKeyConstraint(
            ["tenant_id", "category_id"],
            ["service_categories.tenant_id", "service_categories.id"],
            ondelete="RESTRICT",
            name="fk_services_tenant_category",
        ),
        CheckConstraint("price >= 0", name="nonnegative_price"),
        CheckConstraint("max_price IS NULL OR max_price >= price", name="valid_price_range"),
        CheckConstraint("duration_min > 0", name="positive_duration"),
        CheckConstraint("buffer_before_min >= 0", name="nonnegative_buffer_before"),
        CheckConstraint("buffer_after_min >= 0", name="nonnegative_buffer_after"),
        CheckConstraint("sort_order >= 0", name="nonnegative_sort_order"),
        CheckConstraint("char_length(currency) = 3", name="currency_code_length"),
        Index("ix_services_tenant_active", "tenant_id", "is_active"),
        Index("ix_services_tenant_category", "tenant_id", "category_id"),
    )

    tenant_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("sites.id", ondelete="CASCADE"), nullable=False
    )
    name: Mapped[str] = mapped_column(Text, nullable=False)
    description: Mapped[str | None] = mapped_column(Text)
    category_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True))
    price: Mapped[Decimal] = mapped_column(Numeric(10, 2), nullable=False)
    max_price: Mapped[Decimal | None] = mapped_column(Numeric(10, 2))
    price_type: Mapped[ServicePriceType] = mapped_column(
        PGEnum(
            ServicePriceType,
            name="service_price_type",
            create_type=False,
            values_callable=lambda enum: [item.value for item in enum],
        ),
        nullable=False,
        server_default=sql_text("'fixed'"),
    )
    currency: Mapped[str] = mapped_column(Text, nullable=False, server_default=sql_text("'RUB'"))
    duration_min: Mapped[int] = mapped_column(Integer, nullable=False)
    buffer_before_min: Mapped[int] = mapped_column(
        Integer, nullable=False, server_default=sql_text("0")
    )
    buffer_after_min: Mapped[int] = mapped_column(
        Integer, nullable=False, server_default=sql_text("0")
    )
    category: Mapped[str | None] = mapped_column(Text)
    requires_consultation: Mapped[bool] = mapped_column(
        Boolean, nullable=False, server_default=sql_text("false")
    )
    requires_patch_test: Mapped[bool] = mapped_column(
        Boolean, nullable=False, server_default=sql_text("false")
    )
    allow_online_booking: Mapped[bool] = mapped_column(
        Boolean, nullable=False, server_default=sql_text("true")
    )
    variant_selection_required: Mapped[bool] = mapped_column(
        Boolean, nullable=False, server_default=sql_text("false")
    )
    preparation_text: Mapped[str | None] = mapped_column(Text)
    aftercare_text: Mapped[str | None] = mapped_column(Text)
    sort_order: Mapped[int] = mapped_column(Integer, nullable=False, server_default=sql_text("0"))
    is_active: Mapped[bool] = mapped_column(
        Boolean, nullable=False, server_default=sql_text("true")
    )


class ServiceVariant(UUIDPrimaryKeyMixin, TimestampMixin, Base):
    __tablename__ = "service_variants"
    __table_args__ = (
        UniqueConstraint("tenant_id", "id", name="uq_service_variants_tenant_id_id"),
        UniqueConstraint(
            "tenant_id", "service_id", "id", name="uq_service_variants_tenant_service_id"
        ),
        UniqueConstraint(
            "tenant_id", "service_id", "label", name="uq_service_variants_service_label"
        ),
        ForeignKeyConstraint(
            ["tenant_id", "service_id"],
            ["services.tenant_id", "services.id"],
            ondelete="CASCADE",
            name="fk_service_variants_tenant_service",
        ),
        CheckConstraint("price_delta >= 0", name="nonnegative_price_delta"),
        CheckConstraint("duration_delta_min >= 0", name="nonnegative_duration_delta"),
        CheckConstraint("sort_order >= 0", name="nonnegative_sort_order"),
        Index("ix_service_variants_tenant_service", "tenant_id", "service_id"),
    )

    tenant_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("sites.id", ondelete="CASCADE"), nullable=False
    )
    service_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), nullable=False)
    label: Mapped[str] = mapped_column(Text, nullable=False)
    price_delta: Mapped[Decimal] = mapped_column(
        Numeric(10, 2), nullable=False, server_default=sql_text("0")
    )
    duration_delta_min: Mapped[int] = mapped_column(
        Integer, nullable=False, server_default=sql_text("0")
    )
    sort_order: Mapped[int] = mapped_column(Integer, nullable=False, server_default=sql_text("0"))
    is_active: Mapped[bool] = mapped_column(
        Boolean, nullable=False, server_default=sql_text("true")
    )


class ServiceAddon(UUIDPrimaryKeyMixin, TimestampMixin, Base):
    __tablename__ = "service_addons"
    __table_args__ = (
        UniqueConstraint("tenant_id", "id", name="uq_service_addons_tenant_id_id"),
        UniqueConstraint(
            "tenant_id", "service_id", "id", name="uq_service_addons_tenant_service_id"
        ),
        UniqueConstraint("tenant_id", "service_id", "name", name="uq_service_addons_service_name"),
        ForeignKeyConstraint(
            ["tenant_id", "service_id"],
            ["services.tenant_id", "services.id"],
            ondelete="CASCADE",
            name="fk_service_addons_tenant_service",
        ),
        CheckConstraint("price_delta >= 0", name="nonnegative_price_delta"),
        CheckConstraint("duration_delta_min >= 0", name="nonnegative_duration_delta"),
        CheckConstraint("sort_order >= 0", name="nonnegative_sort_order"),
        Index("ix_service_addons_tenant_service", "tenant_id", "service_id"),
    )

    tenant_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("sites.id", ondelete="CASCADE"), nullable=False
    )
    service_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), nullable=False)
    name: Mapped[str] = mapped_column(Text, nullable=False)
    price_delta: Mapped[Decimal] = mapped_column(
        Numeric(10, 2), nullable=False, server_default=sql_text("0")
    )
    duration_delta_min: Mapped[int] = mapped_column(
        Integer, nullable=False, server_default=sql_text("0")
    )
    sort_order: Mapped[int] = mapped_column(Integer, nullable=False, server_default=sql_text("0"))
    is_active: Mapped[bool] = mapped_column(
        Boolean, nullable=False, server_default=sql_text("true")
    )


class Staff(UUIDPrimaryKeyMixin, TimestampMixin, Base):
    __tablename__ = "staff"
    __table_args__ = (
        UniqueConstraint("tenant_id", "id", name="uq_staff_tenant_id_id"),
        UniqueConstraint("tenant_id", "user_id", name="uq_staff_tenant_user_id"),
        # Учётная запись сотрудника платформы принадлежит ровно одному салону.
        # Это делает поиск тенанта однозначным и не позволяет приглашению
        # незаметно предоставить доступ к другому салону.
        UniqueConstraint("user_id", name="uq_staff_user_id_global"),
        Index("ix_staff_tenant_active", "tenant_id", "is_active"),
    )

    tenant_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("sites.id", ondelete="CASCADE"), nullable=False
    )
    user_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("platform_users.id", ondelete="SET NULL")
    )
    name: Mapped[str] = mapped_column(Text, nullable=False)
    specialization: Mapped[str | None] = mapped_column(Text)
    photo_url: Mapped[str | None] = mapped_column(Text)
    schedule: Mapped[dict[str, Any]] = mapped_column(
        JSONB, nullable=False, server_default=sql_text("'{}'::jsonb")
    )
    is_active: Mapped[bool] = mapped_column(
        Boolean, nullable=False, server_default=sql_text("true")
    )


class StaffService(Base):
    __tablename__ = "staff_services"
    __table_args__ = (
        ForeignKeyConstraint(
            ["tenant_id", "staff_id"],
            ["staff.tenant_id", "staff.id"],
            ondelete="CASCADE",
            name="fk_staff_services_tenant_staff",
        ),
        ForeignKeyConstraint(
            ["tenant_id", "service_id"],
            ["services.tenant_id", "services.id"],
            ondelete="CASCADE",
            name="fk_staff_services_tenant_service",
        ),
        CheckConstraint(
            "custom_price IS NULL OR custom_price >= 0",
            name="nonnegative_custom_price",
        ),
        CheckConstraint(
            "custom_duration_min IS NULL OR custom_duration_min > 0",
            name="positive_custom_duration",
        ),
        Index("ix_staff_services_tenant_service", "tenant_id", "service_id"),
    )

    tenant_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("sites.id", ondelete="CASCADE"), primary_key=True
    )
    staff_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True)
    service_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True)
    custom_price: Mapped[Decimal | None] = mapped_column(Numeric(10, 2))
    custom_duration_min: Mapped[int | None] = mapped_column(Integer)


class ScheduleException(UUIDPrimaryKeyMixin, TimestampMixin, Base):
    __tablename__ = "schedule_exceptions"
    __table_args__ = (
        UniqueConstraint("tenant_id", "id", name="uq_schedule_exceptions_tenant_id_id"),
        ForeignKeyConstraint(
            ["tenant_id", "staff_id"],
            ["staff.tenant_id", "staff.id"],
            ondelete="CASCADE",
            name="fk_schedule_exceptions_tenant_staff",
        ),
        CheckConstraint("end_at > start_at", name="valid_period"),
        CheckConstraint(
            "kind IN ('day_off', 'working', 'break')",
            name="valid_kind",
        ),
        Index(
            "ix_schedule_exceptions_staff_period",
            "tenant_id",
            "staff_id",
            "start_at",
            "end_at",
        ),
    )

    tenant_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("sites.id", ondelete="CASCADE"), nullable=False
    )
    staff_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), nullable=False)
    start_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    end_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    kind: Mapped[str] = mapped_column(Text, nullable=False, server_default=sql_text("'break'"))
    type: Mapped[ScheduleExceptionType] = mapped_column(
        PGEnum(
            ScheduleExceptionType,
            name="schedule_exception_type",
            create_type=False,
        ),
        nullable=False,
        server_default=sql_text("'unavailable'"),
    )
    reason: Mapped[str | None] = mapped_column(Text)


class TenantUser(UUIDPrimaryKeyMixin, TimestampMixin, Base):
    __tablename__ = "tenant_users"
    __table_args__ = (
        UniqueConstraint("tenant_id", "id", name="uq_tenant_users_tenant_id_id"),
        UniqueConstraint("tenant_id", "email", name="uq_tenant_users_tenant_email"),
        Index("ix_tenant_users_tenant_phone", "tenant_id", "phone"),
        Index("ix_tenant_users_tenant_status", "tenant_id", "status"),
    )

    tenant_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("sites.id", ondelete="CASCADE"), nullable=False
    )
    email: Mapped[str | None] = mapped_column(CITEXT())
    password_hash: Mapped[str | None] = mapped_column(Text)
    full_name: Mapped[str | None] = mapped_column(Text)
    phone: Mapped[str | None] = mapped_column(Text)
    email_verified: Mapped[bool] = mapped_column(
        Boolean, nullable=False, server_default=sql_text("false")
    )
    status: Mapped[TenantUserStatus] = mapped_column(
        PGEnum(TenantUserStatus, name="tenant_user_status", create_type=False),
        nullable=False,
        server_default=sql_text("'crm_only'"),
    )
    personal_data_consent_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    personal_data_consent_version: Mapped[str | None] = mapped_column(Text)
    last_login_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    anonymized_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))


class ClientHairProfile(UUIDPrimaryKeyMixin, TimestampMixin, Base):
    """Owner-maintained technical profile; never used for medical conclusions."""

    __tablename__ = "client_hair_profiles"
    __table_args__ = (
        UniqueConstraint("tenant_id", "id", name="uq_client_hair_profiles_tenant_id_id"),
        UniqueConstraint(
            "tenant_id",
            "client_id",
            name="uq_client_hair_profiles_tenant_client",
        ),
        ForeignKeyConstraint(
            ["tenant_id", "client_id"],
            ["tenant_users.tenant_id", "tenant_users.id"],
            ondelete="CASCADE",
            name="fk_client_hair_profiles_tenant_client",
        ),
        CheckConstraint(
            "gray_percentage IS NULL OR gray_percentage BETWEEN 0 AND 100",
            name="gray_percentage_range",
        ),
        CheckConstraint("version > 0", name="positive_version"),
        Index("ix_client_hair_profiles_tenant_client", "tenant_id", "client_id"),
    )

    tenant_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("sites.id", ondelete="CASCADE"), nullable=False
    )
    client_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), nullable=False)
    hair_length: Mapped[str | None] = mapped_column(Text)
    density: Mapped[str | None] = mapped_column(Text)
    texture: Mapped[str | None] = mapped_column(Text)
    porosity: Mapped[str | None] = mapped_column(Text)
    condition_notes: Mapped[str | None] = mapped_column(Text)
    scalp_sensitivity_notes: Mapped[str | None] = mapped_column(Text)
    gray_percentage: Mapped[int | None] = mapped_column(SmallInteger)
    natural_color: Mapped[str | None] = mapped_column(Text)
    current_color: Mapped[str | None] = mapped_column(Text)
    color_history: Mapped[str | None] = mapped_column(Text)
    beard_length: Mapped[str | None] = mapped_column(Text)
    beard_style: Mapped[str | None] = mapped_column(Text)
    moustache_style: Mapped[str | None] = mapped_column(Text)
    preferences: Mapped[str | None] = mapped_column(Text)
    version: Mapped[int] = mapped_column(Integer, nullable=False, server_default=sql_text("1"))
    updated_by_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("platform_users.id", ondelete="SET NULL")
    )


class Pet(UUIDPrimaryKeyMixin, TimestampMixin, Base):
    __tablename__ = "pets"
    __table_args__ = (
        UniqueConstraint("tenant_id", "id", name="uq_pets_tenant_id_id"),
        ForeignKeyConstraint(
            ["tenant_id", "owner_id"],
            ["tenant_users.tenant_id", "tenant_users.id"],
            ondelete="CASCADE",
            name="fk_pets_tenant_owner",
        ),
        CheckConstraint("weight_kg IS NULL OR weight_kg > 0", name="positive_weight"),
        Index("ix_pets_tenant_owner", "tenant_id", "owner_id"),
    )

    tenant_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("sites.id", ondelete="CASCADE"), nullable=False
    )
    owner_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), nullable=False)
    name: Mapped[str] = mapped_column(Text, nullable=False)
    species: Mapped[PetSpecies | None] = mapped_column(
        PGEnum(PetSpecies, name="pet_species", create_type=False)
    )
    breed: Mapped[str | None] = mapped_column(Text)
    birth_date: Mapped[date | None] = mapped_column(Date)
    weight_kg: Mapped[Decimal | None] = mapped_column(Numeric(5, 2))
    coat_type: Mapped[str | None] = mapped_column(Text)
    temperament: Mapped[str | None] = mapped_column(Text)
    allergies: Mapped[str | None] = mapped_column(Text)
    medical_notes: Mapped[str | None] = mapped_column(Text)
    additional_info: Mapped[str | None] = mapped_column(Text)
    vaccinated_until: Mapped[date | None] = mapped_column(Date)
    archived_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))


class MediaObject(UUIDPrimaryKeyMixin, TimestampMixin, Base):
    __tablename__ = "media_objects"
    __table_args__ = (
        UniqueConstraint("tenant_id", "id", name="uq_media_objects_tenant_id_id"),
        UniqueConstraint("bucket", "object_key", name="uq_media_objects_storage_key"),
        CheckConstraint("size_bytes >= 0", name="nonnegative_size"),
        ForeignKeyConstraint(
            ["tenant_id", "uploaded_by_tenant_user_id"],
            ["tenant_users.tenant_id", "tenant_users.id"],
            ondelete="RESTRICT",
            name="fk_media_objects_tenant_uploader",
        ),
        Index("ix_media_objects_tenant_status", "tenant_id", "status"),
    )

    tenant_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("sites.id", ondelete="CASCADE")
    )
    bucket: Mapped[str] = mapped_column(Text, nullable=False)
    object_key: Mapped[str] = mapped_column(Text, nullable=False)
    original_filename: Mapped[str | None] = mapped_column(Text)
    content_type: Mapped[str] = mapped_column(Text, nullable=False)
    size_bytes: Mapped[int] = mapped_column(Integer, nullable=False)
    checksum_sha256: Mapped[str | None] = mapped_column(Text)
    kind: Mapped[MediaKind] = mapped_column(
        PGEnum(MediaKind, name="media_kind", create_type=False), nullable=False
    )
    status: Mapped[MediaStatus] = mapped_column(
        PGEnum(MediaStatus, name="media_status", create_type=False),
        nullable=False,
        server_default=sql_text("'pending'"),
    )
    uploaded_by_platform_user_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("platform_users.id", ondelete="SET NULL")
    )
    uploaded_by_tenant_user_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True))
    public_url: Mapped[str | None] = mapped_column(Text)
    metadata_json: Mapped[dict[str, Any]] = mapped_column(
        "metadata", JSONB, nullable=False, server_default=sql_text("'{}'::jsonb")
    )
    deleted_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))


class PetPhoto(UUIDPrimaryKeyMixin, Base):
    __tablename__ = "pet_photos"
    __table_args__ = (
        UniqueConstraint("tenant_id", "id", name="uq_pet_photos_tenant_id_id"),
        ForeignKeyConstraint(
            ["tenant_id", "pet_id"],
            ["pets.tenant_id", "pets.id"],
            ondelete="CASCADE",
            name="fk_pet_photos_tenant_pet",
        ),
        ForeignKeyConstraint(
            ["tenant_id", "media_object_id"],
            ["media_objects.tenant_id", "media_objects.id"],
            ondelete="RESTRICT",
            name="fk_pet_photos_tenant_media",
        ),
        CheckConstraint("position >= 0", name="nonnegative_position"),
        Index("ix_pet_photos_tenant_pet", "tenant_id", "pet_id"),
        Index(
            "uq_pet_photos_one_cover_per_pet",
            "tenant_id",
            "pet_id",
            unique=True,
            postgresql_where=sql_text("is_cover"),
        ),
    )

    tenant_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("sites.id", ondelete="CASCADE"), nullable=False
    )
    pet_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), nullable=False)
    media_object_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True))
    url: Mapped[str] = mapped_column(Text, nullable=False)
    is_cover: Mapped[bool] = mapped_column(
        Boolean, nullable=False, server_default=sql_text("false")
    )
    position: Mapped[int] = mapped_column(Integer, nullable=False, server_default=sql_text("0"))
    uploaded_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )


class PetDocument(UUIDPrimaryKeyMixin, Base):
    __tablename__ = "pet_documents"
    __table_args__ = (
        UniqueConstraint("tenant_id", "id", name="uq_pet_documents_tenant_id_id"),
        ForeignKeyConstraint(
            ["tenant_id", "pet_id"],
            ["pets.tenant_id", "pets.id"],
            ondelete="CASCADE",
            name="fk_pet_documents_tenant_pet",
        ),
        ForeignKeyConstraint(
            ["tenant_id", "media_object_id"],
            ["media_objects.tenant_id", "media_objects.id"],
            ondelete="RESTRICT",
            name="fk_pet_documents_tenant_media",
        ),
        CheckConstraint(
            "document_type IN ('passport')",
            name="pet_documents_document_type_valid",
        ),
        Index("ix_pet_documents_tenant_pet", "tenant_id", "pet_id"),
    )

    tenant_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("sites.id", ondelete="CASCADE"), nullable=False
    )
    pet_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), nullable=False)
    media_object_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True))
    document_type: Mapped[str] = mapped_column(Text, nullable=False)
    original_filename: Mapped[str | None] = mapped_column(Text)
    url: Mapped[str] = mapped_column(Text, nullable=False)
    uploaded_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )


class Appointment(UUIDPrimaryKeyMixin, TimestampMixin, Base):
    __tablename__ = "appointments"
    __table_args__ = (
        UniqueConstraint("tenant_id", "id", name="uq_appointments_tenant_id_id"),
        ForeignKeyConstraint(
            ["tenant_id", "tenant_user_id"],
            ["tenant_users.tenant_id", "tenant_users.id"],
            ondelete="RESTRICT",
            name="fk_appointments_tenant_user",
        ),
        ForeignKeyConstraint(
            ["tenant_id", "service_id"],
            ["services.tenant_id", "services.id"],
            ondelete="RESTRICT",
            name="fk_appointments_tenant_service",
        ),
        ForeignKeyConstraint(
            ["tenant_id", "staff_id"],
            ["staff.tenant_id", "staff.id"],
            ondelete="RESTRICT",
            name="fk_appointments_tenant_staff",
        ),
        CheckConstraint("end_at > start_at", name="valid_period"),
        CheckConstraint("price IS NULL OR price >= 0", name="nonnegative_price"),
        CheckConstraint("version > 0", name="positive_version"),
        ExcludeConstraint(
            ("tenant_id", "="),
            ("staff_id", "="),
            (sql_text("tstzrange(start_at, end_at, '[)')"), "&&"),
            where=sql_text("staff_id IS NOT NULL AND status IN ('new', 'confirmed')"),
            using="gist",
            name="excl_appointments_staff_active_overlap",
        ),
        Index("ix_appointments_tenant_start", "tenant_id", "start_at"),
        Index("ix_appointments_staff_start", "staff_id", "start_at"),
        Index(
            "ix_appointments_tenant_user_start",
            "tenant_id",
            "tenant_user_id",
            "start_at",
        ),
    )

    tenant_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("sites.id", ondelete="CASCADE"), nullable=False
    )
    tenant_user_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), nullable=False)
    service_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), nullable=False)
    staff_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True))
    start_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    end_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    status: Mapped[AppointmentStatus] = mapped_column(
        PGEnum(AppointmentStatus, name="appointment_status", create_type=False),
        nullable=False,
        server_default=sql_text("'new'"),
    )
    price: Mapped[Decimal | None] = mapped_column(Numeric(10, 2))
    prepaid: Mapped[bool] = mapped_column(Boolean, nullable=False, server_default=sql_text("false"))
    notes: Mapped[str | None] = mapped_column(Text)
    canceled_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    cancellation_reason: Mapped[str | None] = mapped_column(Text)
    version: Mapped[int] = mapped_column(Integer, nullable=False, server_default=sql_text("1"))


class AppointmentItem(UUIDPrimaryKeyMixin, Base):
    __tablename__ = "appointment_items"
    __table_args__ = (
        UniqueConstraint("tenant_id", "id", name="uq_appointment_items_tenant_id_id"),
        UniqueConstraint(
            "tenant_id",
            "service_id",
            "id",
            name="uq_appointment_items_tenant_service_id",
        ),
        ForeignKeyConstraint(
            ["tenant_id", "appointment_id"],
            ["appointments.tenant_id", "appointments.id"],
            ondelete="CASCADE",
            name="fk_appointment_items_tenant_appointment",
        ),
        ForeignKeyConstraint(
            ["tenant_id", "service_id"],
            ["services.tenant_id", "services.id"],
            ondelete="RESTRICT",
            name="fk_appointment_items_tenant_service",
        ),
        ForeignKeyConstraint(
            ["tenant_id", "service_id", "variant_id"],
            [
                "service_variants.tenant_id",
                "service_variants.service_id",
                "service_variants.id",
            ],
            ondelete="RESTRICT",
            name="fk_appointment_items_tenant_service_variant",
        ),
        ForeignKeyConstraint(
            ["tenant_id", "assigned_staff_id"],
            ["staff.tenant_id", "staff.id"],
            ondelete="RESTRICT",
            name="fk_appointment_items_tenant_staff",
        ),
        CheckConstraint("unit_price >= 0", name="nonnegative_unit_price"),
        CheckConstraint("final_price IS NULL OR final_price >= 0", name="nonnegative_final_price"),
        CheckConstraint("duration_min > 0", name="positive_duration"),
        CheckConstraint("buffer_before_min >= 0", name="nonnegative_buffer_before"),
        CheckConstraint("buffer_after_min >= 0", name="nonnegative_buffer_after"),
        CheckConstraint("sort_order >= 0", name="nonnegative_sort_order"),
        CheckConstraint("char_length(currency) = 3", name="currency_code_length"),
        Index("ix_appointment_items_tenant_appointment", "tenant_id", "appointment_id"),
        Index("ix_appointment_items_tenant_service", "tenant_id", "service_id"),
    )

    tenant_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("sites.id", ondelete="CASCADE"), nullable=False
    )
    appointment_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), nullable=False)
    service_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), nullable=False)
    variant_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True))
    assigned_staff_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True))
    service_name_snapshot: Mapped[str] = mapped_column(Text, nullable=False)
    variant_label_snapshot: Mapped[str | None] = mapped_column(Text)
    selected_options: Mapped[dict[str, Any]] = mapped_column(
        JSONB, nullable=False, server_default=sql_text("'{}'::jsonb")
    )
    unit_price: Mapped[Decimal] = mapped_column(Numeric(12, 2), nullable=False)
    duration_min: Mapped[int] = mapped_column(Integer, nullable=False)
    buffer_before_min: Mapped[int] = mapped_column(
        Integer, nullable=False, server_default=sql_text("0")
    )
    buffer_after_min: Mapped[int] = mapped_column(
        Integer, nullable=False, server_default=sql_text("0")
    )
    currency: Mapped[str] = mapped_column(Text, nullable=False, server_default=sql_text("'RUB'"))
    sort_order: Mapped[int] = mapped_column(Integer, nullable=False, server_default=sql_text("0"))
    final_price: Mapped[Decimal | None] = mapped_column(Numeric(12, 2))
    adjustment_reason: Mapped[str | None] = mapped_column(Text)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )


class AppointmentItemAddon(UUIDPrimaryKeyMixin, Base):
    __tablename__ = "appointment_item_addons"
    __table_args__ = (
        UniqueConstraint("tenant_id", "id", name="uq_appointment_item_addons_tenant_id_id"),
        UniqueConstraint(
            "tenant_id",
            "appointment_item_id",
            "addon_id",
            name="uq_appointment_item_addons_item_addon",
        ),
        ForeignKeyConstraint(
            ["tenant_id", "service_id", "appointment_item_id"],
            [
                "appointment_items.tenant_id",
                "appointment_items.service_id",
                "appointment_items.id",
            ],
            ondelete="CASCADE",
            name="fk_appointment_item_addons_tenant_item",
        ),
        ForeignKeyConstraint(
            ["tenant_id", "service_id", "addon_id"],
            ["service_addons.tenant_id", "service_addons.service_id", "service_addons.id"],
            ondelete="RESTRICT",
            name="fk_appointment_item_addons_tenant_service_addon",
        ),
        CheckConstraint("price_snapshot >= 0", name="nonnegative_price_snapshot"),
        CheckConstraint("duration_min_snapshot >= 0", name="nonnegative_duration_snapshot"),
        CheckConstraint("sort_order >= 0", name="nonnegative_sort_order"),
        Index("ix_appointment_item_addons_tenant_item", "tenant_id", "appointment_item_id"),
    )

    tenant_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("sites.id", ondelete="CASCADE"), nullable=False
    )
    appointment_item_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), nullable=False)
    service_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), nullable=False)
    addon_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), nullable=False)
    name_snapshot: Mapped[str] = mapped_column(Text, nullable=False)
    price_snapshot: Mapped[Decimal] = mapped_column(Numeric(12, 2), nullable=False)
    duration_min_snapshot: Mapped[int] = mapped_column(Integer, nullable=False)
    sort_order: Mapped[int] = mapped_column(Integer, nullable=False, server_default=sql_text("0"))
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )


class Review(UUIDPrimaryKeyMixin, TimestampMixin, Base):
    __tablename__ = "reviews"
    __table_args__ = (
        UniqueConstraint("tenant_id", "id", name="uq_reviews_tenant_id_id"),
        ForeignKeyConstraint(
            ["tenant_id", "tenant_user_id"],
            ["tenant_users.tenant_id", "tenant_users.id"],
            ondelete="CASCADE",
            name="fk_reviews_tenant_user",
        ),
        ForeignKeyConstraint(
            ["tenant_id", "appointment_id"],
            ["appointments.tenant_id", "appointments.id"],
            ondelete="RESTRICT",
            name="fk_reviews_tenant_appointment",
        ),
        UniqueConstraint("tenant_id", "appointment_id", name="uq_reviews_tenant_appointment"),
        CheckConstraint("rating BETWEEN 1 AND 5", name="rating_range"),
        Index("ix_reviews_tenant_status_created", "tenant_id", "status", "created_at"),
    )

    tenant_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("sites.id", ondelete="CASCADE"), nullable=False
    )
    tenant_user_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), nullable=False)
    appointment_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True))
    rating: Mapped[int] = mapped_column(SmallInteger, nullable=False)
    text: Mapped[str | None] = mapped_column(Text)
    status: Mapped[ReviewStatus] = mapped_column(
        PGEnum(ReviewStatus, name="review_status", create_type=False),
        nullable=False,
        server_default=sql_text("'pending'"),
    )
    moderated_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))


class Promotion(UUIDPrimaryKeyMixin, TimestampMixin, Base):
    __tablename__ = "promotions"
    __table_args__ = (
        UniqueConstraint("tenant_id", "id", name="uq_promotions_tenant_id_id"),
        UniqueConstraint("tenant_id", "promo_code", name="uq_promotions_tenant_promo_code"),
        CheckConstraint(
            "discount_percent IS NULL OR discount_percent BETWEEN 0 AND 100",
            name="discount_range",
        ),
        CheckConstraint(
            "valid_to IS NULL OR valid_from IS NULL OR valid_to >= valid_from",
            name="valid_date_range",
        ),
        CheckConstraint("used_count >= 0", name="nonnegative_used_count"),
        CheckConstraint("max_uses IS NULL OR max_uses > 0", name="positive_max_uses"),
        CheckConstraint(
            "max_uses IS NULL OR used_count <= max_uses",
            name="usage_within_limit",
        ),
        Index("ix_promotions_tenant_active", "tenant_id", "is_active"),
    )

    tenant_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("sites.id", ondelete="CASCADE"), nullable=False
    )
    title: Mapped[str | None] = mapped_column(Text)
    description: Mapped[str | None] = mapped_column(Text)
    discount_percent: Mapped[int | None] = mapped_column(SmallInteger)
    promo_code: Mapped[str | None] = mapped_column(CITEXT())
    valid_from: Mapped[date | None] = mapped_column(Date)
    valid_to: Mapped[date | None] = mapped_column(Date)
    max_uses: Mapped[int | None] = mapped_column(Integer)
    used_count: Mapped[int] = mapped_column(Integer, nullable=False, server_default=sql_text("0"))
    is_active: Mapped[bool] = mapped_column(
        Boolean, nullable=False, server_default=sql_text("true")
    )


class LoyaltyAccount(UUIDPrimaryKeyMixin, TimestampMixin, Base):
    __tablename__ = "loyalty_accounts"
    __table_args__ = (
        UniqueConstraint("tenant_id", "id", name="uq_loyalty_accounts_tenant_id_id"),
        UniqueConstraint("tenant_id", "tenant_user_id", name="uq_loyalty_accounts_tenant_user"),
        ForeignKeyConstraint(
            ["tenant_id", "tenant_user_id"],
            ["tenant_users.tenant_id", "tenant_users.id"],
            ondelete="CASCADE",
            name="fk_loyalty_accounts_tenant_user",
        ),
        CheckConstraint("points_balance >= 0", name="nonnegative_balance"),
    )

    tenant_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("sites.id", ondelete="CASCADE"), nullable=False
    )
    tenant_user_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), nullable=False)
    points_balance: Mapped[int] = mapped_column(
        Integer, nullable=False, server_default=sql_text("0")
    )
    lifetime_earned: Mapped[int] = mapped_column(
        Integer, nullable=False, server_default=sql_text("0")
    )


class LoyaltyTransaction(UUIDPrimaryKeyMixin, Base):
    __tablename__ = "loyalty_transactions"
    __table_args__ = (
        UniqueConstraint("tenant_id", "id", name="uq_loyalty_transactions_tenant_id_id"),
        ForeignKeyConstraint(
            ["tenant_id", "account_id"],
            ["loyalty_accounts.tenant_id", "loyalty_accounts.id"],
            ondelete="CASCADE",
            name="fk_loyalty_transactions_tenant_account",
        ),
        ForeignKeyConstraint(
            ["tenant_id", "appointment_id"],
            ["appointments.tenant_id", "appointments.id"],
            ondelete="RESTRICT",
            name="fk_loyalty_transactions_tenant_appointment",
        ),
        CheckConstraint("points_delta <> 0", name="nonzero_delta"),
        CheckConstraint("balance_after >= 0", name="nonnegative_balance_after"),
        Index(
            "ix_loyalty_transactions_account_created",
            "tenant_id",
            "account_id",
            "created_at",
        ),
    )

    tenant_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("sites.id", ondelete="CASCADE"), nullable=False
    )
    account_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), nullable=False)
    appointment_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True))
    type: Mapped[LoyaltyTransactionType] = mapped_column(
        PGEnum(
            LoyaltyTransactionType,
            name="loyalty_transaction_type",
            create_type=False,
        ),
        nullable=False,
    )
    points_delta: Mapped[int] = mapped_column(Integer, nullable=False)
    balance_after: Mapped[int] = mapped_column(Integer, nullable=False)
    reason: Mapped[str | None] = mapped_column(Text)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )


class NotificationPreference(UUIDPrimaryKeyMixin, TimestampMixin, Base):
    __tablename__ = "notification_preferences"
    __table_args__ = (
        UniqueConstraint("tenant_id", "id", name="uq_notification_preferences_tenant_id_id"),
        UniqueConstraint(
            "tenant_id",
            "tenant_user_id",
            name="uq_notification_preferences_tenant_user",
        ),
        ForeignKeyConstraint(
            ["tenant_id", "tenant_user_id"],
            ["tenant_users.tenant_id", "tenant_users.id"],
            ondelete="CASCADE",
            name="fk_notification_preferences_tenant_user",
        ),
        CheckConstraint("reminder_hours_before > 0", name="positive_reminder_hours"),
        CheckConstraint(
            "jsonb_typeof(reminder_hours) = 'array'",
            name="reminder_hours_is_array",
        ),
    )

    tenant_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("sites.id", ondelete="CASCADE"), nullable=False
    )
    tenant_user_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), nullable=False)
    email_enabled: Mapped[bool] = mapped_column(
        Boolean, nullable=False, server_default=sql_text("true")
    )
    sms_enabled: Mapped[bool] = mapped_column(
        Boolean, nullable=False, server_default=sql_text("false")
    )
    telegram_enabled: Mapped[bool] = mapped_column(
        Boolean, nullable=False, server_default=sql_text("false")
    )
    marketing_enabled: Mapped[bool] = mapped_column(
        Boolean, nullable=False, server_default=sql_text("false")
    )
    appointment_reminders_enabled: Mapped[bool] = mapped_column(
        Boolean, nullable=False, server_default=sql_text("true")
    )
    reminder_hours_before: Mapped[int] = mapped_column(
        SmallInteger, nullable=False, server_default=sql_text("24")
    )
    reminder_hours: Mapped[list[int]] = mapped_column(
        JSONB, nullable=False, server_default=sql_text("'[24]'::jsonb")
    )
    telegram_chat_id: Mapped[str | None] = mapped_column(Text)


class Notification(UUIDPrimaryKeyMixin, TimestampMixin, Base):
    __tablename__ = "notifications"
    __table_args__ = (
        UniqueConstraint("tenant_id", "id", name="uq_notifications_tenant_id_id"),
        CheckConstraint(
            "target_type <> 'tenant_user' OR tenant_id IS NOT NULL",
            name="tenant_target_requires_tenant",
        ),
        Index("ix_notifications_queue", "status", "scheduled_at"),
        Index("ix_notifications_tenant_target", "tenant_id", "target_id"),
    )

    tenant_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("sites.id", ondelete="CASCADE")
    )
    target_type: Mapped[NotificationTargetType] = mapped_column(
        PGEnum(
            NotificationTargetType,
            name="notification_target_type",
            create_type=False,
        ),
        nullable=False,
    )
    target_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), nullable=False)
    channel: Mapped[NotificationChannel] = mapped_column(
        PGEnum(NotificationChannel, name="notification_channel", create_type=False),
        nullable=False,
    )
    template: Mapped[str] = mapped_column(Text, nullable=False)
    payload: Mapped[dict[str, Any]] = mapped_column(
        JSONB, nullable=False, server_default=sql_text("'{}'::jsonb")
    )
    status: Mapped[NotificationStatus] = mapped_column(
        PGEnum(NotificationStatus, name="notification_status", create_type=False),
        nullable=False,
        server_default=sql_text("'queued'"),
    )
    scheduled_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    sent_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    attempts: Mapped[int] = mapped_column(
        SmallInteger, nullable=False, server_default=sql_text("0")
    )
    last_error: Mapped[str | None] = mapped_column(Text)


class CustomLandingOrder(UUIDPrimaryKeyMixin, TimestampMixin, Base):
    __tablename__ = "custom_landing_orders"
    __table_args__ = (
        UniqueConstraint("tenant_id", "id", name="uq_custom_landing_orders_tenant_id_id"),
        CheckConstraint("price >= 0", name="nonnegative_price"),
        Index("ix_custom_landing_orders_tenant_status", "tenant_id", "status"),
    )

    tenant_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("sites.id", ondelete="CASCADE"), nullable=False
    )
    status: Mapped[CustomLandingStatus] = mapped_column(
        PGEnum(
            CustomLandingStatus,
            name="custom_landing_status",
            create_type=False,
        ),
        nullable=False,
        server_default=sql_text("'requested'"),
    )
    price: Mapped[Decimal] = mapped_column(
        Numeric(10, 2), nullable=False, server_default=sql_text("20000.00")
    )
    contact: Mapped[str | None] = mapped_column(Text)
    notes: Mapped[str | None] = mapped_column(Text)
    delivered_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))


class Payment(UUIDPrimaryKeyMixin, TimestampMixin, Base):
    __tablename__ = "payments"
    __table_args__ = (
        UniqueConstraint("tenant_id", "id", name="uq_payments_tenant_id_id"),
        UniqueConstraint("provider", "provider_payment_id", name="uq_payments_provider_payment"),
        ForeignKeyConstraint(
            ["tenant_id", "appointment_id"],
            ["appointments.tenant_id", "appointments.id"],
            ondelete="RESTRICT",
            name="fk_payments_tenant_appointment",
        ),
        ForeignKeyConstraint(
            ["tenant_id", "custom_landing_order_id"],
            ["custom_landing_orders.tenant_id", "custom_landing_orders.id"],
            ondelete="RESTRICT",
            name="fk_payments_tenant_custom_landing_order",
        ),
        CheckConstraint("amount >= 0", name="nonnegative_amount"),
        CheckConstraint(
            "appointment_id IS NULL OR tenant_id IS NOT NULL",
            name="appointment_requires_tenant",
        ),
        Index("ix_payments_tenant_created", "tenant_id", "created_at"),
        Index("ix_payments_status_created", "status", "created_at"),
    )

    tenant_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("sites.id", ondelete="SET NULL")
    )
    subscription_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("subscriptions.id", ondelete="SET NULL")
    )
    appointment_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True))
    custom_landing_order_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True))
    purpose: Mapped[PaymentPurpose] = mapped_column(
        PGEnum(PaymentPurpose, name="payment_purpose", create_type=False),
        nullable=False,
    )
    amount: Mapped[Decimal] = mapped_column(Numeric(10, 2), nullable=False)
    currency: Mapped[str] = mapped_column(Text, nullable=False, server_default=sql_text("'RUB'"))
    provider: Mapped[str] = mapped_column(Text, nullable=False)
    provider_payment_id: Mapped[str | None] = mapped_column(Text)
    payment_method_id: Mapped[str | None] = mapped_column(Text)
    status: Mapped[PaymentStatus] = mapped_column(
        PGEnum(PaymentStatus, name="payment_status", create_type=False),
        nullable=False,
        server_default=sql_text("'pending'"),
    )
    paid_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    refunded_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    provider_payload: Mapped[dict[str, Any]] = mapped_column(
        JSONB, nullable=False, server_default=sql_text("'{}'::jsonb")
    )


class AuthToken(UUIDPrimaryKeyMixin, Base):
    __tablename__ = "auth_tokens"
    __table_args__ = (
        UniqueConstraint("token_hash", name="uq_auth_tokens_token_hash"),
        CheckConstraint(
            "user_type = 'platform' OR tenant_id IS NOT NULL",
            name="tenant_user_requires_tenant",
        ),
        Index("ix_auth_tokens_user", "user_type", "user_id"),
        Index("ix_auth_tokens_expires", "expires_at"),
    )

    tenant_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("sites.id", ondelete="CASCADE")
    )
    user_type: Mapped[AuthUserType] = mapped_column(
        PGEnum(AuthUserType, name="auth_user_type", create_type=False), nullable=False
    )
    user_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), nullable=False)
    type: Mapped[AuthTokenType] = mapped_column(
        PGEnum(AuthTokenType, name="auth_token_type", create_type=False), nullable=False
    )
    token_hash: Mapped[str] = mapped_column(Text, nullable=False)
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    used_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )


class RefreshToken(UUIDPrimaryKeyMixin, Base):
    __tablename__ = "refresh_tokens"
    __table_args__ = (
        UniqueConstraint("jti", name="uq_refresh_tokens_jti"),
        UniqueConstraint("token_hash", name="uq_refresh_tokens_token_hash"),
        CheckConstraint(
            "user_type = 'platform' OR tenant_id IS NOT NULL",
            name="tenant_user_requires_tenant",
        ),
        Index("ix_refresh_tokens_user", "user_type", "user_id"),
        Index("ix_refresh_tokens_family", "family_id"),
        Index("ix_refresh_tokens_expires", "expires_at"),
    )

    tenant_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("sites.id", ondelete="CASCADE")
    )
    user_type: Mapped[AuthUserType] = mapped_column(
        PGEnum(AuthUserType, name="auth_user_type", create_type=False), nullable=False
    )
    user_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), nullable=False)
    jti: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), nullable=False)
    family_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), nullable=False)
    token_hash: Mapped[str] = mapped_column(Text, nullable=False)
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    revoked_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    replaced_by_jti: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True))
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )


class AuditLog(UUIDPrimaryKeyMixin, Base):
    __tablename__ = "audit_logs"
    __table_args__ = (
        Index("ix_audit_logs_tenant_created", "tenant_id", "created_at"),
        Index("ix_audit_logs_entity", "entity_type", "entity_id"),
    )

    tenant_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("sites.id", ondelete="SET NULL")
    )
    actor_type: Mapped[AuditActorType] = mapped_column(
        PGEnum(AuditActorType, name="audit_actor_type", create_type=False),
        nullable=False,
    )
    actor_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True))
    action: Mapped[str] = mapped_column(Text, nullable=False)
    entity_type: Mapped[str] = mapped_column(Text, nullable=False)
    entity_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True))
    before: Mapped[dict[str, Any] | None] = mapped_column(JSONB)
    after: Mapped[dict[str, Any] | None] = mapped_column(JSONB)
    request_id: Mapped[str | None] = mapped_column(Text)
    ip_address: Mapped[str | None] = mapped_column(Text)
    user_agent: Mapped[str | None] = mapped_column(Text)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )


class WebhookEvent(UUIDPrimaryKeyMixin, Base):
    __tablename__ = "webhook_events"
    __table_args__ = (
        UniqueConstraint("provider", "event_id", name="uq_webhook_events_provider_event"),
        Index("ix_webhook_events_status_received", "status", "received_at"),
    )

    tenant_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("sites.id", ondelete="SET NULL")
    )
    provider: Mapped[str] = mapped_column(Text, nullable=False)
    event_id: Mapped[str] = mapped_column(Text, nullable=False)
    event_type: Mapped[str] = mapped_column(Text, nullable=False)
    payload: Mapped[dict[str, Any]] = mapped_column(JSONB, nullable=False)
    headers: Mapped[dict[str, Any]] = mapped_column(
        JSONB, nullable=False, server_default=sql_text("'{}'::jsonb")
    )
    signature_verified: Mapped[bool] = mapped_column(
        Boolean, nullable=False, server_default=sql_text("false")
    )
    status: Mapped[WebhookEventStatus] = mapped_column(
        PGEnum(
            WebhookEventStatus,
            name="webhook_event_status",
            create_type=False,
        ),
        nullable=False,
        server_default=sql_text("'received'"),
    )
    attempts: Mapped[int] = mapped_column(
        SmallInteger, nullable=False, server_default=sql_text("0")
    )
    error: Mapped[str | None] = mapped_column(Text)
    received_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )
    processed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))


class IdempotencyKey(UUIDPrimaryKeyMixin, Base):
    __tablename__ = "idempotency_keys"
    __table_args__ = (
        UniqueConstraint("scope", "key", name="uq_idempotency_keys_scope_key"),
        Index("ix_idempotency_keys_expires", "expires_at"),
    )

    tenant_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("sites.id", ondelete="CASCADE")
    )
    scope: Mapped[str] = mapped_column(Text, nullable=False)
    key: Mapped[str] = mapped_column(Text, nullable=False)
    request_hash: Mapped[str] = mapped_column(Text, nullable=False)
    status: Mapped[IdempotencyStatus] = mapped_column(
        PGEnum(IdempotencyStatus, name="idempotency_status", create_type=False),
        nullable=False,
        server_default=sql_text("'processing'"),
    )
    response_status: Mapped[int | None] = mapped_column(Integer)
    response_body: Mapped[dict[str, Any] | None] = mapped_column(JSONB)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)


__all__ = [
    "Appointment",
    "AppointmentStatus",
    "AuditLog",
    "AuthToken",
    "CustomLandingOrder",
    "ClientHairProfile",
    "IdempotencyKey",
    "LoyaltyAccount",
    "LoyaltyTransaction",
    "MediaObject",
    "Notification",
    "NotificationPreference",
    "Payment",
    "Pet",
    "PetPhoto",
    "Plan",
    "PlatformUser",
    "Promotion",
    "RefreshToken",
    "Review",
    "SalonType",
    "ScheduleException",
    "Service",
    "Site",
    "SiteBlock",
    "SiteVersion",
    "Staff",
    "StaffService",
    "Subscription",
    "TenantUser",
    "WebhookEvent",
]
