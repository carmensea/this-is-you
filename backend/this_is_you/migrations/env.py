"""Alembic environment. The app passes a connection in; the alembic CLI uses THIS_IS_YOU_DATA_DIR."""
from alembic import context

from this_is_you.config import load_settings
from this_is_you.db import make_engine
from this_is_you.models import Base


def run(connection) -> None:
    # Batch mode lets SQLite alter tables by rebuilding them.
    context.configure(connection=connection, target_metadata=Base.metadata, render_as_batch=True)
    with context.begin_transaction():
        context.run_migrations()


existing = context.config.attributes.get("connection")
if existing is not None:
    run(existing)
else:
    settings = load_settings()
    settings.data_dir.mkdir(parents=True, exist_ok=True)
    with make_engine(settings.database_path).connect() as connection:
        run(connection)
