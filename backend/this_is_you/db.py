"""SQLite engine and migrations."""
from __future__ import annotations

import os
from pathlib import Path

from alembic import command
from alembic.config import Config
from sqlalchemy import Engine, create_engine, event


def make_engine(database_path: Path) -> Engine:
    # SQLite gives the -wal and -shm files the same permissions as this one.
    os.close(os.open(database_path, os.O_CREAT | os.O_RDWR, 0o600))
    engine = create_engine(f"sqlite:///{database_path}")

    @event.listens_for(engine, "connect")
    def configure(connection, _record) -> None:
        cursor = connection.cursor()
        cursor.execute("PRAGMA foreign_keys=ON")
        cursor.execute("PRAGMA journal_mode=WAL")
        # Survive power loss: a document reported as stored must still be there after a crash.
        cursor.execute("PRAGMA synchronous=FULL")
        cursor.close()

    return engine


def migrate(engine: Engine) -> None:
    """Bring the database to the latest schema. Safe to run on every start."""
    config = Config()
    config.set_main_option("script_location", str(Path(__file__).parent / "migrations"))
    with engine.begin() as connection:
        config.attributes["connection"] = connection
        command.upgrade(config, "head")
