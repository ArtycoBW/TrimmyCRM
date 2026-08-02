"""Record acceptance of legal documents and data-processing instructions.

Revision ID: 0007_legal_document_acceptance
Revises: 0006_data_processing_acceptance
Create Date: 2026-07-29
"""

import sqlalchemy as sa

from alembic import op

revision = "0007_legal_document_acceptance"
down_revision = "0006_data_processing_acceptance"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("platform_users", sa.Column("personal_data_consent_version", sa.Text()))
    op.add_column("platform_users", sa.Column("terms_accepted_at", sa.DateTime(timezone=True)))
    op.add_column("platform_users", sa.Column("terms_version", sa.Text()))
    op.add_column(
        "platform_users",
        sa.Column("data_processing_instruction_accepted_at", sa.DateTime(timezone=True)),
    )
    op.add_column("platform_users", sa.Column("data_processing_instruction_version", sa.Text()))
    op.add_column("tenant_users", sa.Column("personal_data_consent_version", sa.Text()))


def downgrade() -> None:
    op.drop_column("tenant_users", "personal_data_consent_version")
    op.drop_column("platform_users", "data_processing_instruction_version")
    op.drop_column("platform_users", "data_processing_instruction_accepted_at")
    op.drop_column("platform_users", "terms_version")
    op.drop_column("platform_users", "terms_accepted_at")
    op.drop_column("platform_users", "personal_data_consent_version")
