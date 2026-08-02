"""Начальная схема TrimmyCRM с изоляцией арендаторов.

Идентификатор ревизии: 0001_initial
Предыдущая ревизия:
Дата создания: 2026-07-14
"""

from __future__ import annotations

from collections.abc import Iterable

from alembic import op

revision = "0001_initial"
down_revision = None
branch_labels = None
depends_on = None


ENUMS: dict[str, tuple[str, ...]] = {
    "platform_user_role": ("superadmin", "owner", "staff"),
    "platform_user_status": ("active", "blocked", "pending"),
    "billing_period": ("month", "year"),
    "subscription_status": (
        "trialing",
        "active",
        "past_due",
        "canceled",
        "expired",
    ),
    "site_status": ("draft", "published", "suspended"),
    "domain_verification_status": (
        "not_configured",
        "pending",
        "verified",
        "failed",
    ),
    "tls_status": ("not_requested", "pending", "issued", "failed"),
    "site_version_status": ("draft", "published", "archived"),
    "tenant_user_status": ("crm_only", "pending", "active", "blocked", "anonymized"),
    "pet_species": ("dog", "cat", "other"),
    "schedule_exception_type": ("unavailable", "available"),
    "appointment_status": ("new", "confirmed", "completed", "cancelled", "no_show"),
    "review_status": ("pending", "published", "rejected"),
    "notification_target_type": ("tenant_user", "platform_user"),
    "notification_channel": ("email", "sms", "telegram"),
    "notification_status": ("queued", "processing", "sent", "failed", "canceled"),
    "payment_purpose": ("subscription", "custom_landing", "prepayment"),
    "payment_status": ("pending", "succeeded", "canceled", "refunded"),
    "custom_landing_status": (
        "requested",
        "paid",
        "in_progress",
        "delivered",
        "cancelled",
    ),
    "auth_user_type": ("platform", "tenant"),
    "auth_token_type": ("email_verify", "password_reset"),
    "loyalty_transaction_type": ("earn", "spend", "adjustment", "expire"),
    "media_kind": ("image", "document"),
    "media_status": ("pending", "ready", "rejected", "deleted"),
    "audit_actor_type": ("platform_user", "tenant_user", "system"),
    "webhook_event_status": ("received", "processed", "ignored", "failed"),
    "idempotency_status": ("processing", "completed", "failed"),
}


STRICT_TENANT_TABLES = (
    "site_blocks",
    "site_versions",
    "services",
    "staff",
    "staff_services",
    "schedule_exceptions",
    "tenant_users",
    "pets",
    "pet_photos",
    "appointments",
    "reviews",
    "promotions",
    "loyalty_accounts",
    "loyalty_transactions",
    "notification_preferences",
    "custom_landing_orders",
)

NULLABLE_TENANT_TABLES = (
    "media_objects",
    "notifications",
    "payments",
    "auth_tokens",
    "refresh_tokens",
    "audit_logs",
    "webhook_events",
    "idempotency_keys",
)

ALL_TABLES = (
    "platform_users",
    "plans",
    "subscriptions",
    "sites",
    *STRICT_TENANT_TABLES,
    *NULLABLE_TENANT_TABLES,
)


def _execute(statement: str) -> None:
    # По одному SQL-выражению на вызов — так сохраняется совместимость
    # с подготовленными выражениями asyncpg.
    op.execute(statement)


def _execute_many(statements: Iterable[str]) -> None:
    for statement in statements:
        _execute(statement)


def upgrade() -> None:
    _execute_many(
        (
            "CREATE EXTENSION IF NOT EXISTS pgcrypto",
            "CREATE EXTENSION IF NOT EXISTS citext",
            "CREATE EXTENSION IF NOT EXISTS btree_gist",
            """
            DO $role$
            BEGIN
              IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'trimmycrm_app') THEN
                CREATE ROLE trimmycrm_app LOGIN;
              END IF;
              IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'trimmycrm_admin_api') THEN
                CREATE ROLE trimmycrm_admin_api LOGIN;
              END IF;
            END
            $role$
            """,
            "ALTER ROLE trimmycrm_app NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOBYPASSRLS",
            "ALTER ROLE trimmycrm_admin_api NOSUPERUSER NOCREATEDB NOCREATEROLE "
            "NOINHERIT NOBYPASSRLS",
            "GRANT USAGE ON SCHEMA public TO trimmycrm_app",
            "GRANT USAGE ON SCHEMA public TO trimmycrm_admin_api",
        )
    )

    for enum_name, values in ENUMS.items():
        enum_values = ", ".join("'" + value.replace("'", "''") + "'" for value in values)
        _execute(f"CREATE TYPE {enum_name} AS ENUM ({enum_values})")

    _execute_many(
        (
            """
            CREATE TABLE platform_users (
              id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
              email citext NOT NULL UNIQUE,
              password_hash text NOT NULL,
              role platform_user_role NOT NULL DEFAULT 'owner',
              full_name text,
              phone text,
              email_verified boolean NOT NULL DEFAULT false,
              status platform_user_status NOT NULL DEFAULT 'pending',
              personal_data_consent_at timestamptz,
              last_login_at timestamptz,
              created_at timestamptz NOT NULL DEFAULT now(),
              updated_at timestamptz NOT NULL DEFAULT now()
            )
            """,
            """
            CREATE TABLE plans (
              id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
              code text NOT NULL UNIQUE,
              name text NOT NULL,
              price numeric(10,2) NOT NULL CHECK (price >= 0),
              period billing_period NOT NULL DEFAULT 'month',
              limits jsonb NOT NULL DEFAULT '{}'::jsonb,
              features jsonb NOT NULL DEFAULT '[]'::jsonb,
              is_active boolean NOT NULL DEFAULT true
            )
            """,
            """
            CREATE TABLE subscriptions (
              id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
              owner_id uuid NOT NULL REFERENCES platform_users(id) ON DELETE RESTRICT,
              plan_id uuid NOT NULL REFERENCES plans(id) ON DELETE RESTRICT,
              status subscription_status NOT NULL,
              current_period_start timestamptz,
              current_period_end timestamptz,
              auto_renew boolean NOT NULL DEFAULT true,
              provider_sub_id text,
              payment_method_id text,
              dunning_attempts smallint NOT NULL DEFAULT 0 CHECK (dunning_attempts >= 0),
              next_dunning_at timestamptz,
              last_payment_attempt_at timestamptz,
              grace_period_end timestamptz,
              canceled_at timestamptz,
              created_at timestamptz NOT NULL DEFAULT now(),
              updated_at timestamptz NOT NULL DEFAULT now()
            )
            """,
            """
            CREATE TABLE sites (
              id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
              owner_id uuid NOT NULL UNIQUE REFERENCES platform_users(id) ON DELETE RESTRICT,
              name text NOT NULL,
              slug citext NOT NULL UNIQUE,
              custom_domain citext UNIQUE,
              domain_verified boolean NOT NULL DEFAULT false,
              domain_verification_status domain_verification_status
                NOT NULL DEFAULT 'not_configured',
              domain_verification_token text,
              domain_verification_requested_at timestamptz,
              domain_verified_at timestamptz,
              domain_last_checked_at timestamptz,
              domain_verification_error text,
              tls_status tls_status NOT NULL DEFAULT 'not_requested',
              tls_issued_at timestamptz,
              description text,
              city text,
              street text,
              phone text,
              timezone text NOT NULL DEFAULT 'Europe/Moscow',
              work_hours jsonb NOT NULL DEFAULT '{}'::jsonb,
              socials jsonb NOT NULL DEFAULT '{}'::jsonb,
              logo_url text,
              theme jsonb NOT NULL DEFAULT '{}'::jsonb,
              template_key text NOT NULL DEFAULT 'default',
              status site_status NOT NULL DEFAULT 'draft',
              published_at timestamptz,
              created_at timestamptz NOT NULL DEFAULT now(),
              updated_at timestamptz NOT NULL DEFAULT now(),
              CONSTRAINT ck_sites_valid_slug CHECK (
                slug ~ '^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$'
              )
            )
            """,
            """
            CREATE TABLE site_blocks (
              id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
              tenant_id uuid NOT NULL REFERENCES sites(id) ON DELETE CASCADE,
              type text NOT NULL,
              position integer NOT NULL CHECK (position >= 0),
              config jsonb NOT NULL DEFAULT '{}'::jsonb,
              enabled boolean NOT NULL DEFAULT true,
              created_at timestamptz NOT NULL DEFAULT now(),
              updated_at timestamptz NOT NULL DEFAULT now(),
              UNIQUE (tenant_id, id),
              UNIQUE (tenant_id, position)
            )
            """,
            """
            CREATE TABLE site_versions (
              id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
              tenant_id uuid NOT NULL REFERENCES sites(id) ON DELETE CASCADE,
              version_no integer NOT NULL CHECK (version_no > 0),
              status site_version_status NOT NULL DEFAULT 'draft',
              snapshot jsonb NOT NULL,
              created_by_id uuid REFERENCES platform_users(id) ON DELETE SET NULL,
              created_at timestamptz NOT NULL DEFAULT now(),
              published_at timestamptz,
              UNIQUE (tenant_id, id),
              UNIQUE (tenant_id, version_no)
            )
            """,
            """
            CREATE TABLE services (
              id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
              tenant_id uuid NOT NULL REFERENCES sites(id) ON DELETE CASCADE,
              name text NOT NULL,
              description text,
              price numeric(10,2) NOT NULL CHECK (price >= 0),
              duration_min integer NOT NULL CHECK (duration_min > 0),
              buffer_before_min integer NOT NULL DEFAULT 0 CHECK (buffer_before_min >= 0),
              buffer_after_min integer NOT NULL DEFAULT 0 CHECK (buffer_after_min >= 0),
              category text,
              is_active boolean NOT NULL DEFAULT true,
              created_at timestamptz NOT NULL DEFAULT now(),
              updated_at timestamptz NOT NULL DEFAULT now(),
              UNIQUE (tenant_id, id)
            )
            """,
            """
            CREATE TABLE staff (
              id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
              tenant_id uuid NOT NULL REFERENCES sites(id) ON DELETE CASCADE,
              user_id uuid REFERENCES platform_users(id) ON DELETE SET NULL,
              name text NOT NULL,
              specialization text,
              photo_url text,
              schedule jsonb NOT NULL DEFAULT '{}'::jsonb,
              is_active boolean NOT NULL DEFAULT true,
              created_at timestamptz NOT NULL DEFAULT now(),
              updated_at timestamptz NOT NULL DEFAULT now(),
              UNIQUE (tenant_id, id),
              UNIQUE (tenant_id, user_id),
              CONSTRAINT uq_staff_user_id_global UNIQUE (user_id)
            )
            """,
            """
            CREATE TABLE staff_services (
              tenant_id uuid NOT NULL REFERENCES sites(id) ON DELETE CASCADE,
              staff_id uuid NOT NULL,
              service_id uuid NOT NULL,
              custom_price numeric(10,2) CHECK (custom_price IS NULL OR custom_price >= 0),
              custom_duration_min integer CHECK (
                custom_duration_min IS NULL OR custom_duration_min > 0
              ),
              PRIMARY KEY (tenant_id, staff_id, service_id),
              CONSTRAINT fk_staff_services_tenant_staff
                FOREIGN KEY (tenant_id, staff_id)
                REFERENCES staff(tenant_id, id) ON DELETE CASCADE,
              CONSTRAINT fk_staff_services_tenant_service
                FOREIGN KEY (tenant_id, service_id)
                REFERENCES services(tenant_id, id) ON DELETE CASCADE
            )
            """,
            """
            CREATE TABLE schedule_exceptions (
              id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
              tenant_id uuid NOT NULL REFERENCES sites(id) ON DELETE CASCADE,
              staff_id uuid NOT NULL,
              start_at timestamptz NOT NULL,
              end_at timestamptz NOT NULL,
              kind text NOT NULL DEFAULT 'break',
              type schedule_exception_type NOT NULL DEFAULT 'unavailable',
              reason text,
              created_at timestamptz NOT NULL DEFAULT now(),
              updated_at timestamptz NOT NULL DEFAULT now(),
              UNIQUE (tenant_id, id),
              CONSTRAINT fk_schedule_exceptions_tenant_staff
                FOREIGN KEY (tenant_id, staff_id)
                REFERENCES staff(tenant_id, id) ON DELETE CASCADE,
              CONSTRAINT ck_schedule_exceptions_valid_period CHECK (end_at > start_at),
              CONSTRAINT ck_schedule_exceptions_valid_kind
                CHECK (kind IN ('day_off', 'working', 'break'))
            )
            """,
            """
            CREATE TABLE tenant_users (
              id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
              tenant_id uuid NOT NULL REFERENCES sites(id) ON DELETE CASCADE,
              email citext,
              password_hash text,
              full_name text,
              phone text,
              email_verified boolean NOT NULL DEFAULT false,
              status tenant_user_status NOT NULL DEFAULT 'crm_only',
              personal_data_consent_at timestamptz,
              last_login_at timestamptz,
              anonymized_at timestamptz,
              created_at timestamptz NOT NULL DEFAULT now(),
              updated_at timestamptz NOT NULL DEFAULT now(),
              UNIQUE (tenant_id, id),
              UNIQUE (tenant_id, email)
            )
            """,
            """
            CREATE TABLE pets (
              id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
              tenant_id uuid NOT NULL REFERENCES sites(id) ON DELETE CASCADE,
              owner_id uuid NOT NULL,
              name text NOT NULL,
              species pet_species,
              breed text,
              birth_date date,
              weight_kg numeric(5,2) CHECK (weight_kg IS NULL OR weight_kg > 0),
              coat_type text,
              temperament text,
              allergies text,
              medical_notes text,
              vaccinated_until date,
              archived_at timestamptz,
              created_at timestamptz NOT NULL DEFAULT now(),
              updated_at timestamptz NOT NULL DEFAULT now(),
              UNIQUE (tenant_id, id),
              CONSTRAINT fk_pets_tenant_owner
                FOREIGN KEY (tenant_id, owner_id)
                REFERENCES tenant_users(tenant_id, id) ON DELETE CASCADE
            )
            """,
            """
            CREATE TABLE media_objects (
              id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
              tenant_id uuid REFERENCES sites(id) ON DELETE CASCADE,
              bucket text NOT NULL,
              object_key text NOT NULL,
              original_filename text,
              content_type text NOT NULL,
              size_bytes integer NOT NULL CHECK (size_bytes >= 0),
              checksum_sha256 text,
              kind media_kind NOT NULL,
              status media_status NOT NULL DEFAULT 'pending',
              uploaded_by_platform_user_id uuid REFERENCES platform_users(id) ON DELETE SET NULL,
              uploaded_by_tenant_user_id uuid,
              public_url text,
              metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
              deleted_at timestamptz,
              created_at timestamptz NOT NULL DEFAULT now(),
              updated_at timestamptz NOT NULL DEFAULT now(),
              UNIQUE (tenant_id, id),
              UNIQUE (bucket, object_key),
              CONSTRAINT fk_media_objects_tenant_uploader
                FOREIGN KEY (tenant_id, uploaded_by_tenant_user_id)
                REFERENCES tenant_users(tenant_id, id) ON DELETE RESTRICT
            )
            """,
            """
            CREATE TABLE pet_photos (
              id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
              tenant_id uuid NOT NULL REFERENCES sites(id) ON DELETE CASCADE,
              pet_id uuid NOT NULL,
              media_object_id uuid,
              url text NOT NULL,
              is_cover boolean NOT NULL DEFAULT false,
              position integer NOT NULL DEFAULT 0 CHECK (position >= 0),
              uploaded_at timestamptz NOT NULL DEFAULT now(),
              UNIQUE (tenant_id, id),
              CONSTRAINT fk_pet_photos_tenant_pet
                FOREIGN KEY (tenant_id, pet_id)
                REFERENCES pets(tenant_id, id) ON DELETE CASCADE,
              CONSTRAINT fk_pet_photos_tenant_media
                FOREIGN KEY (tenant_id, media_object_id)
                REFERENCES media_objects(tenant_id, id) ON DELETE RESTRICT
            )
            """,
            """
            CREATE TABLE appointments (
              id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
              tenant_id uuid NOT NULL REFERENCES sites(id) ON DELETE CASCADE,
              tenant_user_id uuid NOT NULL,
              pet_id uuid NOT NULL,
              service_id uuid NOT NULL,
              staff_id uuid,
              start_at timestamptz NOT NULL,
              end_at timestamptz NOT NULL,
              status appointment_status NOT NULL DEFAULT 'new',
              price numeric(10,2) CHECK (price IS NULL OR price >= 0),
              prepaid boolean NOT NULL DEFAULT false,
              notes text,
              canceled_at timestamptz,
              cancellation_reason text,
              version integer NOT NULL DEFAULT 1 CHECK (version > 0),
              created_at timestamptz NOT NULL DEFAULT now(),
              updated_at timestamptz NOT NULL DEFAULT now(),
              UNIQUE (tenant_id, id),
              CONSTRAINT fk_appointments_tenant_user
                FOREIGN KEY (tenant_id, tenant_user_id)
                REFERENCES tenant_users(tenant_id, id) ON DELETE RESTRICT,
              CONSTRAINT fk_appointments_tenant_pet
                FOREIGN KEY (tenant_id, pet_id)
                REFERENCES pets(tenant_id, id) ON DELETE RESTRICT,
              CONSTRAINT fk_appointments_tenant_service
                FOREIGN KEY (tenant_id, service_id)
                REFERENCES services(tenant_id, id) ON DELETE RESTRICT,
              CONSTRAINT fk_appointments_tenant_staff
                FOREIGN KEY (tenant_id, staff_id)
                REFERENCES staff(tenant_id, id) ON DELETE RESTRICT,
              CONSTRAINT ck_appointments_period CHECK (end_at > start_at),
              CONSTRAINT excl_appointments_staff_active_overlap
                EXCLUDE USING gist (
                  tenant_id WITH =,
                  staff_id WITH =,
                  tstzrange(start_at, end_at, '[)') WITH &&
                ) WHERE (staff_id IS NOT NULL AND status IN ('new', 'confirmed'))
            )
            """,
            """
            CREATE TABLE reviews (
              id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
              tenant_id uuid NOT NULL REFERENCES sites(id) ON DELETE CASCADE,
              tenant_user_id uuid NOT NULL,
              appointment_id uuid,
              rating smallint NOT NULL CHECK (rating BETWEEN 1 AND 5),
              text text,
              status review_status NOT NULL DEFAULT 'pending',
              moderated_at timestamptz,
              created_at timestamptz NOT NULL DEFAULT now(),
              updated_at timestamptz NOT NULL DEFAULT now(),
              UNIQUE (tenant_id, id),
              UNIQUE (tenant_id, appointment_id),
              CONSTRAINT fk_reviews_tenant_user
                FOREIGN KEY (tenant_id, tenant_user_id)
                REFERENCES tenant_users(tenant_id, id) ON DELETE CASCADE,
              CONSTRAINT fk_reviews_tenant_appointment
                FOREIGN KEY (tenant_id, appointment_id)
                REFERENCES appointments(tenant_id, id) ON DELETE RESTRICT
            )
            """,
            """
            CREATE TABLE promotions (
              id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
              tenant_id uuid NOT NULL REFERENCES sites(id) ON DELETE CASCADE,
              title text,
              description text,
              discount_percent smallint CHECK (
                discount_percent IS NULL OR discount_percent BETWEEN 0 AND 100
              ),
              promo_code citext,
              valid_from date,
              valid_to date,
              max_uses integer CHECK (max_uses IS NULL OR max_uses > 0),
              used_count integer NOT NULL DEFAULT 0 CHECK (used_count >= 0),
              is_active boolean NOT NULL DEFAULT true,
              created_at timestamptz NOT NULL DEFAULT now(),
              updated_at timestamptz NOT NULL DEFAULT now(),
              UNIQUE (tenant_id, id),
              UNIQUE (tenant_id, promo_code),
              CONSTRAINT ck_promotions_date_range CHECK (
                valid_to IS NULL OR valid_from IS NULL OR valid_to >= valid_from
              ),
              CONSTRAINT ck_promotions_usage_limit CHECK (
                max_uses IS NULL OR used_count <= max_uses
              )
            )
            """,
            """
            CREATE TABLE loyalty_accounts (
              id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
              tenant_id uuid NOT NULL REFERENCES sites(id) ON DELETE CASCADE,
              tenant_user_id uuid NOT NULL,
              points_balance integer NOT NULL DEFAULT 0 CHECK (points_balance >= 0),
              lifetime_earned integer NOT NULL DEFAULT 0 CHECK (lifetime_earned >= 0),
              created_at timestamptz NOT NULL DEFAULT now(),
              updated_at timestamptz NOT NULL DEFAULT now(),
              UNIQUE (tenant_id, id),
              UNIQUE (tenant_id, tenant_user_id),
              CONSTRAINT fk_loyalty_accounts_tenant_user
                FOREIGN KEY (tenant_id, tenant_user_id)
                REFERENCES tenant_users(tenant_id, id) ON DELETE CASCADE
            )
            """,
            """
            CREATE TABLE loyalty_transactions (
              id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
              tenant_id uuid NOT NULL REFERENCES sites(id) ON DELETE CASCADE,
              account_id uuid NOT NULL,
              appointment_id uuid,
              type loyalty_transaction_type NOT NULL,
              points_delta integer NOT NULL CHECK (points_delta <> 0),
              balance_after integer NOT NULL CHECK (balance_after >= 0),
              reason text,
              created_at timestamptz NOT NULL DEFAULT now(),
              UNIQUE (tenant_id, id),
              CONSTRAINT fk_loyalty_transactions_tenant_account
                FOREIGN KEY (tenant_id, account_id)
                REFERENCES loyalty_accounts(tenant_id, id) ON DELETE CASCADE,
              CONSTRAINT fk_loyalty_transactions_tenant_appointment
                FOREIGN KEY (tenant_id, appointment_id)
                REFERENCES appointments(tenant_id, id) ON DELETE RESTRICT
            )
            """,
            """
            CREATE TABLE notification_preferences (
              id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
              tenant_id uuid NOT NULL REFERENCES sites(id) ON DELETE CASCADE,
              tenant_user_id uuid NOT NULL,
              email_enabled boolean NOT NULL DEFAULT true,
              sms_enabled boolean NOT NULL DEFAULT false,
              telegram_enabled boolean NOT NULL DEFAULT false,
              marketing_enabled boolean NOT NULL DEFAULT false,
              appointment_reminders_enabled boolean NOT NULL DEFAULT true,
              reminder_hours_before smallint NOT NULL DEFAULT 24
                CHECK (reminder_hours_before > 0),
              reminder_hours jsonb NOT NULL DEFAULT '[24]'::jsonb
                CHECK (jsonb_typeof(reminder_hours) = 'array'),
              telegram_chat_id text,
              created_at timestamptz NOT NULL DEFAULT now(),
              updated_at timestamptz NOT NULL DEFAULT now(),
              UNIQUE (tenant_id, id),
              UNIQUE (tenant_id, tenant_user_id),
              CONSTRAINT fk_notification_preferences_tenant_user
                FOREIGN KEY (tenant_id, tenant_user_id)
                REFERENCES tenant_users(tenant_id, id) ON DELETE CASCADE
            )
            """,
            """
            CREATE TABLE notifications (
              id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
              tenant_id uuid REFERENCES sites(id) ON DELETE CASCADE,
              target_type notification_target_type NOT NULL,
              target_id uuid NOT NULL,
              channel notification_channel NOT NULL,
              template text NOT NULL,
              payload jsonb NOT NULL DEFAULT '{}'::jsonb,
              status notification_status NOT NULL DEFAULT 'queued',
              scheduled_at timestamptz,
              sent_at timestamptz,
              attempts smallint NOT NULL DEFAULT 0 CHECK (attempts >= 0),
              last_error text,
              created_at timestamptz NOT NULL DEFAULT now(),
              updated_at timestamptz NOT NULL DEFAULT now(),
              UNIQUE (tenant_id, id),
              CONSTRAINT ck_notifications_target_tenant CHECK (
                target_type <> 'tenant_user' OR tenant_id IS NOT NULL
              )
            )
            """,
            """
            CREATE TABLE custom_landing_orders (
              id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
              tenant_id uuid NOT NULL REFERENCES sites(id) ON DELETE CASCADE,
              status custom_landing_status NOT NULL DEFAULT 'requested',
              price numeric(10,2) NOT NULL DEFAULT 20000.00 CHECK (price >= 0),
              contact text,
              notes text,
              delivered_at timestamptz,
              created_at timestamptz NOT NULL DEFAULT now(),
              updated_at timestamptz NOT NULL DEFAULT now(),
              UNIQUE (tenant_id, id)
            )
            """,
            """
            CREATE TABLE payments (
              id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
              tenant_id uuid REFERENCES sites(id) ON DELETE SET NULL,
              subscription_id uuid REFERENCES subscriptions(id) ON DELETE SET NULL,
              appointment_id uuid,
              custom_landing_order_id uuid,
              purpose payment_purpose NOT NULL,
              amount numeric(10,2) NOT NULL CHECK (amount >= 0),
              currency text NOT NULL DEFAULT 'RUB',
              provider text NOT NULL,
              provider_payment_id text,
              payment_method_id text,
              status payment_status NOT NULL DEFAULT 'pending',
              paid_at timestamptz,
              refunded_at timestamptz,
              provider_payload jsonb NOT NULL DEFAULT '{}'::jsonb,
              created_at timestamptz NOT NULL DEFAULT now(),
              updated_at timestamptz NOT NULL DEFAULT now(),
              UNIQUE (tenant_id, id),
              UNIQUE (provider, provider_payment_id),
              CONSTRAINT fk_payments_tenant_appointment
                FOREIGN KEY (tenant_id, appointment_id)
                REFERENCES appointments(tenant_id, id) ON DELETE RESTRICT,
              CONSTRAINT fk_payments_tenant_custom_landing_order
                FOREIGN KEY (tenant_id, custom_landing_order_id)
                REFERENCES custom_landing_orders(tenant_id, id) ON DELETE RESTRICT,
              CONSTRAINT ck_payments_appointment_tenant CHECK (
                appointment_id IS NULL OR tenant_id IS NOT NULL
              )
            )
            """,
            """
            CREATE TABLE auth_tokens (
              id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
              tenant_id uuid REFERENCES sites(id) ON DELETE CASCADE,
              user_type auth_user_type NOT NULL,
              user_id uuid NOT NULL,
              type auth_token_type NOT NULL,
              token_hash text NOT NULL UNIQUE,
              expires_at timestamptz NOT NULL,
              used_at timestamptz,
              created_at timestamptz NOT NULL DEFAULT now(),
              CONSTRAINT ck_auth_tokens_tenant CHECK (
                user_type = 'platform' OR tenant_id IS NOT NULL
              )
            )
            """,
            """
            CREATE TABLE refresh_tokens (
              id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
              tenant_id uuid REFERENCES sites(id) ON DELETE CASCADE,
              user_type auth_user_type NOT NULL,
              user_id uuid NOT NULL,
              jti uuid NOT NULL UNIQUE,
              family_id uuid NOT NULL,
              token_hash text NOT NULL UNIQUE,
              expires_at timestamptz NOT NULL,
              revoked_at timestamptz,
              replaced_by_jti uuid,
              created_at timestamptz NOT NULL DEFAULT now(),
              CONSTRAINT ck_refresh_tokens_tenant CHECK (
                user_type = 'platform' OR tenant_id IS NOT NULL
              )
            )
            """,
            """
            CREATE TABLE audit_logs (
              id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
              tenant_id uuid REFERENCES sites(id) ON DELETE SET NULL,
              actor_type audit_actor_type NOT NULL,
              actor_id uuid,
              action text NOT NULL,
              entity_type text NOT NULL,
              entity_id uuid,
              before jsonb,
              after jsonb,
              request_id text,
              ip_address text,
              user_agent text,
              created_at timestamptz NOT NULL DEFAULT now()
            )
            """,
            """
            CREATE TABLE webhook_events (
              id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
              tenant_id uuid REFERENCES sites(id) ON DELETE SET NULL,
              provider text NOT NULL,
              event_id text NOT NULL,
              event_type text NOT NULL,
              payload jsonb NOT NULL,
              headers jsonb NOT NULL DEFAULT '{}'::jsonb,
              signature_verified boolean NOT NULL DEFAULT false,
              status webhook_event_status NOT NULL DEFAULT 'received',
              attempts smallint NOT NULL DEFAULT 0 CHECK (attempts >= 0),
              error text,
              received_at timestamptz NOT NULL DEFAULT now(),
              processed_at timestamptz,
              UNIQUE (provider, event_id)
            )
            """,
            """
            CREATE TABLE idempotency_keys (
              id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
              tenant_id uuid REFERENCES sites(id) ON DELETE CASCADE,
              scope text NOT NULL,
              key text NOT NULL,
              request_hash text NOT NULL,
              status idempotency_status NOT NULL DEFAULT 'processing',
              response_status integer,
              response_body jsonb,
              created_at timestamptz NOT NULL DEFAULT now(),
              expires_at timestamptz NOT NULL,
              UNIQUE (scope, key)
            )
            """,
        )
    )

    _execute_many(
        (
            "CREATE INDEX ix_subscriptions_owner_id ON subscriptions(owner_id)",
            "CREATE INDEX ix_subscriptions_status ON subscriptions(status)",
            "CREATE INDEX ix_subscriptions_period_end ON subscriptions(current_period_end)",
            "CREATE INDEX ix_subscriptions_dunning_due "
            "ON subscriptions(next_dunning_at) WHERE status = 'past_due'",
            "CREATE INDEX ix_sites_status ON sites(status)",
            "CREATE INDEX ix_site_blocks_tenant_position ON site_blocks(tenant_id, position)",
            "CREATE INDEX ix_site_versions_tenant_status ON site_versions(tenant_id, status)",
            "CREATE INDEX ix_services_tenant_active ON services(tenant_id, is_active)",
            "CREATE INDEX ix_staff_tenant_active ON staff(tenant_id, is_active)",
            "CREATE INDEX ix_staff_services_tenant_service "
            "ON staff_services(tenant_id, service_id)",
            "CREATE INDEX ix_schedule_exceptions_staff_period "
            "ON schedule_exceptions(tenant_id, staff_id, start_at, end_at)",
            "CREATE INDEX ix_tenant_users_tenant_phone ON tenant_users(tenant_id, phone)",
            "CREATE INDEX ix_tenant_users_tenant_status ON tenant_users(tenant_id, status)",
            "CREATE INDEX ix_pets_tenant_owner ON pets(tenant_id, owner_id)",
            "CREATE INDEX ix_media_objects_tenant_status ON media_objects(tenant_id, status)",
            "CREATE INDEX ix_pet_photos_tenant_pet ON pet_photos(tenant_id, pet_id)",
            "CREATE UNIQUE INDEX uq_pet_photos_one_cover_per_pet "
            "ON pet_photos(tenant_id, pet_id) WHERE is_cover",
            "CREATE INDEX ix_appointments_tenant_start ON appointments(tenant_id, start_at)",
            "CREATE INDEX ix_appointments_staff_start ON appointments(staff_id, start_at)",
            "CREATE INDEX ix_appointments_tenant_user_start "
            "ON appointments(tenant_id, tenant_user_id, start_at)",
            "CREATE INDEX ix_reviews_tenant_status_created "
            "ON reviews(tenant_id, status, created_at)",
            "CREATE INDEX ix_promotions_tenant_active ON promotions(tenant_id, is_active)",
            "CREATE INDEX ix_loyalty_transactions_account_created "
            "ON loyalty_transactions(tenant_id, account_id, created_at)",
            "CREATE INDEX ix_notifications_queue ON notifications(status, scheduled_at)",
            "CREATE INDEX ix_notifications_tenant_target ON notifications(tenant_id, target_id)",
            "CREATE INDEX ix_custom_landing_orders_tenant_status "
            "ON custom_landing_orders(tenant_id, status)",
            "CREATE INDEX ix_payments_tenant_created ON payments(tenant_id, created_at)",
            "CREATE INDEX ix_payments_status_created ON payments(status, created_at)",
            "CREATE INDEX ix_auth_tokens_user ON auth_tokens(user_type, user_id)",
            "CREATE INDEX ix_auth_tokens_expires ON auth_tokens(expires_at)",
            "CREATE INDEX ix_refresh_tokens_user ON refresh_tokens(user_type, user_id)",
            "CREATE INDEX ix_refresh_tokens_family ON refresh_tokens(family_id)",
            "CREATE INDEX ix_refresh_tokens_expires ON refresh_tokens(expires_at)",
            "CREATE INDEX ix_audit_logs_tenant_created ON audit_logs(tenant_id, created_at)",
            "CREATE INDEX ix_audit_logs_entity ON audit_logs(entity_type, entity_id)",
            "CREATE INDEX ix_webhook_events_status_received ON webhook_events(status, received_at)",
            "CREATE INDEX ix_idempotency_keys_expires ON idempotency_keys(expires_at)",
        )
    )

    _execute(
        """
        INSERT INTO plans (code, name, price, period, limits, features)
        VALUES
          (
            'start', 'Старт', 990.00, 'month',
            '{"clients": 50, "staff": 1, "blocks": 4}'::jsonb,
            '["subdomain", "basic_blocks", "booking", "crm", "email_notifications"]'::jsonb
          ),
          (
            'business', 'Бизнес', 2490.00, 'month',
            '{"clients": null, "staff": 3, "blocks": null}'::jsonb,
            '["subdomain", "all_blocks", "booking", "crm", '
            '"email_notifications", "sms", "telegram", "reviews", "loyalty", '
            '"promotions", "basic_analytics", "export"]'::jsonb
          ),
          (
            'pro', 'Профи', 4990.00, 'month',
            '{"clients": null, "staff": null, "blocks": null}'::jsonb,
            '["subdomain", "all_blocks", "booking", "crm", '
            '"email_notifications", "sms", "telegram", "reviews", "loyalty", '
            '"promotions", "advanced_analytics", "online_payments", '
            '"prepayments", "custom_domain", "export", "priority_support"]'::jsonb
          )
        ON CONFLICT (code) DO NOTHING
        """
    )

    _execute(
        """
        CREATE FUNCTION trimmycrm_set_updated_at()
        RETURNS trigger
        LANGUAGE plpgsql
        AS $function$
        BEGIN
          NEW.updated_at = now();
          RETURN NEW;
        END
        $function$
        """
    )
    timestamped_tables = (
        "platform_users",
        "subscriptions",
        "sites",
        "site_blocks",
        "services",
        "staff",
        "schedule_exceptions",
        "tenant_users",
        "pets",
        "media_objects",
        "appointments",
        "reviews",
        "promotions",
        "loyalty_accounts",
        "notification_preferences",
        "notifications",
        "custom_landing_orders",
        "payments",
    )
    for table in timestamped_tables:
        _execute(
            f"""
            CREATE TRIGGER trg_{table}_updated_at
            BEFORE UPDATE ON {table}
            FOR EACH ROW EXECUTE FUNCTION trimmycrm_set_updated_at()
            """
        )

    strict_expression = "tenant_id = NULLIF(current_setting('app.current_tenant', true), '')::uuid"
    nullable_expression = (
        "(tenant_id = NULLIF(current_setting('app.current_tenant', true), '')::uuid "
        "OR (tenant_id IS NULL AND COALESCE("
        "NULLIF(current_setting('app.is_platform', true), '')::boolean, false)))"
    )

    for table in STRICT_TENANT_TABLES:
        _execute(f"ALTER TABLE {table} ENABLE ROW LEVEL SECURITY")
        _execute(f"ALTER TABLE {table} FORCE ROW LEVEL SECURITY")
        _execute(
            f"""
            CREATE POLICY tenant_isolation ON {table}
            FOR ALL TO trimmycrm_app
            USING ({strict_expression})
            WITH CHECK ({strict_expression})
            """
        )
        _execute(
            f"""
            CREATE POLICY admin_api_all_tenants ON {table}
            FOR ALL TO trimmycrm_admin_api
            USING (true)
            WITH CHECK (true)
            """
        )

    for table in NULLABLE_TENANT_TABLES:
        _execute(f"ALTER TABLE {table} ENABLE ROW LEVEL SECURITY")
        _execute(f"ALTER TABLE {table} FORCE ROW LEVEL SECURITY")
        _execute(
            f"""
            CREATE POLICY tenant_or_platform_isolation ON {table}
            FOR ALL TO trimmycrm_app
            USING ({nullable_expression})
            WITH CHECK ({nullable_expression})
            """
        )
        _execute(
            f"""
            CREATE POLICY admin_api_all_tenants ON {table}
            FOR ALL TO trimmycrm_admin_api
            USING (true)
            WITH CHECK (true)
            """
        )

    for table in ALL_TABLES:
        _execute(f"GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE {table} TO trimmycrm_app")
        _execute(f"GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE {table} TO trimmycrm_admin_api")


def downgrade() -> None:
    for table in reversed(ALL_TABLES):
        _execute(f"DROP TABLE IF EXISTS {table} CASCADE")

    _execute("DROP FUNCTION IF EXISTS trimmycrm_set_updated_at()")

    for enum_name in reversed(tuple(ENUMS)):
        _execute(f"DROP TYPE IF EXISTS {enum_name}")

    # Расширения и общая рабочая роль могут использоваться другими схемами,
    # поэтому намеренно сохраняются. Роль никогда не получает BYPASSRLS.
