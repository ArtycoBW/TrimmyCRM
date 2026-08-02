"""Record the owner's data-processing instruction separately from client consent.

Revision ID: 0006_data_processing_acceptance
Revises: 0005_pet_documents
Create Date: 2026-07-28
"""

import sqlalchemy as sa

from alembic import op

revision = "0006_data_processing_acceptance"
down_revision = "0005_pet_documents"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "platform_users",
        sa.Column(
            "data_processing_agreement_accepted_at",
            sa.DateTime(timezone=True),
            nullable=True,
        ),
    )
    op.add_column(
        "tenant_users",
        sa.Column("data_processing_basis_confirmed_at", sa.DateTime(timezone=True), nullable=True),
    )


def downgrade() -> None:
    op.drop_column("tenant_users", "data_processing_basis_confirmed_at")
    op.drop_column("platform_users", "data_processing_agreement_accepted_at")
