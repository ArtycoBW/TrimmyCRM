"""Add tenant-isolated technical hair profiles for CRM clients.

Revision ID: 0009_client_hair_profiles
Revises: 0008_salon_profile
Create Date: 2026-08-02
"""

import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

from alembic import op

revision = "0009_client_hair_profiles"
down_revision = "0008_salon_profile"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "client_hair_profiles",
        sa.Column(
            "id",
            postgresql.UUID(as_uuid=True),
            nullable=False,
            server_default=sa.text("gen_random_uuid()"),
        ),
        sa.Column("tenant_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("client_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("hair_length", sa.Text()),
        sa.Column("density", sa.Text()),
        sa.Column("texture", sa.Text()),
        sa.Column("porosity", sa.Text()),
        sa.Column("condition_notes", sa.Text()),
        sa.Column("scalp_sensitivity_notes", sa.Text()),
        sa.Column("gray_percentage", sa.SmallInteger()),
        sa.Column("natural_color", sa.Text()),
        sa.Column("current_color", sa.Text()),
        sa.Column("color_history", sa.Text()),
        sa.Column("beard_length", sa.Text()),
        sa.Column("beard_style", sa.Text()),
        sa.Column("moustache_style", sa.Text()),
        sa.Column("preferences", sa.Text()),
        sa.Column("version", sa.Integer(), nullable=False, server_default="1"),
        sa.Column("updated_by_id", postgresql.UUID(as_uuid=True)),
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
        sa.CheckConstraint(
            "gray_percentage IS NULL OR gray_percentage BETWEEN 0 AND 100",
            name="ck_client_hair_profiles_gray_percentage_range",
        ),
        sa.CheckConstraint("version > 0", name="ck_client_hair_profiles_positive_version"),
        sa.ForeignKeyConstraint(
            ["tenant_id"],
            ["sites.id"],
            ondelete="CASCADE",
        ),
        sa.ForeignKeyConstraint(
            ["tenant_id", "client_id"],
            ["tenant_users.tenant_id", "tenant_users.id"],
            name="fk_client_hair_profiles_tenant_client",
            ondelete="CASCADE",
        ),
        sa.ForeignKeyConstraint(
            ["updated_by_id"],
            ["platform_users.id"],
            ondelete="SET NULL",
        ),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("tenant_id", "id", name="uq_client_hair_profiles_tenant_id_id"),
        sa.UniqueConstraint(
            "tenant_id",
            "client_id",
            name="uq_client_hair_profiles_tenant_client",
        ),
    )
    op.create_index(
        "ix_client_hair_profiles_tenant_client",
        "client_hair_profiles",
        ["tenant_id", "client_id"],
    )
    op.execute(
        """
        CREATE TRIGGER trg_client_hair_profiles_updated_at
        BEFORE UPDATE ON client_hair_profiles
        FOR EACH ROW EXECUTE FUNCTION trimmycrm_set_updated_at()
        """
    )
    op.execute("ALTER TABLE client_hair_profiles ENABLE ROW LEVEL SECURITY")
    op.execute("ALTER TABLE client_hair_profiles FORCE ROW LEVEL SECURITY")
    tenant_expression = "tenant_id = NULLIF(current_setting('app.current_tenant', true), '')::uuid"
    op.execute(
        f"""
        CREATE POLICY tenant_isolation ON client_hair_profiles
        FOR ALL TO trimmycrm_app
        USING ({tenant_expression})
        WITH CHECK ({tenant_expression})
        """
    )
    op.execute(
        """
        CREATE POLICY admin_api_all_tenants ON client_hair_profiles
        FOR ALL TO trimmycrm_admin_api
        USING (true)
        WITH CHECK (true)
        """
    )
    op.execute(
        "GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE client_hair_profiles TO trimmycrm_app"
    )
    op.execute(
        "GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE client_hair_profiles TO trimmycrm_admin_api"
    )


def downgrade() -> None:
    op.drop_table("client_hair_profiles")
