"""Add immutable multi-service appointment item snapshots.

Revision ID: 0011_appointment_items
Revises: 0010_hair_service_catalog
Create Date: 2026-08-02
"""

import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

from alembic import op

revision = "0011_appointment_items"
down_revision = "0010_hair_service_catalog"
branch_labels = None
depends_on = None


def _tenant_table_security(table: str) -> None:
    tenant_expression = "tenant_id = NULLIF(current_setting('app.current_tenant', true), '')::uuid"
    op.execute(f"ALTER TABLE {table} ENABLE ROW LEVEL SECURITY")
    op.execute(f"ALTER TABLE {table} FORCE ROW LEVEL SECURITY")
    op.execute(
        f"""
        CREATE POLICY tenant_isolation ON {table}
        FOR ALL TO trimmycrm_app
        USING ({tenant_expression})
        WITH CHECK ({tenant_expression})
        """
    )
    op.execute(
        f"""
        CREATE POLICY admin_api_all_tenants ON {table}
        FOR ALL TO trimmycrm_admin_api
        USING (true)
        WITH CHECK (true)
        """
    )
    op.execute(f"GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE {table} TO trimmycrm_app")
    op.execute(f"GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE {table} TO trimmycrm_admin_api")


def upgrade() -> None:
    op.create_unique_constraint(
        "uq_service_variants_tenant_service_id",
        "service_variants",
        ["tenant_id", "service_id", "id"],
    )
    op.create_unique_constraint(
        "uq_service_addons_tenant_service_id",
        "service_addons",
        ["tenant_id", "service_id", "id"],
    )

    op.create_table(
        "appointment_items",
        sa.Column(
            "id",
            postgresql.UUID(as_uuid=True),
            nullable=False,
            server_default=sa.text("gen_random_uuid()"),
        ),
        sa.Column("tenant_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("appointment_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("service_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("variant_id", postgresql.UUID(as_uuid=True)),
        sa.Column("assigned_staff_id", postgresql.UUID(as_uuid=True)),
        sa.Column("service_name_snapshot", sa.Text(), nullable=False),
        sa.Column("variant_label_snapshot", sa.Text()),
        sa.Column(
            "selected_options",
            postgresql.JSONB(astext_type=sa.Text()),
            nullable=False,
            server_default=sa.text("'{}'::jsonb"),
        ),
        sa.Column("unit_price", sa.Numeric(12, 2), nullable=False),
        sa.Column("duration_min", sa.Integer(), nullable=False),
        sa.Column("buffer_before_min", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("buffer_after_min", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("currency", sa.Text(), nullable=False, server_default="RUB"),
        sa.Column("sort_order", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("final_price", sa.Numeric(12, 2)),
        sa.Column("adjustment_reason", sa.Text()),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("now()"),
        ),
        sa.CheckConstraint("unit_price >= 0", name="ck_appointment_items_nonnegative_unit_price"),
        sa.CheckConstraint(
            "final_price IS NULL OR final_price >= 0",
            name="ck_appointment_items_nonnegative_final_price",
        ),
        sa.CheckConstraint("duration_min > 0", name="ck_appointment_items_positive_duration"),
        sa.CheckConstraint(
            "buffer_before_min >= 0", name="ck_appointment_items_nonnegative_buffer_before"
        ),
        sa.CheckConstraint(
            "buffer_after_min >= 0", name="ck_appointment_items_nonnegative_buffer_after"
        ),
        sa.CheckConstraint("sort_order >= 0", name="ck_appointment_items_nonnegative_sort_order"),
        sa.CheckConstraint(
            "char_length(currency) = 3", name="ck_appointment_items_currency_code_length"
        ),
        sa.ForeignKeyConstraint(["tenant_id"], ["sites.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(
            ["tenant_id", "appointment_id"],
            ["appointments.tenant_id", "appointments.id"],
            name="fk_appointment_items_tenant_appointment",
            ondelete="CASCADE",
        ),
        sa.ForeignKeyConstraint(
            ["tenant_id", "service_id"],
            ["services.tenant_id", "services.id"],
            name="fk_appointment_items_tenant_service",
            ondelete="RESTRICT",
        ),
        sa.ForeignKeyConstraint(
            ["tenant_id", "service_id", "variant_id"],
            [
                "service_variants.tenant_id",
                "service_variants.service_id",
                "service_variants.id",
            ],
            name="fk_appointment_items_tenant_service_variant",
            ondelete="RESTRICT",
        ),
        sa.ForeignKeyConstraint(
            ["tenant_id", "assigned_staff_id"],
            ["staff.tenant_id", "staff.id"],
            name="fk_appointment_items_tenant_staff",
            ondelete="RESTRICT",
        ),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("tenant_id", "id", name="uq_appointment_items_tenant_id_id"),
        sa.UniqueConstraint(
            "tenant_id",
            "service_id",
            "id",
            name="uq_appointment_items_tenant_service_id",
        ),
    )
    op.create_index(
        "ix_appointment_items_tenant_appointment",
        "appointment_items",
        ["tenant_id", "appointment_id"],
    )
    op.create_index(
        "ix_appointment_items_tenant_service",
        "appointment_items",
        ["tenant_id", "service_id"],
    )

    op.create_table(
        "appointment_item_addons",
        sa.Column(
            "id",
            postgresql.UUID(as_uuid=True),
            nullable=False,
            server_default=sa.text("gen_random_uuid()"),
        ),
        sa.Column("tenant_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("appointment_item_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("service_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("addon_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("name_snapshot", sa.Text(), nullable=False),
        sa.Column("price_snapshot", sa.Numeric(12, 2), nullable=False),
        sa.Column("duration_min_snapshot", sa.Integer(), nullable=False),
        sa.Column("sort_order", sa.Integer(), nullable=False, server_default="0"),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("now()"),
        ),
        sa.CheckConstraint(
            "price_snapshot >= 0",
            name="ck_appointment_item_addons_nonnegative_price_snapshot",
        ),
        sa.CheckConstraint(
            "duration_min_snapshot >= 0",
            name="ck_appointment_item_addons_nonnegative_duration_snapshot",
        ),
        sa.CheckConstraint(
            "sort_order >= 0", name="ck_appointment_item_addons_nonnegative_sort_order"
        ),
        sa.ForeignKeyConstraint(["tenant_id"], ["sites.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(
            ["tenant_id", "service_id", "appointment_item_id"],
            [
                "appointment_items.tenant_id",
                "appointment_items.service_id",
                "appointment_items.id",
            ],
            name="fk_appointment_item_addons_tenant_item",
            ondelete="CASCADE",
        ),
        sa.ForeignKeyConstraint(
            ["tenant_id", "service_id", "addon_id"],
            ["service_addons.tenant_id", "service_addons.service_id", "service_addons.id"],
            name="fk_appointment_item_addons_tenant_service_addon",
            ondelete="RESTRICT",
        ),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("tenant_id", "id", name="uq_appointment_item_addons_tenant_id_id"),
        sa.UniqueConstraint(
            "tenant_id",
            "appointment_item_id",
            "addon_id",
            name="uq_appointment_item_addons_item_addon",
        ),
    )
    op.create_index(
        "ix_appointment_item_addons_tenant_item",
        "appointment_item_addons",
        ["tenant_id", "appointment_item_id"],
    )

    op.execute(
        """
        INSERT INTO appointment_items (
            tenant_id,
            appointment_id,
            service_id,
            assigned_staff_id,
            service_name_snapshot,
            selected_options,
            unit_price,
            duration_min,
            buffer_before_min,
            buffer_after_min,
            currency,
            sort_order,
            created_at
        )
        SELECT appointment.tenant_id,
               appointment.id,
               appointment.service_id,
               appointment.staff_id,
               service.name,
               '{"migrationSource":"legacyAppointment"}'::jsonb,
               COALESCE(appointment.price, service.price),
               GREATEST(
                   1,
                   ROUND(EXTRACT(EPOCH FROM (appointment.end_at - appointment.start_at)) / 60)::int
               ),
               service.buffer_before_min,
               service.buffer_after_min,
               service.currency,
               0,
               appointment.created_at
        FROM appointments AS appointment
        JOIN services AS service
          ON service.tenant_id = appointment.tenant_id
         AND service.id = appointment.service_id
        """
    )

    for table in ("appointment_items", "appointment_item_addons"):
        _tenant_table_security(table)


def downgrade() -> None:
    op.drop_table("appointment_item_addons")
    op.drop_table("appointment_items")
    op.drop_constraint("uq_service_addons_tenant_service_id", "service_addons", type_="unique")
    op.drop_constraint("uq_service_variants_tenant_service_id", "service_variants", type_="unique")
