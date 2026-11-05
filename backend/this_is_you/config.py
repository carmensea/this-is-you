"""Runtime settings, read from the environment. Unsafe values stop the app from starting."""
from __future__ import annotations

import ipaddress
import os
import re
import sys
from dataclasses import dataclass
from pathlib import Path
from typing import Mapping

from .extraction.runner import Limits

DEFAULT_MAX_UPLOAD_BYTES = 200 * 1024 * 1024


class UnsafeConfiguration(Exception):
    """The requested configuration would put health documents at risk."""


@dataclass(frozen=True)
class Settings:
    data_dir: Path
    host: str = "127.0.0.1"
    port: int = 8000
    max_upload_bytes: int = DEFAULT_MAX_UPLOAD_BYTES
    extraction_limits: Limits = Limits()
    backups_dir_override: Path | None = None
    # Set for a production deployment: the one HTTPS address people reach it at, behind a private proxy.
    public_origin: str | None = None
    # The built app, served by this service in production. Development uses the Vite server instead.
    web_dir: Path | None = None
    require_sandbox: bool = False
    # Where the reader container listens. When set, documents go there and are never read in this process.
    reader_socket: str | None = None

    @property
    def production(self) -> bool:
        return self.public_origin is not None

    @property
    def reader_must_be_sandboxed(self) -> bool:
        return self.production or self.require_sandbox

    @property
    def public_host(self) -> str | None:
        return self.public_origin.removeprefix("https://") if self.public_origin else None

    @property
    def backup_key_path(self) -> Path:
        return self.data_dir / "backup-key.json"

    @property
    def database_path(self) -> Path:
        return self.data_dir / "archive.sqlite3"

    @property
    def originals_dir(self) -> Path:
        return self.data_dir / "originals"

    @property
    def incoming_dir(self) -> Path:
        return self.data_dir / "incoming"

    @property
    def deleting_dir(self) -> Path:
        return self.data_dir / "deleting"

    @property
    def quarantine_dir(self) -> Path:
        return self.data_dir / "set-aside"

    @property
    def staging_dir(self) -> Path:
        return self.data_dir / "backup-staging"

    @property
    def backups_dir(self) -> Path:
        # Beside the archive, not in it. Point this at another drive to survive losing this one.
        return self.backups_dir_override or self.data_dir.with_name(self.data_dir.name + " Backups")


def default_data_dir(env: Mapping[str, str] = os.environ) -> Path:
    home = Path.home()
    if sys.platform == "darwin":
        return home / "Library" / "Application Support" / "ThisIsYou"
    if sys.platform == "win32":
        return Path(env.get("APPDATA", home / "AppData" / "Roaming")) / "ThisIsYou"
    return Path(env.get("XDG_DATA_HOME", home / ".local" / "share")) / "this-is-you"


def is_loopback_host(host: str) -> bool:
    if host == "localhost":
        return True
    try:
        return ipaddress.ip_address(host.strip("[]")).is_loopback
    except ValueError:
        return False


def enclosing_git_repository(path: Path) -> Path | None:
    resolved = path.expanduser().resolve()
    for candidate in (resolved, *resolved.parents):
        if (candidate / ".git").exists():
            return candidate
    return None


def validate(settings: Settings) -> Settings:
    if not is_loopback_host(settings.host):
        raise UnsafeConfiguration(
            f"Refusing to bind to {settings.host}. This service only listens on this computer (127.0.0.1). "
            "Reach it from elsewhere through a private proxy, never by opening it to a network."
        )
    repository = enclosing_git_repository(settings.data_dir)
    if repository is not None:
        raise UnsafeConfiguration(
            f"Refusing to store documents inside the Git repository at {repository}. "
            "Choose a data directory outside it."
        )
    backups = settings.backups_dir.expanduser().resolve()
    if enclosing_git_repository(backups) is not None:
        raise UnsafeConfiguration("Refusing to keep backups inside a Git repository. Choose a folder outside it.")
    if backups.is_relative_to(settings.data_dir.expanduser().resolve()):
        raise UnsafeConfiguration("Refusing to keep backups inside the archive folder. Choose a folder outside it.")
    if settings.public_origin is not None and not re.fullmatch(r"https://[a-z0-9.-]+(:\d{1,5})?", settings.public_origin):
        raise UnsafeConfiguration("THIS_IS_YOU_PUBLIC_ORIGIN must be one lowercase https address with no path, like https://archive.example.ts.net.")
    if settings.web_dir is not None and not (settings.web_dir / "index.html").is_file():
        raise UnsafeConfiguration("THIS_IS_YOU_WEB_DIR does not hold a built app.")
    if settings.max_upload_bytes <= 0:
        raise UnsafeConfiguration("THIS_IS_YOU_MAX_UPLOAD_BYTES must be positive.")
    return settings


def load_settings(env: Mapping[str, str] = os.environ) -> Settings:
    configured = env.get("THIS_IS_YOU_DATA_DIR")
    return validate(
        Settings(
            data_dir=Path(configured).expanduser() if configured else default_data_dir(env),
            host=env.get("THIS_IS_YOU_HOST", "127.0.0.1"),
            port=int(env.get("THIS_IS_YOU_PORT", "8000")),
            max_upload_bytes=int(env.get("THIS_IS_YOU_MAX_UPLOAD_BYTES", DEFAULT_MAX_UPLOAD_BYTES)),
            backups_dir_override=Path(env["THIS_IS_YOU_BACKUP_DIR"]).expanduser() if env.get("THIS_IS_YOU_BACKUP_DIR") else None,
            public_origin=env.get("THIS_IS_YOU_PUBLIC_ORIGIN") or None,
            web_dir=Path(env["THIS_IS_YOU_WEB_DIR"]) if env.get("THIS_IS_YOU_WEB_DIR") else None,
            require_sandbox=env.get("THIS_IS_YOU_REQUIRE_SANDBOX") == "1",
            reader_socket=env.get("THIS_IS_YOU_READER_SOCKET") or None,
        )
    )
