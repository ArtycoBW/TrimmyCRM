"""Attach appointments directly to clients instead of pet profiles.

Revision ID: 0012_client_appointments
Revises: 0011_appointment_items
"""

import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

from alembic import op

revision = "0012_client_appointments"
down_revision = "0011_appointment_items"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.drop_constraint("fk_appointments_tenant_pet", "appointments", type_="foreignkey")
    op.drop_column("appointments", "pet_id")


def downgrade() -> None:
    op.add_column(
        "appointments",
        sa.Column("pet_id", postgresql.UUID(as_uuid=True), nullable=True),
    )
    op.create_foreign_key(
        "fk_appointments_tenant_pet",
        "appointments",
        "pets",
        ["tenant_id", "pet_id"],
        ["tenant_id", "id"],
        ondelete="RESTRICT",
    )
