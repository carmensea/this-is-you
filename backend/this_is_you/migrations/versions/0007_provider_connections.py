"""Add read-only provider connections, their synchronizations and the provider records they returned.

Existing documents, results and decisions are not changed.

Revision ID: 0007
Revises: 0006
"""
from alembic import op
import sqlalchemy as sa

revision = "0007"
down_revision = "0006"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "provider_connections",
        sa.Column("id", sa.String(32), primary_key=True),
        sa.Column("provider_key", sa.String(40), nullable=False, unique=True),
        sa.Column("status", sa.String(32), nullable=False),
        sa.Column("fhir_base", sa.String(255), nullable=False),
        sa.Column("patient_fhir_id", sa.String(128)),
        sa.Column("patient_name", sa.String(200)),
        sa.Column("patient_birth_date", sa.String(10)),
        sa.Column("identity_status", sa.String(32)),
        sa.Column("identity_reason", sa.String(400)),
        sa.Column("confirmed_patient_fhir_id", sa.String(128)),
        sa.Column("scope", sa.String(2000)),
        sa.Column("token_ciphertext", sa.String(8000)),
        sa.Column("token_generation", sa.Integer, nullable=False, server_default="0"),
        sa.Column("connected_at", sa.String(32)),
        sa.Column("disconnected_at", sa.String(32)),
        sa.Column("updated_at", sa.String(32), nullable=False),
    )
    op.create_table(
        "sync_runs",
        sa.Column("id", sa.Integer, primary_key=True, autoincrement=True),
        sa.Column("connection_id", sa.String(32), sa.ForeignKey("provider_connections.id"), nullable=False),
        sa.Column("status", sa.String(32), nullable=False),
        sa.Column("started_at", sa.String(32), nullable=False),
        sa.Column("finished_at", sa.String(32)),
        sa.Column("counts", sa.JSON, nullable=False),
        sa.Column("problems", sa.JSON, nullable=False),
    )
    op.create_index("ix_sync_runs_connection_id", "sync_runs", ["connection_id"])
    op.create_table(
        "fhir_resources",
        sa.Column("id", sa.Integer, primary_key=True, autoincrement=True),
        sa.Column("connection_id", sa.String(32), sa.ForeignKey("provider_connections.id"), nullable=False),
        sa.Column("sync_run_id", sa.Integer, sa.ForeignKey("sync_runs.id"), nullable=False),
        sa.Column("resource_type", sa.String(40), nullable=False),
        sa.Column("fhir_id", sa.String(128), nullable=False),
        sa.Column("version_id", sa.String(64)),
        sa.Column("last_updated", sa.String(40)),
        sa.Column("content_sha256", sa.String(64), nullable=False),
        sa.Column("body", sa.JSON, nullable=False),
        sa.Column("fetched_at", sa.String(32), nullable=False),
        sa.Column("document_id", sa.String(32), sa.ForeignKey("documents.id")),
        sa.UniqueConstraint("connection_id", "resource_type", "fhir_id", "content_sha256"),
    )
    op.create_index("ix_fhir_resources_connection_id", "fhir_resources", ["connection_id"])
    with op.batch_alter_table("lab_observations") as batch:
        batch.add_column(sa.Column("fhir_resource_id", sa.Integer, sa.ForeignKey("fhir_resources.id", name="fk_lab_observations_fhir_resource")))
    op.create_index("ix_lab_observations_fhir_resource_id", "lab_observations", ["fhir_resource_id"])


def downgrade() -> None:
    op.drop_index("ix_lab_observations_fhir_resource_id", "lab_observations")
    with op.batch_alter_table("lab_observations") as batch:
        batch.drop_column("fhir_resource_id")
    op.drop_index("ix_fhir_resources_connection_id", "fhir_resources")
    op.drop_table("fhir_resources")
    op.drop_index("ix_sync_runs_connection_id", "sync_runs")
    op.drop_table("sync_runs")
    op.drop_table("provider_connections")
