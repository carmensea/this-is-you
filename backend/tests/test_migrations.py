from __future__ import annotations

from alembic.autogenerate import compare_metadata
from alembic.migration import MigrationContext
from sqlalchemy import inspect

from this_is_you.db import make_engine, migrate
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
