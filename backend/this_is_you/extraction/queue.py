"""Reads documents one at a time in the background, so a slow PDF never holds up the rest of the app."""
from __future__ import annotations

import logging
import queue
import threading
from collections.abc import Callable

log = logging.getLogger("this_is_you.extraction")


class ExtractionQueue:
    def __init__(self, process: Callable[[str], None]) -> None:
        self._process = process
        self._jobs: queue.Queue[str] = queue.Queue()
        threading.Thread(target=self._run, daemon=True, name="document-reader").start()

    def enqueue(self, document_id: str) -> None:
        self._jobs.put(document_id)

    def wait_idle(self) -> None:
        """For tests: blocks until everything queued so far is finished."""
        self._jobs.join()

    def _run(self) -> None:
        while True:
            document_id = self._jobs.get()
            try:
                self._process(document_id)
            except Exception as problem:
                # The type only. An exception message could quote the document.
                log.error("document %s: reader failed with %s", document_id, type(problem).__name__)
            finally:
                self._jobs.task_done()
