from __future__ import annotations

import sqlite3
import stat

from alembic import command
from alembic.autogenerate import compare_metadata
from alembic.migration import MigrationContext
from sqlalchemy import inspect, text

from this_is_you.db import make_engine, migrate, run_migration
from this_is_you.models import Base


def test_migrations_create_exactly_what_the_models_describe(tmp_path):
    engine = make_engine(tmp_path / "db.sqlite3")
    migrate(engine)
    with engine.connect() as connection:
        assert compare_metadata(MigrationContext.configure(connection), Base.metadata) == []
    assert {"documents", "import_events", "alembic_version"} <= set(inspect(engine).get_table_names())


def test_migrating_twice_is_harmless(tmp_path):
    engine = make_engine(tmp_path / "db.sqlite3")
    migrate(engine)
    migrate(engine)


def test_database_settings_protect_against_data_loss(tmp_path):
    engine = make_engine(tmp_path / "db.sqlite3")
    with engine.connect() as connection:
        assert connection.exec_driver_sql("PRAGMA foreign_keys").scalar() == 1
        assert connection.exec_driver_sql("PRAGMA journal_mode").scalar() == "wal"
        assert connection.exec_driver_sql("PRAGMA synchronous").scalar() == 2


def test_upgrading_an_archive_from_the_previous_version_keeps_its_documents(tmp_path):
    """A database made by migration 0001, as an earlier release left it."""
    engine = make_engine(tmp_path / "db.sqlite3")
    run_migration(engine, lambda config: command.upgrade(config, "0001"))
    with engine.begin() as connection:
        connection.execute(text("INSERT INTO documents VALUES ('abc', :sha, 'old.pdf', 'application/pdf', 10, 'unclassified', 'uploaded', 'aa/bb/x.pdf', '2026-01-01T00:00:00Z')"), {"sha": "a" * 64})
        connection.execute(text("INSERT INTO import_events (document_id, submitted_filename, outcome, occurred_at) VALUES ('abc', 'old.pdf', 'stored', '2026-01-01T00:00:00Z')"))
    migrate(engine)
    with engine.connect() as connection:
        row = connection.execute(text("SELECT original_filename, extraction_status, review_status, verification_status FROM documents")).one()
        assert tuple(row) == ("old.pdf", "pending", "not_started", "unverified")
        assert connection.execute(text("SELECT COUNT(*) FROM import_events")).scalar() == 1
        assert compare_metadata(MigrationContext.configure(connection), Base.metadata) == []
        assert connection.exec_driver_sql("PRAGMA foreign_keys").scalar() == 1


def test_upgrading_backs_up_the_database_first(tmp_path):
    engine = make_engine(tmp_path / "db.sqlite3")
    run_migration(engine, lambda config: command.upgrade(config, "0001"))
    with engine.begin() as connection:
        connection.execute(text("INSERT INTO documents VALUES ('abc', :sha, 'old.pdf', 'application/pdf', 10, 'unclassified', 'uploaded', 'aa/bb/x.pdf', '2026-01-01T00:00:00Z')"), {"sha": "a" * 64})
    migrate(engine)
    backups = list(tmp_path.glob("db.sqlite3.before-upgrade-*"))
    assert len(backups) == 1
    assert stat.S_IMODE(backups[0].stat().st_mode) == 0o600
    old = sqlite3.connect(backups[0])
    assert old.execute("SELECT processing_status FROM documents").fetchone() == ("uploaded",)
    old.close()
    migrate(engine)  # Already current, so no second backup.
    assert len(list(tmp_path.glob("db.sqlite3.before-upgrade-*"))) == 1


def test_a_new_archive_needs_no_backup(tmp_path):
    migrate(make_engine(tmp_path / "db.sqlite3"))
    assert list(tmp_path.glob("db.sqlite3.before-upgrade-*")) == []


def test_downgrading_works_with_history_present(tmp_path):
    engine = make_engine(tmp_path / "db.sqlite3")
    migrate(engine)
    with engine.begin() as connection:
        connection.execute(text("INSERT INTO documents (id, sha256, original_filename, media_type, byte_size, storage_key, imported_at, extraction_status, review_status, verification_status) VALUES ('abc', :sha, 'a.pdf', 'application/pdf', 1, 'k', 't', 'extracted', 'not_started', 'unverified')"), {"sha": "a" * 64})
        connection.execute(text("INSERT INTO import_events (document_id, submitted_filename, outcome, occurred_at) VALUES ('abc', 'a.pdf', 'stored', 't')"))
    run_migration(engine, lambda config: command.downgrade(config, "0001"))
    assert "extraction_runs" not in inspect(engine).get_table_names()
    with engine.connect() as connection:
        assert connection.execute(text("SELECT COUNT(*) FROM import_events")).scalar() == 1
