"""Start the service: python -m this_is_you. Or set a passphrase, back up, check, restore and tidy: see --help."""
from __future__ import annotations

import argparse
import getpass
import logging
import os
import sys
from pathlib import Path

import uvicorn
from sqlalchemy.orm import sessionmaker

from . import auth
from .backup import (
    BackupProblem,
    apply_prune,
    create_backup,
    create_encrypted_backup,
    hold_service_lock,
    on_same_drive,
    plan_prune,
    require_destination,
    require_drive,
    restore_backup,
    restore_sealed,
    verify_backup,
    verify_sealed,
)
from .backup_crypto import EXTENSION, MIN_PASSPHRASE, load_key, make_key, save_key
from .config import UnsafeConfiguration, is_loopback_host, load_settings
from .db import make_engine, migrate
from .extraction.sandbox import FULL, UNAVAILABLE, configure, isolation


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
    # Forwarded headers are ignored, so nothing a client sends can change who it appears to be.
    # A client that stops reading cannot hold the service open once it is told to stop. Crashes are already safe.
    uvicorn.run("this_is_you.main:app_factory", factory=True, host=settings.host, port=settings.port, access_log=False, server_header=False, log_level="warning", proxy_headers=False, timeout_graceful_shutdown=10)


def _ask_secret(prompt: str, confirm: bool = False) -> str:
    """Typed with no echo. A script can pipe it in, so it never has to appear in a command line or the environment."""
    try:
        if not sys.stdin.isatty():
            return sys.stdin.readline().rstrip("\r\n")
        secret = getpass.getpass(prompt)
        if confirm and getpass.getpass("Type it again: ") != secret:
            sys.exit("Those did not match. Nothing was changed.")
        return secret
    except (EOFError, KeyboardInterrupt):
        sys.exit("Nothing was changed.")


def _sessions(settings) -> sessionmaker:
    settings.data_dir.mkdir(parents=True, exist_ok=True, mode=0o700)
    engine = make_engine(settings.database_path)
    migrate(engine)
    return sessionmaker(engine, expire_on_commit=False)


def _print_check(check) -> None:
    print("Check passed." if check.ok else "Check failed: " + " ".join(check.problems))
    sys.exit(0 if check.ok else 1)


def _backup(settings, args) -> None:
    destination = (args.to.expanduser() if args.to else settings.backups_dir).absolute()
    require_destination(destination)
    require_drive(settings, destination)
    settings.data_dir.mkdir(parents=True, exist_ok=True, mode=0o700)
    if on_same_drive(destination, settings.data_dir):
        print("Note: this is the same drive as the archive, so losing the drive loses both. Copy it elsewhere or use --to.")
    if not args.plain:
        key = load_key(settings.backup_key_path)
        if key is None:
            sys.exit("Set a backup passphrase first: backup-key set. Or use --plain for an unencrypted copy.")
        result = create_encrypted_backup(settings, destination, key)
        print(f"Encrypted backup written and tested: {result.path}\n{result.documents} documents, {result.bytes} bytes.\nThis machine cannot open it. Only your backup passphrase can.")
        for problem in result.problems:
            print(f"Problem: {problem}")
        return
    print("This backup is NOT encrypted. Anyone who can read this folder or drive can read every record in it.")
    result = create_backup(settings.database_path, settings.originals_dir, destination)
    print(f"Backup written: {result.path}\n{result.documents} documents, {result.bytes} bytes.")
    if destination.stat().st_mode & 0o077:
        print("Warning: this drive does not keep files private to you either. Make an encrypted backup instead.")
    for problem in result.problems:
        print(f"Problem: {problem}")
    _print_check(verify_backup(result.path))


def _restore(args) -> None:
    target = args.to.expanduser().resolve()
    confirmation = None
    if target.exists() and any(target.iterdir()):
        print(f'"{target}" already holds files. It will be moved aside, not deleted.')
        try:
            confirmation = input(f'Type "{target.name}" to replace it: ').strip() if sys.stdin.isatty() else None
        except (EOFError, KeyboardInterrupt):
            confirmation = None
    if args.backup.name.endswith(EXTENSION):
        moved = restore_sealed(args.backup, target, _ask_secret("Passphrase for this backup: "), confirmation, args.accept_recorded_problems)
    else:
        moved = restore_backup(args.backup, target, confirmation, args.accept_recorded_problems)
    print(f"Restored to {target}.")
    print("Set a passphrase for it before signing in: sign-in details are never in a backup.")
    if moved:
        print(f"The previous archive was kept at {moved}.")


def _prune(settings, args) -> None:
    plan = plan_prune(settings, args.keep, args.include_replaced)
    if not plan:
        print("Nothing to remove.")
        return
    for item in plan:
        print(f"{item.why}: {item.path}")
    if not args.yes:
        print("Nothing was removed. Add --yes to remove these.")
        return
    apply_prune(plan)
    print(f"Removed {len(plan)}. Copies on other drives are not affected, and files already deleted may remain recoverable from the disk.")


def _backup_key(settings) -> None:
    print("Without this passphrase, every backup made with it is gone for good. Nothing on this machine can recover it. Write it down and keep it away from this machine.")
    passphrase = _ask_secret("Backup passphrase: ", confirm=True)
    if len(passphrase) < MIN_PASSPHRASE:
        sys.exit(f"Use at least {MIN_PASSPHRASE} characters. Several unrelated words work well. Nothing was changed.")
    settings.data_dir.mkdir(parents=True, exist_ok=True, mode=0o700)
    save_key(make_key(passphrase), settings.backup_key_path)
    print("Backups are now encrypted for this passphrase. It is not stored here. Older backups still open with the passphrase they were made with.")


def _reader_line(settings) -> str:
    configure(data_dir_or_none(settings), settings.reader_must_be_sandboxed, settings.reader_socket)
    level = isolation()
    if level == FULL:
        where = "in its own container" if settings.reader_socket else "sandboxed"
        return f"{where}, and it passed a test of what it should block"
    if level == UNAVAILABLE:
        return "STOPPED: no working sandbox, so nothing is being read. Check the reader container and its logs."
    return "limits only, with no sandbox. Fine for trying it out with fictional files. Production uses the reader container."


def data_dir_or_none(settings):
    return settings.data_dir if settings.data_dir.is_dir() else None


def _doctor(settings) -> None:
    """Where this archive stands on the things a person can act on. Changes nothing."""
    data = settings.data_dir
    if not data.is_dir():
        print("No archive here yet.")
        return
    sessions = _sessions(settings)
    lines = [
        ("Passphrase", "set" if auth.is_configured(sessions) else "NOT SET: run set-passphrase, nothing can be read until then"),
        ("Signed-in devices", str(auth.count_sessions(sessions))),
        ("Listening on", f"{settings.host}:{settings.port}" + ("" if is_loopback_host(settings.host) else " NOT PRIVATE")),
        ("Archive folder", "private to you" if not data.stat().st_mode & 0o077 else "OPEN TO OTHER ACCOUNTS: run chmod 700 on it"),
        ("PDF reader", _reader_line(settings)),
        ("Backup key", "set" if load_key(settings.backup_key_path) else "NOT SET: run backup-key set, Back up now is off until then"),
        ("Backups", "ON THE SAME DRIVE as the archive" if on_same_drive(settings.backups_dir, data) else "on another drive"),
        ("Set aside", f"{sum(1 for _ in settings.quarantine_dir.iterdir()) if settings.quarantine_dir.is_dir() else 0} files to look at in {settings.quarantine_dir}"),
        ("Old full copies", f"{len(list(data.glob('*.before-upgrade-*')))} pre-upgrade databases, {len(list(data.parent.glob(data.name + '.replaced-*')))} replaced archives"),
    ]
    for name, value in lines:
        print(f"{name}: {value}")


def main() -> None:
    os.umask(0o077)  # Everything this process creates is private to this user.
    parser = argparse.ArgumentParser(prog="this_is_you")
    commands = parser.add_subparsers(dest="command")
    commands.add_parser("set-passphrase", help="Set or replace the sign-in passphrase. Signs out every device.")
    commands.add_parser("sign-out-everywhere", help="End every signed-in session, as after losing a device.")
    commands.add_parser("doctor", help="Show where this archive stands on security and backups. Changes nothing.")
    backup = commands.add_parser("backup", help="Write a backup. Safe while the service runs.")
    backup.add_argument("--to", type=Path, help="Folder to write into. Defaults to the backups folder. Its parent has to exist already.")
    backup.add_argument("--plain", action="store_true", help="Write an UNENCRYPTED folder. Anyone who can read it can read every record.")
    key = commands.add_parser("backup-key", help="Set the passphrase that encrypted backups are made for.")
    key.add_argument("action", choices=["set"])
    verify = commands.add_parser("verify", help="Check a backup against its manifest. Changes nothing.")
    verify.add_argument("backup", type=Path)
    restore = commands.add_parser("restore", help="Restore a backup into a folder.")
    restore.add_argument("backup", type=Path)
    restore.add_argument("--to", type=Path, required=True, help="Folder to restore into. A new folder is the safe choice.")
    restore.add_argument("--accept-recorded-problems", action="store_true", help="Restore a backup that recorded missing or changed originals when it was made.")
    prune = commands.add_parser("prune", help="List old backups and leftovers. Removes them only with --yes.")
    prune.add_argument("--keep", type=int, default=3, help="Newest backups to keep. The newest that passed a check is always kept.")
    prune.add_argument("--include-replaced", action="store_true", help="Also list archives moved aside by a restore.")
    prune.add_argument("--yes", action="store_true", help="Remove what is listed.")
    args = parser.parse_args()
    try:
        settings = load_settings()
    except UnsafeConfiguration as problem:
        sys.exit(str(problem))
    try:
        if args.command is None:
            serve(settings)
        elif args.command == "set-passphrase":
            try:
                auth.set_passphrase(_sessions(settings), _ask_secret("New passphrase: ", confirm=True))
            except auth.WeakPassphrase as problem:
                sys.exit(f"{problem} Nothing was changed.")
            print("Passphrase set. Every device was signed out.")
        elif args.command == "sign-out-everywhere":
            auth.end_all_sessions(_sessions(settings))
            print("Every device was signed out.")
        elif args.command == "doctor":
            _doctor(settings)
        elif args.command == "backup":
            _backup(settings, args)
        elif args.command == "backup-key":
            _backup_key(settings)
        elif args.command == "verify":
            if args.backup.name.endswith(EXTENSION):
                _print_check(verify_sealed(args.backup, settings.staging_dir, _ask_secret("Passphrase for this backup: ")))
            _print_check(verify_backup(args.backup))
        elif args.command == "restore":
            _restore(args)
        elif args.command == "prune":
            _prune(settings, args)
    except BackupProblem as problem:
        sys.exit(str(problem))
    except OSError:
        sys.exit("This could not be written or read. Check that the folder exists, the drive is connected and it has free space.")


if __name__ == "__main__":
    main()
