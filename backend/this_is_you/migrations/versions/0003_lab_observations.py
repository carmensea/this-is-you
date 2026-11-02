"""Add laboratory observations and their revision history

Revision ID: 0003
Revises: 0002
"""
from alembic import op
import sqlalchemy as sa

revision = "0003"
down_revision = "0002"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "lab_observations",
        sa.Column("id", sa.String(32), primary_key=True),
        sa.Column("document_id", sa.String(32), sa.ForeignKey("documents.id")),
        sa.Column("run_id", sa.Integer, sa.ForeignKey("extraction_runs.id")),
        sa.Column("origin", sa.String(32), nullable=False),
        sa.Column("extraction_status", sa.String(32), nullable=False),
        sa.Column("verification_status", sa.String(32), nullable=False),
        sa.Column("confidence", sa.String(32)),
        sa.Column("reported_name", sa.String(200), nullable=False),
        sa.Column("test_code", sa.String(32)),
        sa.Column("code_system", sa.String(32)),
        sa.Column("value_text", sa.String(60), nullable=False),
        sa.Column("value_number", sa.Float),
        sa.Column("unit", sa.String(40)),
        sa.Column("normalized_value", sa.Float),
        sa.Column("normalized_unit", sa.String(40)),
        sa.Column("reference_text", sa.String(60)),
        sa.Column("reference_low", sa.Float),
        sa.Column("reference_high", sa.Float),
        sa.Column("flag", sa.String(12)),
        sa.Column("lab_name", sa.String(255)),
        sa.Column("collected_on", sa.String(10)),
        sa.Column("reported_on", sa.String(10)),
        sa.Column("documented_on", sa.String(10)),
        sa.Column("imported_at", sa.String(32), nullable=False),
        sa.Column("source_page", sa.Integer),
        sa.Column("source_line", sa.Integer),
        sa.Column("source_text", sa.String(200)),
        sa.Column("issues", sa.JSON, nullable=False),
    )
    op.create_index("ix_lab_observations_document_id", "lab_observations", ["document_id"])
    op.create_index("ix_lab_observations_test_code", "lab_observations", ["test_code"])
    op.create_index("ix_lab_observations_verification_status", "lab_observations", ["verification_status"])
    op.create_index("ix_lab_observations_collected_on", "lab_observations", ["collected_on"])
    op.create_table(
        "lab_observation_revisions",
        sa.Column("id", sa.Integer, primary_key=True, autoincrement=True),
        sa.Column("observation_id", sa.String(32), sa.ForeignKey("lab_observations.id"), nullable=False),
        sa.Column("action", sa.String(32), nullable=False),
        sa.Column("values", sa.JSON, nullable=False),
        sa.Column("occurred_at", sa.String(32), nullable=False),
    )
    op.create_index("ix_lab_observation_revisions_observation_id", "lab_observation_revisions", ["observation_id"])


def downgrade() -> None:
    op.drop_table("lab_observation_revisions")
    op.drop_table("lab_observations")
