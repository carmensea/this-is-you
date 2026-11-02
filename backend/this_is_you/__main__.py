"""Start the service: python -m this_is_you"""
from __future__ import annotations

import logging
import os
import sys

import uvicorn

from .config import UnsafeConfiguration, load_settings


def main() -> None:
    os.umask(0o077)  # Everything this process creates is private to this user.
    try:
        settings = load_settings()
    except UnsafeConfiguration as problem:
        sys.exit(str(problem))
    logging.basicConfig(level=logging.INFO, format="%(levelname)s %(name)s: %(message)s")
    logging.getLogger("alembic").setLevel(logging.WARNING)
    print(f"This Is You archive service on http://{settings.host}:{settings.port}\nDocuments are stored in {settings.data_dir}", flush=True)
    # Access logs stay off: request details about health records have no business in a log.
    uvicorn.run("this_is_you.main:app_factory", factory=True, host=settings.host, port=settings.port, access_log=False, server_header=False, log_level="warning")


if __name__ == "__main__":
    main()
