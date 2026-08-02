"""Add normalized hair-service categories, variants, and add-ons.

Revision ID: 0010_hair_service_catalog
Revises: 0009_client_hair_profiles
Create Date: 2026-08-02
"""

import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

from alembic import op

revision = "0010_hair_service_catalog"
down_revision = "0009_client_hair_profiles"
branch_labels = None
depends_on = None


service_audience = postgresql.ENUM(
    "women",
    "men",
    "all",
    "kids",
    name="service_audience",
    create_type=False,
)
service_price_type = postgresql.ENUM(
    "fixed",
    "from",
    "range",
    "consultation",
    name="service_price_type",
    create_type=False,
)


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


def _timestamp_trigger(table: str) -> None:
    op.execute(
        f"""
        CREATE TRIGGER trg_{table}_updated_at
        BEFORE UPDATE ON {table}
        FOR EACH ROW EXECUTE FUNCTION trimmycrm_set_updated_at()
        """
    )


def upgrade() -> None:
    bind = op.get_bind()
    postgresql.ENUM("women", "men", "all", "kids", name="service_audience").create(
        bind, checkfirst=True
    )
    postgresql.ENUM("fixed", "from", "range", "consultation", name="service_price_type").create(
        bind, checkfirst=True
    )

    op.create_table(
        "service_categories",
        sa.Column(
            "id",
            postgresql.UUID(as_uuid=True),
            nullable=False,
            server_default=sa.text("gen_random_uuid()"),
        ),
        sa.Column("tenant_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("name", sa.Text(), nullable=False),
        sa.Column("slug", sa.Text(), nullable=False),
        sa.Column("audience", service_audience, nullable=False, server_default="all"),
        sa.Column("sort_order", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("is_active", sa.Boolean(), nullable=False, server_default=sa.text("true")),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("now()"),
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("now()"),
        ),
        sa.CheckConstraint("sort_order >= 0", name="ck_service_categories_nonnegative_sort_order"),
        sa.ForeignKeyConstraint(["tenant_id"], ["sites.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("tenant_id", "id", name="uq_service_categories_tenant_id_id"),
        sa.UniqueConstraint("tenant_id", "slug", name="uq_service_categories_tenant_slug"),
    )
    op.create_index(
        "ix_service_categories_tenant_active",
        "service_categories",
        ["tenant_id", "is_active"],
    )

    op.add_column("services", sa.Column("category_id", postgresql.UUID(as_uuid=True)))
    op.add_column("services", sa.Column("max_price", sa.Numeric(10, 2)))
    op.add_column(
        "services",
        sa.Column("price_type", service_price_type, nullable=False, server_default="fixed"),
    )
    op.add_column(
        "services", sa.Column("currency", sa.Text(), nullable=False, server_default="RUB")
    )
    op.add_column(
        "services",
        sa.Column(
            "requires_consultation", sa.Boolean(), nullable=False, server_default=sa.text("false")
        ),
    )
    op.add_column(
        "services",
        sa.Column(
            "requires_patch_test", sa.Boolean(), nullable=False, server_default=sa.text("false")
        ),
    )
    op.add_column(
        "services",
        sa.Column(
            "allow_online_booking", sa.Boolean(), nullable=False, server_default=sa.text("true")
        ),
    )
    op.add_column(
        "services",
        sa.Column(
            "variant_selection_required",
            sa.Boolean(),
            nullable=False,
            server_default=sa.text("false"),
        ),
    )
    op.add_column("services", sa.Column("preparation_text", sa.Text()))
    op.add_column("services", sa.Column("aftercare_text", sa.Text()))
    op.add_column(
        "services", sa.Column("sort_order", sa.Integer(), nullable=False, server_default="0")
    )
    op.create_foreign_key(
        "fk_services_tenant_category",
        "services",
        "service_categories",
        ["tenant_id", "category_id"],
        ["tenant_id", "id"],
        ondelete="RESTRICT",
    )
    op.create_check_constraint(
        "ck_services_valid_price_range",
        "services",
        "max_price IS NULL OR max_price >= price",
    )
    op.create_check_constraint("ck_services_nonnegative_sort_order", "services", "sort_order >= 0")
    op.create_check_constraint(
        "ck_services_currency_code_length", "services", "char_length(currency) = 3"
    )
    op.create_index("ix_services_tenant_category", "services", ["tenant_id", "category_id"])

    op.execute(
        """
        INSERT INTO service_categories (tenant_id, name, slug, audience)
        SELECT DISTINCT ON (tenant_id, btrim(category)) tenant_id,
               btrim(category),
               'legacy-' || substr(md5(btrim(category)), 1, 20),
               'all'::service_audience
        FROM services
        WHERE category IS NOT NULL AND btrim(category) <> ''
        ORDER BY tenant_id, btrim(category)
        """
    )
    op.execute(
        """
        UPDATE services AS service
        SET category_id = category.id
        FROM service_categories AS category
        WHERE category.tenant_id = service.tenant_id
          AND category.name = btrim(service.category)
          AND service.category IS NOT NULL
        """
    )

    def child_columns() -> tuple[sa.Column[object], ...]:
        return (
            sa.Column(
                "id",
                postgresql.UUID(as_uuid=True),
                nullable=False,
                server_default=sa.text("gen_random_uuid()"),
            ),
            sa.Column("tenant_id", postgresql.UUID(as_uuid=True), nullable=False),
            sa.Column("service_id", postgresql.UUID(as_uuid=True), nullable=False),
        )

    def timestamp_columns() -> tuple[sa.Column[object], ...]:
        return (
            sa.Column(
                "created_at",
                sa.DateTime(timezone=True),
                nullable=False,
                server_default=sa.text("now()"),
            ),
            sa.Column(
                "updated_at",
                sa.DateTime(timezone=True),
                nullable=False,
                server_default=sa.text("now()"),
            ),
        )

    op.create_table(
        "service_variants",
        *child_columns(),
        sa.Column("label", sa.Text(), nullable=False),
        sa.Column("price_delta", sa.Numeric(10, 2), nullable=False, server_default="0"),
        sa.Column("duration_delta_min", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("sort_order", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("is_active", sa.Boolean(), nullable=False, server_default=sa.text("true")),
        *timestamp_columns(),
        sa.CheckConstraint("price_delta >= 0", name="ck_service_variants_nonnegative_price_delta"),
        sa.CheckConstraint(
            "duration_delta_min >= 0", name="ck_service_variants_nonnegative_duration_delta"
        ),
        sa.CheckConstraint("sort_order >= 0", name="ck_service_variants_nonnegative_sort_order"),
        sa.ForeignKeyConstraint(["tenant_id"], ["sites.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(
            ["tenant_id", "service_id"],
            ["services.tenant_id", "services.id"],
            name="fk_service_variants_tenant_service",
            ondelete="CASCADE",
        ),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("tenant_id", "id", name="uq_service_variants_tenant_id_id"),
        sa.UniqueConstraint(
            "tenant_id",
            "service_id",
            "label",
            name="uq_service_variants_service_label",
        ),
    )
    op.create_index(
        "ix_service_variants_tenant_service",
        "service_variants",
        ["tenant_id", "service_id"],
    )

    op.create_table(
        "service_addons",
        *child_columns(),
        sa.Column("name", sa.Text(), nullable=False),
        sa.Column("price_delta", sa.Numeric(10, 2), nullable=False, server_default="0"),
        sa.Column("duration_delta_min", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("sort_order", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("is_active", sa.Boolean(), nullable=False, server_default=sa.text("true")),
        *timestamp_columns(),
        sa.CheckConstraint("price_delta >= 0", name="ck_service_addons_nonnegative_price_delta"),
        sa.CheckConstraint(
            "duration_delta_min >= 0", name="ck_service_addons_nonnegative_duration_delta"
        ),
        sa.CheckConstraint("sort_order >= 0", name="ck_service_addons_nonnegative_sort_order"),
        sa.ForeignKeyConstraint(["tenant_id"], ["sites.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(
            ["tenant_id", "service_id"],
            ["services.tenant_id", "services.id"],
            name="fk_service_addons_tenant_service",
            ondelete="CASCADE",
        ),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("tenant_id", "id", name="uq_service_addons_tenant_id_id"),
        sa.UniqueConstraint(
            "tenant_id", "service_id", "name", name="uq_service_addons_service_name"
        ),
    )
    op.create_index(
        "ix_service_addons_tenant_service",
        "service_addons",
        ["tenant_id", "service_id"],
    )

    for table in ("service_categories", "service_variants", "service_addons"):
        _timestamp_trigger(table)
        _tenant_table_security(table)


def downgrade() -> None:
    op.drop_table("service_addons")
    op.drop_table("service_variants")
    op.drop_index("ix_services_tenant_category", table_name="services")
    op.drop_constraint("ck_services_currency_code_length", "services", type_="check")
    op.drop_constraint("ck_services_nonnegative_sort_order", "services", type_="check")
    op.drop_constraint("ck_services_valid_price_range", "services", type_="check")
    op.drop_constraint("fk_services_tenant_category", "services", type_="foreignkey")
    for column in (
        "sort_order",
        "aftercare_text",
        "preparation_text",
        "variant_selection_required",
        "allow_online_booking",
        "requires_patch_test",
        "requires_consultation",
        "currency",
        "price_type",
        "max_price",
        "category_id",
    ):
        op.drop_column("services", column)
    op.drop_table("service_categories")

    bind = op.get_bind()
    postgresql.ENUM(name="service_price_type").drop(bind, checkfirst=True)
    postgresql.ENUM(name="service_audience").drop(bind, checkfirst=True)
