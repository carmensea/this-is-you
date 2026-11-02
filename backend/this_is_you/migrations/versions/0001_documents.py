"""Create documents and import events

Revision ID: 0001
Revises:
"""
from alembic import op
import sqlalchemy as sa

revision = "0001"
down_revision = None
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "documents",
        sa.Column("id", sa.String(32), primary_key=True),
        sa.Column("sha256", sa.String(64), nullable=False, unique=True),
        sa.Column("original_filename", sa.String(255), nullable=False),
        sa.Column("media_type", sa.String(127), nullable=False),
        sa.Column("byte_size", sa.Integer, nullable=False),
        sa.Column("document_type", sa.String(32), nullable=False),
        sa.Column("processing_status", sa.String(32), nullable=False),
        sa.Column("storage_key", sa.String(255), nullable=False),
        sa.Column("imported_at", sa.String(32), nullable=False),
    )
    op.create_index("ix_documents_imported_at", "documents", ["imported_at"])
    op.create_table(
        "import_events",
        sa.Column("id", sa.Integer, primary_key=True, autoincrement=True),
        sa.Column("document_id", sa.String(32), sa.ForeignKey("documents.id"), nullable=False),
        sa.Column("submitted_filename", sa.String(255), nullable=False),
        sa.Column("outcome", sa.String(32), nullable=False),
        sa.Column("occurred_at", sa.String(32), nullable=False),
    )
    op.create_index("ix_import_events_document_id", "import_events", ["document_id"])


def downgrade() -> None:
    op.drop_table("import_events")
    op.drop_table("documents")
