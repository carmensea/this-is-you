"""Runs in its own process, on a fictional archive, and kills itself with SIGKILL at a chosen moment. No cleanup runs."""
from __future__ import annotations

import os
import signal
import sys
from pathlib import Path

from sqlalchemy import event
from sqlalchemy.orm import Session

from this_is_you import reconcile as reconcile_module
from this_is_you.storage import OriginalStore

from .conftest import CLIENT_HEADERS, client_for


def die(*_args, **_kwargs) -> None:
    os.kill(os.getpid(), signal.SIGKILL)


def main(stage: str, data_dir: str, batch: str = "", item: str = "", body_path: str = "") -> None:
    data = Path(data_dir)
    if stage == "during_recovery":  # The first orphan is recorded, then the service dies on the second.
        calls = []
        real_now = reconcile_module.utc_now

        def second_call_dies():
            calls.append(1)
            if len(calls) == 2:
                die()
            return real_now()

        reconcile_module.utc_now = second_call_dies
        client_for(data)
        return
    real_commit = OriginalStore.commit

    def commit(self, received):
        if stage == "before_file":
            die()
        key = real_commit(self, received)
        if stage == "after_file":
            die()
        if stage == "inside_transaction":
            event.listen(Session, "after_flush", die)
        if stage == "after_transaction":
            event.listen(Session, "after_commit", die)
        return key

    OriginalStore.commit = commit
    client = client_for(data)
    client.post(f"/api/import-batches/{batch}/items/{item}/file", content=Path(body_path).read_bytes(), headers={**CLIENT_HEADERS, "content-type": "application/pdf"})


if __name__ == "__main__":
    main(*sys.argv[1:])
