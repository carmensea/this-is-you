"""Add group approvals of laboratory results. Existing results, decisions and history are not changed.

Revision ID: 0006
Revises: 0005
"""
from alembic import op
import sqlalchemy as sa

revision = "0006"
down_revision = "0005"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "review_group_approvals",
        sa.Column("id", sa.String(32), primary_key=True),
        sa.Column("document_id", sa.String(32), sa.ForeignKey("documents.id"), nullable=False),
        sa.Column("group_key", sa.String(80), nullable=False),
        sa.Column("collected_on", sa.String(10)),
        sa.Column("result_count", sa.Integer, nullable=False),
        sa.Column("approved_at", sa.String(32), nullable=False),
        sa.Column("undone_at", sa.String(32)),
    )
    op.create_index("ix_review_group_approvals_document_id", "review_group_approvals", ["document_id"])
    op.add_column("lab_observations", sa.Column("source_section", sa.Integer))
    op.add_column("lab_observations", sa.Column("approved_group_id", sa.String(32)))
    op.create_index("ix_lab_observations_approved_group_id", "lab_observations", ["approved_group_id"])
    op.add_column("lab_observation_revisions", sa.Column("review_group_id", sa.String(32)))


def downgrade() -> None:
    op.drop_column("lab_observation_revisions", "review_group_id")
    op.drop_index("ix_lab_observations_approved_group_id", "lab_observations")
    op.drop_column("lab_observations", "approved_group_id")
    op.drop_column("lab_observations", "source_section")
    op.drop_index("ix_review_group_approvals_document_id", "review_group_approvals")
    op.drop_table("review_group_approvals")
