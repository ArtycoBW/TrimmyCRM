"""Add private pet passports and client notes.

Revision ID: 0005_pet_documents
Revises: 0004_public_leads
Create Date: 2026-07-23
"""

import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

from alembic import op

revision = "0005_pet_documents"
down_revision = "0004_public_leads"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("pets", sa.Column("additional_info", sa.Text(), nullable=True))
    op.create_table(
        "pet_documents",
        sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("tenant_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("pet_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("media_object_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("document_type", sa.Text(), nullable=False),
        sa.Column("original_filename", sa.Text(), nullable=True),
        sa.Column("url", sa.Text(), nullable=False),
        sa.Column(
            "uploaded_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("now()"),
        ),
        sa.CheckConstraint(
            "document_type IN ('passport')",
            name="pet_documents_document_type_valid",
        ),
        sa.ForeignKeyConstraint(
            ["tenant_id"],
            ["sites.id"],
            ondelete="CASCADE",
        ),
        sa.ForeignKeyConstraint(
            ["tenant_id", "pet_id"],
            ["pets.tenant_id", "pets.id"],
            ondelete="CASCADE",
            name="fk_pet_documents_tenant_pet",
        ),
        sa.ForeignKeyConstraint(
            ["tenant_id", "media_object_id"],
            ["media_objects.tenant_id", "media_objects.id"],
            ondelete="RESTRICT",
            name="fk_pet_documents_tenant_media",
        ),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint(
            "tenant_id",
            "id",
            name="uq_pet_documents_tenant_id_id",
        ),
    )
    op.create_index(
        "ix_pet_documents_tenant_pet",
        "pet_documents",
        ["tenant_id", "pet_id"],
    )
    tenant_expression = "tenant_id = NULLIF(current_setting('app.current_tenant', true), '')::uuid"
    op.execute("ALTER TABLE pet_documents ENABLE ROW LEVEL SECURITY")
    op.execute("ALTER TABLE pet_documents FORCE ROW LEVEL SECURITY")
    op.execute(
        f"""
        CREATE POLICY tenant_isolation ON pet_documents
        FOR ALL TO trimmycrm_app
        USING ({tenant_expression})
        WITH CHECK ({tenant_expression})
        """
    )
    op.execute(
        """
        CREATE POLICY admin_api_all_tenants ON pet_documents
        FOR ALL TO trimmycrm_admin_api
        USING (true)
        WITH CHECK (true)
        """
    )
    op.execute("GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE pet_documents TO trimmycrm_app")
    op.execute("GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE pet_documents TO trimmycrm_admin_api")


def downgrade() -> None:
    op.drop_table("pet_documents")
    op.drop_column("pets", "additional_info")
