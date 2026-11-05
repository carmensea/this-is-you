"""The real service on a fictional archive, killed with SIGKILL just after the Nth new file is saved. For import-recovery.mjs only."""
import os
import signal

from this_is_you.__main__ import main
from this_is_you.storage import OriginalStore

remaining = int(os.environ["CRASH_AT_NEW_FILE"])
real_commit = OriginalStore.commit


def commit(self, received):
    global remaining
    is_new = not self.path_for(f"{received.sha256[:2]}/{received.sha256[2:4]}/{received.sha256}.pdf").exists()
    key = real_commit(self, received)
    if is_new:
        remaining -= 1
        if remaining == 0:
            os.kill(os.getpid(), signal.SIGKILL)
    return key


OriginalStore.commit = commit
main()
