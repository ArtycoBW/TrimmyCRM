"""Add landing and chat lead capture.

Revision ID: 0004_public_leads
Revises: 0003_feedback_messages
Create Date: 2026-07-20
"""

import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

from alembic import op

revision = "0004_public_leads"
down_revision = "0003_feedback_messages"
branch_labels = None
depends_on = None


def _timestamp_trigger(table: str) -> None:
    op.execute(
        f"""
        CREATE TRIGGER trg_{table}_updated_at
        BEFORE UPDATE ON {table}
        FOR EACH ROW EXECUTE FUNCTION trimmycrm_set_updated_at()
        """
    )


def upgrade() -> None:
    op.create_table(
        "landing_leads",
        sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False),
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
        sa.Column("kind", sa.Text(), nullable=False),
        sa.Column("name", sa.Text(), nullable=False),
        sa.Column("phone", sa.Text(), nullable=False),
        sa.Column("question", sa.Text(), nullable=True),
        sa.Column("preferred_time", sa.Text(), nullable=True),
        sa.Column("consent_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("read_at", sa.DateTime(timezone=True), nullable=True),
        sa.CheckConstraint("kind IN ('question', 'callback')", name="landing_leads_kind_valid"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_landing_leads_kind_created_at", "landing_leads", ["kind", "created_at"])
    op.create_index("ix_landing_leads_read_at", "landing_leads", ["read_at"])
    _timestamp_trigger("landing_leads")

    op.create_table(
        "chat_leads",
        sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False),
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
        sa.Column("name", sa.Text(), nullable=False),
        sa.Column("phone", sa.Text(), nullable=False),
        sa.Column("question", sa.Text(), nullable=True),
        sa.Column("consent_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("read_at", sa.DateTime(timezone=True), nullable=True),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_chat_leads_created_at", "chat_leads", ["created_at"])
    op.create_index("ix_chat_leads_read_at", "chat_leads", ["read_at"])
    _timestamp_trigger("chat_leads")
    for table in ("landing_leads", "chat_leads"):
        op.execute(f"GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE {table} TO trimmycrm_app")
        op.execute(f"GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE {table} TO trimmycrm_admin_api")


def downgrade() -> None:
    op.drop_table("chat_leads")
    op.drop_table("landing_leads")
