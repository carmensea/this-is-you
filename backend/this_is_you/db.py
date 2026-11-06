"""SQLite engine and migrations."""
from __future__ import annotations

import os
import sqlite3
from collections.abc import Callable
from datetime import datetime, timezone
from pathlib import Path

from alembic import command
from alembic.config import Config
from alembic.migration import MigrationContext
from alembic.script import ScriptDirectory
from sqlalchemy import Engine, create_engine, event


def make_engine(database_path: Path) -> Engine:
    # SQLite gives the -wal and -shm files the same permissions as this one.
    os.close(os.open(database_path, os.O_CREAT | os.O_RDWR, 0o600))
    # An error message must never carry the values it was given: results and filenames are health information, and errors get logged.
    engine = create_engine(f"sqlite:///{database_path}", hide_parameters=True)

    @event.listens_for(engine, "connect")
    def configure(connection, _record) -> None:
        cursor = connection.cursor()
        cursor.execute("PRAGMA foreign_keys=ON")
        cursor.execute("PRAGMA journal_mode=WAL")
        # Survive power loss: a document reported as stored must still be there after a crash.
        cursor.execute("PRAGMA synchronous=FULL")
        cursor.execute("PRAGMA secure_delete=ON")  # Removed rows are overwritten, not just unlinked.
        cursor.close()

    return engine


def _config() -> Config:
    config = Config()
    config.set_main_option("script_location", str(Path(__file__).parent / "migrations"))
    return config


def _pending(engine: Engine) -> bool:
    """True when an existing archive is behind the latest schema. A new, empty one is not."""
    with engine.connect() as connection:
        current = MigrationContext.configure(connection).get_current_revision()
    return current is not None and current != ScriptDirectory.from_config(_config()).get_current_head()


def back_up(engine: Engine, destination: Path) -> None:
    """A consistent copy of the database, private to this user."""
    os.close(os.open(destination, os.O_CREAT | os.O_RDWR, 0o600))
    source = sqlite3.connect(engine.url.database)
    target = sqlite3.connect(destination)
    try:
        source.backup(target)
    finally:
        target.close()
        source.close()


def run_migration(engine: Engine, step: Callable[[Config], None]) -> None:
    # SQLite alters a table by rebuilding it, and its foreign key checks would refuse to drop a table
    # that other rows point at. They go off for the rebuild, then the whole database is checked.
    config = _config()
    with engine.connect() as connection:
        connection.exec_driver_sql("PRAGMA foreign_keys=OFF")
        connection.commit()
        config.attributes["connection"] = connection
        step(config)
        connection.commit()
        broken = connection.exec_driver_sql("PRAGMA foreign_key_check").fetchall()
        connection.exec_driver_sql("PRAGMA foreign_keys=ON")
        connection.commit()
    if broken:
        raise RuntimeError(f"Migration left {len(broken)} broken references. The database backup is in the archive folder.")


def migrate(engine: Engine) -> None:
    """Bring the database to the latest schema. Safe to run on every start."""
    if _pending(engine):
        database = Path(engine.url.database)
        stamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%S")
        back_up(engine, database.with_name(f"{database.name}.before-upgrade-{stamp}"))
    run_migration(engine, lambda config: command.upgrade(config, "head"))
