"""Add the passphrase and signed-in devices. Removes reports that were hidden, which used to stay in the archive.

Revision ID: 0005
Revises: 0004
"""
from alembic import op
import sqlalchemy as sa

revision = "0005"
down_revision = "0004"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "auth_credential",
        sa.Column("id", sa.Integer, primary_key=True),
        sa.Column("salt", sa.String(64), nullable=False),
        sa.Column("derived", sa.String(128), nullable=False),
        sa.Column("n", sa.Integer, nullable=False),
        sa.Column("r", sa.Integer, nullable=False),
        sa.Column("p", sa.Integer, nullable=False),
        sa.Column("updated_at", sa.String(32), nullable=False),
    )
    op.create_table(
        "auth_sessions",
        sa.Column("token_hash", sa.String(64), primary_key=True),
        sa.Column("created_at", sa.Integer, nullable=False),
        sa.Column("last_seen_at", sa.Integer, nullable=False),
    )
    op.execute("DELETE FROM import_items WHERE batch_id IN (SELECT id FROM import_batches WHERE hidden = 1)")
    op.execute("DELETE FROM import_batches WHERE hidden = 1")


def downgrade() -> None:
    op.drop_table("auth_sessions")
    op.drop_table("auth_credential")
