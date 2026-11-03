#!/bin/bash
# Run this AS the account you want to keep away from the archive: a Claude Code agent's account, or another app's.
# It only looks. It changes nothing, and prints FAIL for anything that account could reach.
#   sudo -u agent deploy/check-isolation.sh [ROOT] [BACKUP_DRIVE]
ROOT="${1:-/srv/this-is-you}"
BACKUPS="${2:-/mnt/this-is-you/backup-drive}"
failed=0
pass() { echo "PASS $1"; }
fail() { echo "FAIL $1"; failed=1; }

echo "Checking as: $(id -un) ($(id -Gn))"
[ "$(id -u)" != 0 ] && pass "not root" || fail "this is root, which reaches everything"
id -nG | tr ' ' '\n' | grep -qx docker && fail "in the docker group, which equals root: it can mount the archive" || pass "not in the docker group"
id -nG | tr ' ' '\n' | grep -qxE "sudo|wheel|admin|adm|lxd|libvirt" && fail "in a group that can become root or read logs" || pass "not in an admin group"
sudo -n true 2>/dev/null && fail "can use sudo without a password" || pass "no passwordless sudo"
docker ps >/dev/null 2>&1 && fail "can talk to Docker" || pass "cannot talk to Docker"
for path in "$ROOT/data" "$ROOT/data/archive.sqlite3" "$ROOT/data/originals" "$ROOT/tailscale" "$ROOT/secrets" "$BACKUPS"; do
  if ls "$path" >/dev/null 2>&1; then fail "can read $path"; else pass "cannot read $path"; fi
done
for port in 8000 443 8443; do
  if (exec 3<>"/dev/tcp/127.0.0.1/$port") 2>/dev/null; then echo "NOTE port $port answers on this machine's loopback. In production nothing should."; fi
done 2>/dev/null
for name in "$HOME/.ssh/id_ed25519" "$HOME/.ssh/id_rsa"; do
  [ -r "$name" ] && echo "NOTE this account has an SSH key ($name). Make sure it opens nothing that holds the archive."
done
[ "$failed" = 0 ] && echo "This account cannot reach the archive through these paths." || echo "FIX the failures above before running anything untrusted on this account."
exit "$failed"
