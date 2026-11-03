"""Start the service: python -m this_is_you. Or back up, check and restore: see --help."""
from __future__ import annotations

import argparse
import logging
import os
import sys
from pathlib import Path

import uvicorn

from .backup import BackupProblem, create_backup, hold_service_lock, restore_backup, verify_backup
from .config import UnsafeConfiguration, load_settings


def serve(settings) -> None:
    logging.basicConfig(level=logging.INFO, format="%(levelname)s %(name)s: %(message)s")
    logging.getLogger("alembic").setLevel(logging.WARNING)
    settings.data_dir.mkdir(parents=True, exist_ok=True, mode=0o700)
    try:
        _lock = hold_service_lock(settings.data_dir)  # Held until this process ends, however it ends.
    except BackupProblem as problem:
        sys.exit(str(problem))
    print(f"This Is You archive service on http://{settings.host}:{settings.port}\nDocuments are stored in {settings.data_dir}", flush=True)
    # Access logs stay off: request details about health records have no business in a log.
    uvicorn.run("this_is_you.main:app_factory", factory=True, host=settings.host, port=settings.port, access_log=False, server_header=False, log_level="warning")


def main() -> None:
    os.umask(0o077)  # Everything this process creates is private to this user.
    parser = argparse.ArgumentParser(prog="this_is_you")
    commands = parser.add_subparsers(dest="command")
    backup = commands.add_parser("backup", help="Write a backup. Safe while the service runs.")
    backup.add_argument("--to", type=Path, help="Folder to write into. Defaults to the backups folder.")
    verify = commands.add_parser("verify", help="Check a backup against its manifest. Changes nothing.")
    verify.add_argument("backup", type=Path)
    restore = commands.add_parser("restore", help="Restore a backup into a folder.")
    restore.add_argument("backup", type=Path)
    restore.add_argument("--to", type=Path, required=True, help="Folder to restore into. A new folder is the safe choice.")
    restore.add_argument("--accept-recorded-problems", action="store_true", help="Restore a backup that recorded missing or changed originals when it was made.")
    args = parser.parse_args()
    try:
        settings = load_settings()
    except UnsafeConfiguration as problem:
        sys.exit(str(problem))
    try:
        if args.command is None:
            serve(settings)
        elif args.command == "backup":
            result = create_backup(settings.database_path, settings.originals_dir, args.to or settings.backups_dir)
            print(f"Backup written: {result.path}\n{result.documents} documents, {result.bytes} bytes.")
            for problem in result.problems:
                print(f"Problem: {problem}")
            check = verify_backup(result.path)
            print("Check passed." if check.ok else "Check failed: " + " ".join(check.problems))
            sys.exit(0 if check.ok else 1)
        elif args.command == "verify":
            check = verify_backup(args.backup)
            print("Check passed." if check.ok else "Check failed: " + " ".join(check.problems))
            sys.exit(0 if check.ok else 1)
        elif args.command == "restore":
            target = args.to.expanduser().resolve()
            confirmation = None
            if target.exists() and any(target.iterdir()):
                print(f'"{target}" already holds files. It will be moved aside, not deleted.')
                try:
                    confirmation = input(f'Type "{target.name}" to replace it: ').strip() if sys.stdin.isatty() else None
                except (EOFError, KeyboardInterrupt):
                    confirmation = None
            moved = restore_backup(args.backup, target, confirmation, args.accept_recorded_problems)
            print(f"Restored to {target}.")
            if moved:
                print(f"The previous archive was kept at {moved}.")
    except BackupProblem as problem:
        sys.exit(str(problem))
    except OSError:
        sys.exit("This could not be written or read. Check that the folder exists, the drive is connected and it has free space.")


if __name__ == "__main__":
    main()
