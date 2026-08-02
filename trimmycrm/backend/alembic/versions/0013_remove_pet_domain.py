"""Remove the legacy grooming pet domain.

Revision ID: 0013_remove_pet_domain
Revises: 0012_client_appointments
Create Date: 2026-08-02
"""

import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

from alembic import op

revision = "0013_remove_pet_domain"
down_revision = "0012_client_appointments"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute(
        """
        CREATE TEMPORARY TABLE trimmycrm_legacy_pet_media_ids ON COMMIT DROP AS
        SELECT media_object_id AS id
        FROM pet_photos
        WHERE media_object_id IS NOT NULL
        UNION
        SELECT media_object_id AS id
        FROM pet_documents
        WHERE media_object_id IS NOT NULL
        """
    )
    op.drop_table("pet_documents")
    op.drop_table("pet_photos")
    op.drop_table("pets")
    op.execute(
        """
        UPDATE media_objects
        SET status = 'deleted'::media_status,
            original_filename = NULL,
            checksum_sha256 = NULL,
            public_url = NULL,
            uploaded_by_tenant_user_id = NULL,
            deleted_at = COALESCE(deleted_at, now()),
            metadata = (metadata - 'pet_id' - 'document_type')
                || jsonb_build_object(
                    'purpose', 'legacy_grooming_media_removed',
                    'deleted_at', COALESCE(deleted_at, now())::text
                )
        WHERE id IN (SELECT id FROM trimmycrm_legacy_pet_media_ids)
        """
    )
    op.execute("DROP TYPE IF EXISTS pet_species")


def _enable_tenant_rls(table: str) -> None:
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


def downgrade() -> None:
    bind = op.get_bind()
    pet_species = postgresql.ENUM("dog", "cat", "other", name="pet_species")
    pet_species.create(bind, checkfirst=True)

    op.create_table(
        "pets",
        sa.Column(
            "id",
            postgresql.UUID(as_uuid=True),
            nullable=False,
            server_default=sa.text("gen_random_uuid()"),
        ),
        sa.Column("tenant_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("owner_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("name", sa.Text(), nullable=False),
        sa.Column(
            "species",
            postgresql.ENUM("dog", "cat", "other", name="pet_species", create_type=False),
            nullable=True,
        ),
        sa.Column("breed", sa.Text(), nullable=True),
        sa.Column("birth_date", sa.Date(), nullable=True),
        sa.Column("weight_kg", sa.Numeric(5, 2), nullable=True),
        sa.Column("coat_type", sa.Text(), nullable=True),
        sa.Column("temperament", sa.Text(), nullable=True),
        sa.Column("allergies", sa.Text(), nullable=True),
        sa.Column("medical_notes", sa.Text(), nullable=True),
        sa.Column("additional_info", sa.Text(), nullable=True),
        sa.Column("vaccinated_until", sa.Date(), nullable=True),
        sa.Column("archived_at", sa.DateTime(timezone=True), nullable=True),
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
        sa.CheckConstraint("weight_kg IS NULL OR weight_kg > 0", name="positive_weight"),
        sa.ForeignKeyConstraint(["tenant_id"], ["sites.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(
            ["tenant_id", "owner_id"],
            ["tenant_users.tenant_id", "tenant_users.id"],
            name="fk_pets_tenant_owner",
            ondelete="CASCADE",
        ),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("tenant_id", "id", name="uq_pets_tenant_id_id"),
    )
    op.create_index("ix_pets_tenant_owner", "pets", ["tenant_id", "owner_id"])
    op.execute(
        """
        CREATE TRIGGER trg_pets_updated_at
        BEFORE UPDATE ON pets
        FOR EACH ROW EXECUTE FUNCTION trimmycrm_set_updated_at()
        """
    )

    op.create_table(
        "pet_photos",
        sa.Column(
            "id",
            postgresql.UUID(as_uuid=True),
            nullable=False,
            server_default=sa.text("gen_random_uuid()"),
        ),
        sa.Column("tenant_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("pet_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("media_object_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("url", sa.Text(), nullable=False),
        sa.Column("is_cover", sa.Boolean(), nullable=False, server_default=sa.text("false")),
        sa.Column("position", sa.Integer(), nullable=False, server_default=sa.text("0")),
        sa.Column(
            "uploaded_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("now()"),
        ),
        sa.CheckConstraint("position >= 0", name="nonnegative_position"),
        sa.ForeignKeyConstraint(["tenant_id"], ["sites.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(
            ["tenant_id", "pet_id"],
            ["pets.tenant_id", "pets.id"],
            name="fk_pet_photos_tenant_pet",
            ondelete="CASCADE",
        ),
        sa.ForeignKeyConstraint(
            ["tenant_id", "media_object_id"],
            ["media_objects.tenant_id", "media_objects.id"],
            name="fk_pet_photos_tenant_media",
            ondelete="RESTRICT",
        ),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("tenant_id", "id", name="uq_pet_photos_tenant_id_id"),
    )
    op.create_index("ix_pet_photos_tenant_pet", "pet_photos", ["tenant_id", "pet_id"])
    op.create_index(
        "uq_pet_photos_one_cover_per_pet",
        "pet_photos",
        ["tenant_id", "pet_id"],
        unique=True,
        postgresql_where=sa.text("is_cover"),
    )

    op.create_table(
        "pet_documents",
        sa.Column(
            "id",
            postgresql.UUID(as_uuid=True),
            nullable=False,
            server_default=sa.text("gen_random_uuid()"),
        ),
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
            "document_type IN ('passport')", name="pet_documents_document_type_valid"
        ),
        sa.ForeignKeyConstraint(["tenant_id"], ["sites.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(
            ["tenant_id", "pet_id"],
            ["pets.tenant_id", "pets.id"],
            name="fk_pet_documents_tenant_pet",
            ondelete="CASCADE",
        ),
        sa.ForeignKeyConstraint(
            ["tenant_id", "media_object_id"],
            ["media_objects.tenant_id", "media_objects.id"],
            name="fk_pet_documents_tenant_media",
            ondelete="RESTRICT",
        ),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("tenant_id", "id", name="uq_pet_documents_tenant_id_id"),
    )
    op.create_index("ix_pet_documents_tenant_pet", "pet_documents", ["tenant_id", "pet_id"])

    for table in ("pets", "pet_photos", "pet_documents"):
        _enable_tenant_rls(table)
