"""Add import reports, the identity profile, and what each reading found under a patient label

Revision ID: 0004
Revises: 0003
"""
from alembic import op
import sqlalchemy as sa

revision = "0004"
down_revision = "0003"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("extraction_runs", sa.Column("patient_found", sa.JSON))
    op.create_table(
        "import_batches",
        sa.Column("id", sa.String(32), primary_key=True),
        sa.Column("label", sa.String(255), nullable=False),
        sa.Column("created_at", sa.String(32), nullable=False),
        sa.Column("hidden", sa.Boolean, nullable=False),
    )
    op.create_table(
        "import_items",
        sa.Column("id", sa.Integer, primary_key=True, autoincrement=True),
        sa.Column("batch_id", sa.String(32), sa.ForeignKey("import_batches.id"), nullable=False),
        sa.Column("path", sa.String(1024), nullable=False),
        sa.Column("byte_size", sa.BigInteger, nullable=False),
        sa.Column("modified_ms", sa.BigInteger, nullable=False),
        sa.Column("state", sa.String(32), nullable=False),
        sa.Column("message", sa.String(300)),
        sa.Column("document_id", sa.String(32), sa.ForeignKey("documents.id")),
        sa.Column("attempts", sa.Integer, nullable=False),
        sa.Column("updated_at", sa.String(32), nullable=False),
        sa.UniqueConstraint("batch_id", "path", name="uq_import_items_batch_path"),
    )
    op.create_index("ix_import_items_document_id", "import_items", ["document_id"])
    op.create_index("ix_import_items_batch_state", "import_items", ["batch_id", "state"])
    op.create_table(
        "identity_profile",
        sa.Column("id", sa.Integer, primary_key=True),
        sa.Column("full_name", sa.String(200), nullable=False),
        sa.Column("date_of_birth", sa.String(10)),
        sa.Column("previous_names", sa.JSON, nullable=False),
        sa.Column("updated_at", sa.String(32), nullable=False),
    )


def downgrade() -> None:
    op.drop_table("identity_profile")
    op.drop_table("import_items")
    op.drop_table("import_batches")
    with op.batch_alter_table("extraction_runs") as batch:
        batch.drop_column("patient_found")
