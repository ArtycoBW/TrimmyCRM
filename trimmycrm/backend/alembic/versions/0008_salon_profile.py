"""Add the TrimmyCRM salon profile to every tenant site.

Revision ID: 0008_salon_profile
Revises: 0007_legal_document_acceptance
Create Date: 2026-08-02
"""

import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

from alembic import op

revision = "0008_salon_profile"
down_revision = "0007_legal_document_acceptance"
branch_labels = None
depends_on = None


def upgrade() -> None:
    salon_type = postgresql.ENUM(
        "women_hair_salon",
        "barbershop",
        "unisex_hair_salon",
        name="salon_type",
    )
    salon_type.create(op.get_bind(), checkfirst=True)
    op.add_column(
        "sites",
        sa.Column(
            "salon_type",
            salon_type,
            nullable=False,
            server_default="unisex_hair_salon",
        ),
    )
    op.add_column(
        "sites",
        sa.Column(
            "service_focuses",
            postgresql.JSONB(astext_type=sa.Text()),
            nullable=False,
            server_default=sa.text("'[]'::jsonb"),
        ),
    )
    op.add_column(
        "sites",
        sa.Column("locale", sa.Text(), nullable=False, server_default="ru-RU"),
    )
    op.add_column(
        "sites",
        sa.Column("currency", sa.Text(), nullable=False, server_default="RUB"),
    )
    op.create_check_constraint(
        "sites_service_focuses_array",
        "sites",
        "jsonb_typeof(service_focuses) = 'array'",
    )


def downgrade() -> None:
    op.drop_constraint("sites_service_focuses_array", "sites", type_="check")
    op.drop_column("sites", "currency")
    op.drop_column("sites", "locale")
    op.drop_column("sites", "service_focuses")
    op.drop_column("sites", "salon_type")
    postgresql.ENUM(name="salon_type").drop(op.get_bind(), checkfirst=True)
