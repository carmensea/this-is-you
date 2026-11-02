"""Add extraction, proposals, decisions and separate review statuses

Revision ID: 0002
Revises: 0001
"""
from alembic import op
import sqlalchemy as sa

revision = "0002"
down_revision = "0001"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # Existing documents become "pending", so the service reads them on its next start.
    with op.batch_alter_table("documents") as batch:
        batch.add_column(sa.Column("extraction_status", sa.String(32), nullable=False, server_default="pending"))
        batch.add_column(sa.Column("review_status", sa.String(32), nullable=False, server_default="not_started"))
        batch.add_column(sa.Column("verification_status", sa.String(32), nullable=False, server_default="unverified"))
        batch.drop_column("document_type")
        batch.drop_column("processing_status")
    with op.batch_alter_table("documents") as batch:
        batch.alter_column("extraction_status", server_default=None)
        batch.alter_column("review_status", server_default=None)
        batch.alter_column("verification_status", server_default=None)

    op.create_table(
        "extraction_runs",
        sa.Column("id", sa.Integer, primary_key=True, autoincrement=True),
        sa.Column("document_id", sa.String(32), sa.ForeignKey("documents.id"), nullable=False),
        sa.Column("method", sa.String(32), nullable=False),
        sa.Column("status", sa.String(32), nullable=False),
        sa.Column("finished_at", sa.String(32), nullable=False),
        sa.Column("page_count", sa.Integer),
        sa.Column("pages_read", sa.Integer, nullable=False),
        sa.Column("pages_with_text", sa.Integer, nullable=False),
        sa.Column("pages_failed", sa.Integer, nullable=False),
        sa.Column("truncated", sa.Boolean, nullable=False),
        sa.Column("text_sha256", sa.String(64)),
    )
    op.create_index("ix_extraction_runs_document_id", "extraction_runs", ["document_id"])
    op.create_index("ix_extraction_runs_text_sha256", "extraction_runs", ["text_sha256"])
    op.create_table(
        "metadata_proposals",
        sa.Column("id", sa.Integer, primary_key=True, autoincrement=True),
        sa.Column("run_id", sa.Integer, sa.ForeignKey("extraction_runs.id"), nullable=False),
        sa.Column("field", sa.String(32), nullable=False),
        sa.Column("value", sa.String(255), nullable=False),
        sa.Column("confidence", sa.String(32), nullable=False),
        sa.Column("reason", sa.String(300), nullable=False),
        sa.Column("source_page", sa.Integer, nullable=False),
        sa.Column("source_snippet", sa.String(200), nullable=False),
    )
    op.create_index("ix_metadata_proposals_run_id", "metadata_proposals", ["run_id"])
    op.create_table(
        "metadata_decisions",
        sa.Column("id", sa.Integer, primary_key=True, autoincrement=True),
        sa.Column("document_id", sa.String(32), sa.ForeignKey("documents.id"), nullable=False),
        sa.Column("field", sa.String(32), nullable=False),
        sa.Column("action", sa.String(32), nullable=False),
        sa.Column("value", sa.String(255)),
        sa.Column("proposal_id", sa.Integer, sa.ForeignKey("metadata_proposals.id")),
        sa.Column("decided_at", sa.String(32), nullable=False),
    )
    op.create_index("ix_metadata_decisions_document_id", "metadata_decisions", ["document_id"])


def downgrade() -> None:
    op.drop_table("metadata_decisions")
    op.drop_table("metadata_proposals")
    op.drop_table("extraction_runs")
    with op.batch_alter_table("documents") as batch:
        batch.add_column(sa.Column("document_type", sa.String(32), nullable=False, server_default="unclassified"))
        batch.add_column(sa.Column("processing_status", sa.String(32), nullable=False, server_default="uploaded"))
        batch.drop_column("verification_status")
        batch.drop_column("review_status")
        batch.drop_column("extraction_status")
