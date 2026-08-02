"""Add platform feedback messages.

Revision ID: 0003_feedback_messages
Revises: 0002_dashboard_tour
Create Date: 2026-07-20
"""

import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

from alembic import op

revision = "0003_feedback_messages"
down_revision = "0002_dashboard_tour"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "feedback_messages",
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
        sa.Column("author_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("message", sa.Text(), nullable=False),
        sa.Column("read_at", sa.DateTime(timezone=True), nullable=True),
        sa.ForeignKeyConstraint(["author_id"], ["platform_users.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_feedback_messages_author_id", "feedback_messages", ["author_id"])
    op.create_index("ix_feedback_messages_created_at", "feedback_messages", ["created_at"])
    op.create_index("ix_feedback_messages_read_at", "feedback_messages", ["read_at"])
    op.execute(
        """
        CREATE TRIGGER trg_feedback_messages_updated_at
        BEFORE UPDATE ON feedback_messages
        FOR EACH ROW EXECUTE FUNCTION trimmycrm_set_updated_at()
        """
    )
    op.execute("GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE feedback_messages TO trimmycrm_app")
    op.execute(
        "GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE feedback_messages TO trimmycrm_admin_api"
    )


def downgrade() -> None:
    op.drop_table("feedback_messages")
