#!/bin/sh
# Prepares the host once. Run with sudo. Safe to run again. Changes only what is listed here.
#   sudo deploy/setup-host.sh [ROOT] [BACKUP_PARENT]
set -eu
ROOT="${1:-/srv/this-is-you}"
PARENT="${2:-/mnt/this-is-you}"
DRIVE="$PARENT/backup-drive"
[ "$(id -u)" = 0 ] || { echo "Run this with sudo."; exit 1; }

# Accounts with no login and no home. Their numbers match compose.yaml. Nothing else on this machine should use them.
add_account() {
  getent group "$2" >/dev/null || groupadd --system --gid "$2" "$1"
  id -u "$1" >/dev/null 2>&1 || useradd --system --uid "$2" --gid "$2" --no-create-home --shell /usr/sbin/nologin "$1"
}
add_account this-is-you 10001
add_account this-is-you-reader 10002
add_account this-is-you-proxy 10003

install -d -m 0755 -o root -g root "$ROOT"
install -d -m 0700 -o 10001 -g 10001 "$ROOT/data"
install -d -m 0700 -o 10003 -g 10003 "$ROOT/tailscale"
install -d -m 0700 -o root -g root "$ROOT/secrets"
install -d -m 0755 -o root -g root "$PARENT"

if mountpoint -q "$DRIVE"; then
  touch "$DRIVE/.this-is-you-backups"
  chown 10001:10001 "$DRIVE" "$DRIVE/.this-is-you-backups"
  chmod 0700 "$DRIVE"
  echo "Backup drive ready at $DRIVE."
else
  # The empty mount point belongs to root, so nothing can be written here while the drive is away.
  install -d -m 0700 -o root -g root "$DRIVE"
  echo "NOTE: nothing is mounted at $DRIVE, so backups stay off until a drive is. Mount it, then run this again."
fi
echo "Host ready. Next: docs/deployment.md."
