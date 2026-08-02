"""Store the one-time dashboard tour acknowledgement per platform account.

Revision ID: 0002_dashboard_tour
Revises: 0001_initial
Create Date: 2026-07-19
"""

import sqlalchemy as sa

from alembic import op

revision = "0002_dashboard_tour"
down_revision = "0001_initial"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "platform_users",
        sa.Column("dashboard_tour_completed_at", sa.DateTime(timezone=True), nullable=True),
    )


def downgrade() -> None:
    op.drop_column("platform_users", "dashboard_tour_completed_at")
