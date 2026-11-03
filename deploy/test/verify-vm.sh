#!/bin/bash
# Verifies the production deployment on a real Linux machine with Docker, using fictional records only.
# Never run this on a machine holding a real archive: it wipes /srv/this-is-you and removes containers.
#   deploy/test/verify-vm.sh setup | posture | attacks | auth | failsafe | backups | crashes | update | isolation | after-reboot
# It uses the stand-in proxy, so Tailscale itself is not covered. docs/deployment.md lists what only real hardware shows.
set -u
ROOT=/srv/this-is-you; DATA=$ROOT/data; PARENT=/mnt/this-is-you; DRIVE=$PARENT/backup-drive; NAME=archive.fictional.ts.net; ORIGIN=https://$NAME:8443
SIGNIN='fictional deployment passphrase'; KEY='fictional backup passphrase here'
JAR=/var/tmp/tiy-cookies; FILES="-f compose.yaml -f deploy/compose.standin.yaml"
cd "$(dirname "$0")/../.."
C() { sudo docker compose $FILES "$@" </dev/null; }
X() { sudo docker compose $FILES exec -T "$@" </dev/null; }
XIN() { sudo docker compose $FILES exec -T "$@"; }
pass=0; fail=0
check() { if [ "$2" = 0 ]; then pass=$((pass+1)); echo "PASS $1"; else fail=$((fail+1)); echo "FAIL $1 ${3:-}"; fi; }
is() { [ "$2" = "$3" ]; check "$1" $? "(got '$2', wanted '$3')"; }
has() { case "$2" in *"$3"*) check "$1" 0;; *) check "$1" 1 "(no '$3' in: $(echo "$2" | head -c 300))";; esac; }
hasnt() { case "$2" in *"$3"*) check "$1" 1 "(found '$3')";; *) check "$1" 0;; esac; }
web() { curl -sk --max-time 40 --resolve $NAME:8443:127.0.0.1 "$@"; }
code() { web -o /dev/null -w '%{http_code}' "$@"; }
login() { rm -f $JAR; web -c $JAR -o /dev/null -w '%{http_code}' -H 'X-This-Is-You-Client: 1' -H "Origin: $ORIGIN" -H 'content-type: application/json' -d "{\"passphrase\":\"$SIGNIN\"}" $ORIGIN/api/auth/login; }
api() { web -b $JAR -H 'X-This-Is-You-Client: 1' -H "Origin: $ORIGIN" "$@"; }
upload() { api -o /dev/null -w '%{http_code}' -H 'content-type: application/pdf' -H "x-original-filename: $2" --data-binary @"$1" $ORIGIN/api/documents; }
count() { api $ORIGIN/api/documents | python3 -c "import json,sys;print(len(json.load(sys.stdin)['documents']))"; }
statuses() { api $ORIGIN/api/documents | python3 -c "import json,sys,collections;print(sorted(collections.Counter(d['extraction_status'] for d in json.load(sys.stdin)['documents']).items()))"; }
pending() { api $ORIGIN/api/documents | python3 -c "import json,sys;print(sum(d['extraction_status'] in ('pending','running') for d in json.load(sys.stdin)['documents']))"; }
wait_healthy() { for _ in $(seq 1 60); do [ "$(sudo docker inspect -f '{{.State.Health.Status}}' this-is-you-app-1 2>/dev/null)" = healthy ] && return 0; sleep 3; done; return 1; }
wait_read() { for _ in $(seq 1 120); do [ "$(pending)" = 0 ] && return 0; sleep 1; done; return 1; }
make_pdf() { python3 - "$1" "$2" <<'PY'
import sys
# A small text PDF with fictional contents. No library, so this works on a bare host.
text = "Fictional Laboratory Report " + sys.argv[2]
stream = f"BT /F1 12 Tf 72 720 Td ({text}) Tj 0 -20 Td (Patient Name: Avery Testperson) Tj 0 -20 Td (Collected: 2024-03-05) Tj 0 -20 Td (Hemoglobin 13.9 g/dL 12.0-16.0) Tj ET".encode()
objects = [b"<< /Type /Catalog /Pages 2 0 R >>", b"<< /Type /Pages /Kids [3 0 R] /Count 1 >>", b"<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>", b"<< /Length %d >>\nstream\n%s\nendstream" % (len(stream), stream), b"<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>"]
out, offsets = b"%PDF-1.4\n", []
for n, body in enumerate(objects, 1):
    offsets.append(len(out))
    out += b"%d 0 obj\n%s\nendobj\n" % (n, body)
xref = len(out)
out += b"xref\n0 6\n0000000000 65535 f \n" + b"".join(b"%010d 00000 n \n" % o for o in offsets) + b"trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n%d\n%%%%EOF\n" % xref
open(sys.argv[1], "wb").write(out)
PY
}

setup() {
  echo "--- setup: a clean machine"
  [ "${TIY_THIS_MACHINE_IS_DISPOSABLE:-}" = yes ] || { echo "This wipes $ROOT. Set TIY_THIS_MACHINE_IS_DISPOSABLE=yes only on a throwaway test machine."; exit 2; }
  sudo docker compose $FILES down -v --remove-orphans </dev/null >/dev/null 2>&1
  sudo umount $DRIVE 2>/dev/null
  sudo rm -rf /srv/this-is-you /mnt/this-is-you # Literal paths, behind the guard above.
  sudo truncate -s 3G /var/tmp/fictional-backup-drive.img; sudo mkfs.ext4 -q -F /var/tmp/fictional-backup-drive.img
  sudo mkdir -p $DRIVE; sudo mount -o loop /var/tmp/fictional-backup-drive.img $DRIVE
  sudo deploy/setup-host.sh $ROOT $PARENT 2>&1 | grep -v "useradd warning"
  cat > .env <<E
TIY_VERSION=local
TIY_TAILNET_NAME=archive
TIY_PUBLIC_ORIGIN=$ORIGIN
TIY_DATA_DIR=$DATA
TIY_TAILSCALE_DIR=$ROOT/tailscale
TIY_BACKUP_PARENT=$PARENT
TIY_AUTHKEY_FILE=/dev/null
E
  sudo docker compose $FILES build --quiet </dev/null 2>&1 | tail -1
  C up -d --wait --wait-timeout 180 >/dev/null 2>&1
  check "the stack comes up healthy on a clean machine" $?
  is "the archive folder belongs to the app's account, and nobody else can enter" "$(sudo stat -c '%u %a' $DATA)" "10001 700"
  has "an archive with no passphrase says so" "$(web $ORIGIN/api/status)" '"passphrase_set":false'
  is "and stays closed" "$(code $ORIGIN/api/documents)" 401
  printf '%s\n' "$SIGNIN" | XIN app python -m this_is_you set-passphrase >/dev/null; check "set-passphrase works through docker exec" $?
  has "status now reports it set" "$(web $ORIGIN/api/status)" '"passphrase_set":true'
}

posture() {
  echo "--- posture: what each container is allowed"
  for s in net app reader proxy; do
    n=this-is-you-$s-1
    is "$s: read-only root filesystem" "$(sudo docker inspect -f '{{.HostConfig.ReadonlyRootfs}}' $n)" true
    is "$s: every capability dropped" "$(sudo docker inspect -f '{{.HostConfig.CapDrop}}' $n)" "[ALL]"
    has "$s: no-new-privileges" "$(sudo docker inspect -f '{{.HostConfig.SecurityOpt}}' $n)" "no-new-privileges"
    is "$s: restarts after a crash or reboot" "$(sudo docker inspect -f '{{.HostConfig.RestartPolicy.Name}}' $n)" unless-stopped
    is "$s: not privileged" "$(sudo docker inspect -f '{{.HostConfig.Privileged}}' $n)" false
  done
  is "app runs as its own unprivileged account" "$(X app id -u)" 10001
  is "reader runs as a different unprivileged account" "$(X reader id -u)" 10002
  is "reader has no network" "$(sudo docker inspect -f '{{.HostConfig.NetworkMode}}' this-is-you-reader-1)" none
  mounts=$(sudo docker inspect -f '{{range .Mounts}}{{.Destination}} {{end}}' this-is-you-reader-1)
  is "reader's only mount is its socket" "$mounts" "/run/reader "
  is "the net service runs as nobody" "$(sudo docker inspect -f '{{.Config.User}}' this-is-you-net-1)" "65534:65534"
  is "app shares only the proxy's network" "$(sudo docker inspect -f '{{.HostConfig.NetworkMode}}' this-is-you-app-1 | cut -d: -f1)" container
  is "app publishes no ports of its own" "$(sudo docker inspect -f '{{json .HostConfig.PortBindings}}' this-is-you-app-1)" "{}"
  listening=$(sudo ss -ltnH | awk '{print $4}')
  hasnt "nothing listens on the host on the app's port" "$listening" ":8000"
  has "the test proxy is bound to loopback only" "$listening" "127.0.0.1:8443"
  hasnt "the test proxy is not on all interfaces" "$listening" "0.0.0.0:8443"
  ip=$(hostname -I | awk '{print $1}')
  timeout 3 bash -c "</dev/tcp/$ip/8443" 2>/dev/null; is "the machine's LAN address does not answer on the proxy port" "$?" 1
  timeout 3 bash -c "</dev/tcp/$ip/8000" 2>/dev/null; is "the machine's LAN address does not answer on the app port" "$?" 1
  is "no port is published in the production file" "$(sudo docker compose -f compose.yaml config 2>/dev/null </dev/null | grep -c 'published:')" 0
  has "Funnel is off in the serve configuration" "$(python3 -c "import json;print(json.load(open('deploy/tailscale-serve.json'))['AllowFunnel'])")" "False"
  has "the app reports the reader container passed its test" "$(X app python -m this_is_you doctor)" "PDF reader: in its own container, and it passed"
  is "the image holds no test or dev files" "$(X app sh -c 'ls /app; find / -xdev \( -name "*.sqlite3" -o -name "test_*.py" -path "*this_is_you*" \) 2>/dev/null | wc -l' | tr '\n' ' ')" "web 0 "
  is "the app cannot change its own code" "$(X app sh -c 'touch /usr/local/lib/python3.11/site-packages/this_is_you/x 2>/dev/null; echo $?')" 1
}

attacks() {
  echo "--- attacks: code in the reader container, as if a PDF had subverted it"
  cat > /tmp/hostile.py <<'PY'
import _socket, ctypes, errno, os, socket, sys
results = {}
def blocked(name, action):
    try:
        action()
        results[name] = "ALLOWED"
    except Exception as problem:
        results[name] = "blocked"
def connect(address):
    s = _socket.socket(_socket.AF_INET, _socket.SOCK_STREAM); s.settimeout(3); s.connect(address)
blocked("reach the internet", lambda: connect(("1.1.1.1", 53)))
blocked("reach the machine's gateway", lambda: connect(("172.17.0.1", 22)))
blocked("reach the app", lambda: connect(("127.0.0.1", 8000)))
blocked("resolve a name", lambda: socket.getaddrinfo("example.com", 443))
blocked("read the archive", lambda: open("/data/archive.sqlite3", "rb"))
blocked("list the archive", lambda: os.listdir("/data"))
blocked("read backups", lambda: os.listdir("/backups"))
blocked("write to its disk", lambda: open("/x", "w"))
blocked("write to /tmp", lambda: open("/tmp/x", "w"))
blocked("change its code", lambda: open("/usr/local/lib/python3.11/site-packages/this_is_you/x", "w"))
blocked("become root", lambda: os.setuid(0))
blocked("mount something", lambda: (lambda r: (_ for _ in ()).throw(OSError()) if r != 0 else None)(ctypes.CDLL(None).mount(b"none", b"/mnt", b"tmpfs", 0, None)))
blocked("create a user namespace", lambda: os.unshare(0x10000000) if hasattr(os, "unshare") else (lambda r: (_ for _ in ()).throw(OSError()) if r != 0 else None)(ctypes.CDLL(None).unshare(0x10000000)))
daemon = next((p for p in os.listdir("/proc") if p.isdigit() and b"reader_service" in open(f"/proc/{p}/cmdline", "rb").read() and int(p) != os.getpid()), None)
results["found the reader service"] = str(bool(daemon))
blocked("read the reader service's memory", lambda: open(f"/proc/{daemon}/mem", "rb").read(1))
blocked("attach to the reader service", lambda: (lambda r: (_ for _ in ()).throw(OSError()) if r != 0 else None)(ctypes.CDLL(None).ptrace(16, int(daemon), 0, 0)))
interfaces = [l.split(":")[0].strip() for l in open("/proc/net/dev").read().splitlines()[2:]]
results["network interfaces"] = ",".join(interfaces)
for k, v in results.items(): print(f"{k}={v}")
PY
  out=$(XIN reader python -I - < /tmp/hostile.py 2>&1)
  for name in "reach the internet" "reach the machine's gateway" "reach the app" "resolve a name" "read the archive" "list the archive" "read backups" "write to its disk" "write to /tmp" "change its code" "become root" "mount something" "create a user namespace" "read the reader service's memory" "attach to the reader service"; do
    has "reader cannot $name" "$out" "$name=blocked"
  done
  has "the attack really did see the reader service" "$out" "found the reader service=True"
  has "only loopback exists in the reader" "$out" "network interfaces=lo"

  echo "--- attacks: the worker's own limits, on real Linux"
  cat > /tmp/limits.py <<'PY'
import os, resource
from this_is_you.extraction.worker import apply_limits, forbid_network
apply_limits({"cpu_seconds": 5, "memory_bytes": 200 * 1024 * 1024})
forbid_network()
def attempt(action):
    try:
        action(); return "ALLOWED"
    except (OSError, MemoryError):
        return "blocked"
print("fork=" + attempt(os.fork))
print("write=" + attempt(lambda: open("/run/reader/limit-test", "wb", buffering=0).write(b"x")))
print("memory=" + attempt(lambda: bytearray(600 * 1024 * 1024)))
print("files=" + attempt(lambda: [os.open("/dev/null", 0) for _ in range(64)]), flush=True)
os._exit(0)
PY
  out=$(XIN reader python -I - < /tmp/limits.py 2>&1)
  has "a limited worker cannot start processes" "$out" "fork=blocked"
  has "a limited worker cannot write files" "$out" "write=blocked"
  has "a limited worker cannot take too much memory" "$out" "memory=blocked"
  has "a limited worker cannot open many files" "$out" "files=blocked"

  echo "--- attacks: a subverted worker takes the reader's socket"
  cat > /tmp/takeover.py <<'PY'
import os, socket
path = "/run/reader/reader.sock"
os.unlink(path)
s = socket.socket(socket.AF_UNIX); s.bind(path); s.listen(1)
s.close()  # Dies, as it must when its one reading ends, leaving a dead file behind.
print("replaced", flush=True)
PY
  has "the socket can be replaced from inside the reader" "$(XIN reader python -I - < /tmp/takeover.py 2>&1)" replaced
  sleep 8
  has "the reader rebuilds it" "$(X reader python -I -c "
import socket
s = socket.socket(socket.AF_UNIX); s.connect('/run/reader/reader.sock'); print('connected')")" connected

  echo "--- attacks: the file handed to the reader"
  cat > /tmp/receive.py <<'PY'
import os, socket
path = "/run/reader/test-receive.sock"
s = socket.socket(socket.AF_UNIX); s.bind(path); os.chmod(path, 0o660); s.listen(1)
c, _ = s.accept()
_, fds, _, _ = socket.recv_fds(c, 16, 1)
fd = fds[0]
def attempt(action):
    try:
        action(); return "ALLOWED"
    except OSError:
        return "blocked"
print("read=" + attempt(lambda: os.pread(fd, 4, 0)))
print("write=" + attempt(lambda: os.pwrite(fd, b"x", 0)))
print("truncate=" + attempt(lambda: os.ftruncate(fd, 0)))
print("reopen=" + attempt(lambda: open(f"/proc/self/fd/{fd}", "r+b")))
print("reopen_read=" + attempt(lambda: open(f"/proc/self/fd/{fd}", "rb")))
print("sibling=" + attempt(lambda: os.listdir(os.path.dirname(os.readlink(f"/proc/self/fd/{fd}")))))
os.unlink(path)
PY
  XIN reader python -I - < /tmp/receive.py > /tmp/received.out 2>&1 &
  sleep 3
  # A real file in the archive folder, so its path is a real one the reader might try to follow.
  X app python -I -c "
import socket,os
fd=os.open('/data/archive.sqlite3',os.O_RDONLY)
s=socket.socket(socket.AF_UNIX); s.connect('/run/reader/test-receive.sock')
socket.send_fds(s,[b'x'],[fd])
"
  wait; out=$(cat /tmp/received.out)
  has "the reader can read the file it was handed" "$out" "read=ALLOWED"
  has "it cannot write through it" "$out" "write=blocked"
  has "it cannot truncate it" "$out" "truncate=blocked"
  has "it cannot reopen it for writing" "$out" "reopen=blocked"
  has "it cannot look around the folder it came from" "$out" "sibling=blocked"
}

auth() {
  echo "--- auth: through the HTTPS proxy"
  is "the app loads with no session" "$(code $ORIGIN/)" 200
  headers=$(web -D - -o /dev/null $ORIGIN/)
  has "the app has a content policy" "$headers" "script-src 'self'"
  has "HTTPS is pinned" "$headers" "strict-transport-security"
  for path in documents identity backups import-batches observations backups/archive-health documents/00000000000000000000000000000000/content; do
    is "no session, no answer: $path" "$(code $ORIGIN/api/$path)" 401
  done
  is "a wrong passphrase is refused" "$(web -o /dev/null -w '%{http_code}' -H 'X-This-Is-You-Client: 1' -H "Origin: $ORIGIN" -H 'content-type: application/json' -d '{"passphrase":"fictional wrong passphrase"}' $ORIGIN/api/auth/login)" 401
  is "signing in without the app header is refused" "$(web -o /dev/null -w '%{http_code}' -H "Origin: $ORIGIN" -H 'content-type: application/json' -d "{\"passphrase\":\"$SIGNIN\"}" $ORIGIN/api/auth/login)" 403
  is "signing in from another origin is refused" "$(web -o /dev/null -w '%{http_code}' -H 'X-This-Is-You-Client: 1' -H 'Origin: https://evil.example' -H 'content-type: application/json' -d "{\"passphrase\":\"$SIGNIN\"}" $ORIGIN/api/auth/login)" 403
  is "the right passphrase signs in" "$(login)" 204
  has "the cookie is the host-only secure kind" "$(grep -c '__Host-tiy_session' $JAR; grep '__Host-tiy_session' $JAR | cut -f1,4)" "TRUE"
  is "the session opens the archive" "$(api -o /dev/null -w '%{http_code}' $ORIGIN/api/documents)" 200
  cookie=$(awk '/__Host-tiy_session/{print $7}' $JAR)
  is "another origin is refused with a valid session" "$(web -o /dev/null -w '%{http_code}' -b "__Host-tiy_session=$cookie" -H 'Origin: https://evil.example' $ORIGIN/api/documents)" 403
  is "a sibling site is refused with a valid session" "$(web -o /dev/null -w '%{http_code}' -b "__Host-tiy_session=$cookie" -H 'Sec-Fetch-Site: same-site' $ORIGIN/api/documents)" 403
  is "a change without the app header is refused with a valid session" "$(web -o /dev/null -w '%{http_code}' -b "__Host-tiy_session=$cookie" -X POST $ORIGIN/api/backups)" 403
  # The proxy answers names it does not serve by itself, so these two never reach the app. Below, the app is asked directly.
  hasnt "another host name gets no records through the proxy" "$(web -b "__Host-tiy_session=$cookie" -H 'Host: other.fictional.ts.net:8443' $ORIGIN/api/documents)" '"documents"'
  hasnt "a forged forwarded host gets no records through the proxy" "$(web -b "__Host-tiy_session=$cookie" -H 'Host: evil.example' -H "X-Forwarded-Host: $NAME:8443" $ORIGIN/api/documents)" '"documents"'
  direct=$(X app python -I -c "
import urllib.request as u, urllib.error as e
cookie = '__Host-tiy_session=$cookie'
for headers in ({'Host': 'other.fictional.ts.net:8443'}, {'Host': 'evil.example', 'X-Forwarded-Host': '$NAME:8443'}, {'Host': '$NAME'}, {'Host': '$NAME:8443'}):
    try:
        print(u.urlopen(u.Request('http://127.0.0.1:8000/api/documents', headers={**headers, 'Cookie': cookie}), timeout=5).status)
    except e.HTTPError as p:
        print(p.code)
")
  is "asked directly, the app answers only to its exact name" "$(echo $direct)" "403 403 403 200"
  is "the development cookie means nothing here" "$(web -o /dev/null -w '%{http_code}' -b "tiy_session=$cookie" $ORIGIN/api/documents)" 401
  is "plain HTTP to the proxy gets no archive" "$(curl -s --max-time 5 -o /dev/null -w '%{http_code}' --resolve $NAME:8443:127.0.0.1 http://$NAME:8443/api/documents)" 400
  inside=$(X app python -I -c "
import urllib.request as u, urllib.error as e
for path, host in (('/api/documents','127.0.0.1:8000'),('/','127.0.0.1:8000')):
    try:
        print(u.urlopen(u.Request('http://127.0.0.1:8000'+path, headers={'Host':host}), timeout=5).status)
    except e.HTTPError as p:
        print(p.code)
")
  is "going around the proxy from inside gets nothing" "$(echo $inside)" "403 403"
  sibling=$(sudo docker run --rm --network this-is-you_default --entrypoint python this-is-you:local -I -c "
import socket
s=socket.socket(); s.settimeout(3)
try:
    s.connect(('net',8000)); print('open')
except OSError: print('closed')
" </dev/null 2>&1)
  is "another container on the proxy's network cannot reach the app" "$sibling" closed
  mkdir -p /tmp/samples; for n in 1 2 3; do make_pdf /tmp/samples/$n.pdf "$n"; done
  is "uploading through the proxy works" "$(upload /tmp/samples/1.pdf 'fictional 1.pdf')" 201
  upload /tmp/samples/2.pdf 'fictional 2.pdf' >/dev/null; wait_read; check "the reader container reads them" $?
  has "they were really read, in the other container" "$(statuses)" "('extracted', 2)"
  id=$(api $ORIGIN/api/documents | python3 -c "import json,sys;print(json.load(sys.stdin)['documents'][0]['id'])")
  has "the original comes back to its session" "$(api $ORIGIN/api/documents/$id/content | head -c 8)" "%PDF"
  is "and not without one" "$(code $ORIGIN/api/documents/$id/content)" 401
  logs=$(C logs 2>&1)
  hasnt "the passphrase is not in any log" "$logs" "$SIGNIN"
  hasnt "filenames are not in any log" "$logs" "fictional 1.pdf"
  hasnt "contents are not in any log" "$logs" "Avery Testperson"
}

failsafe() {
  echo "--- failsafe: production without a working reader"
  login >/dev/null
  C stop reader >/dev/null 2>&1
  make_pdf /tmp/samples/w.pdf waiting
  is "with the reader stopped, files are still stored" "$(upload /tmp/samples/w.pdf 'fictional waiting.pdf')" 201
  sleep 4
  has "and wait, unread" "$(statuses)" "('pending', 1)"
  has "the service log says why, with no document details" "$(C logs --tail 20 app 2>&1)" "not answering"
  C start reader >/dev/null 2>&1
  wait_read; check "when the reader returns, it catches up with nothing lost" $?
  has "and that file was read" "$(statuses)" "('extracted', 3)"

  for bad in network archive; do
    cat > /tmp/bad-$bad.yaml <<E
services:
  reader:
    network_mode: bridge
E
    [ $bad = archive ] && cat > /tmp/bad-$bad.yaml <<E
services:
  reader:
    volumes:
      - reader-socket:/run/reader
      - $DATA:/data
    user: "0:0"
    cap_add: [DAC_OVERRIDE]
E
    sudo docker compose $FILES -f /tmp/bad-$bad.yaml up -d --force-recreate --wait --wait-timeout 180 </dev/null >/dev/null 2>&1
    sleep 5; login >/dev/null
    health=$(api $ORIGIN/api/backups/archive-health)
    has "a reader given the $bad is caught by its test, and reading stops" "$health" '"reader_isolation":"unavailable"'
    has "doctor says it is stopped ($bad)" "$(X app python -m this_is_you doctor)" "PDF reader: STOPPED"
    make_pdf /tmp/samples/$bad.pdf "$bad"
    upload /tmp/samples/$bad.pdf "fictional $bad.pdf" >/dev/null; sleep 4
    has "a new file stays unread ($bad)" "$(statuses)" "('pending', 1)"
    C up -d --force-recreate --wait --wait-timeout 180 >/dev/null 2>&1
    login >/dev/null
    wait_read; check "with the reader put right and restarted, it is read ($bad)" $?
  done
  has "the app is back to a passing test" "$(api $ORIGIN/api/backups/archive-health)" '"reader_isolation":"sandboxed"'
}

backups() {
  echo "--- backups: encrypted, on a separate filesystem"
  login >/dev/null; before=$(count)
  back_up() { api -o /dev/null -X POST $ORIGIN/api/backups; for _ in $(seq 1 90); do api $ORIGIN/api/backups | grep -q '"running":null' && break; sleep 1; done; api $ORIGIN/api/backups; }
  has "Back up now is off until there is a key" "$(api $ORIGIN/api/backups)" '"key_configured":false'
  has "and asks for one" "$(back_up)" "backup-key set"
  printf '%s\n' "$KEY" | XIN app python -m this_is_you backup-key set >/dev/null; check "setting the backup key works" $?
  stored=$(sudo sh -c "cat $DATA/backup-key.json")
  hasnt "the key file does not hold the passphrase" "$stored" "$KEY"
  has "and holds only public parts" "$stored" '"public"'
  has "the listing knows this is a separate drive" "$(api $ORIGIN/api/backups)" '"same_drive":false'
  out=$(back_up)
  has "Back up now succeeds" "$out" '"ok":true'
  has "and it is encrypted" "$out" '"state":"encrypted"'
  sealed=$(sudo ls $DRIVE | grep '\.tiyb$' | head -1)
  is "the backup drive holds only the sealed file, its check and its marker" "$(sudo ls -A $DRIVE | grep -v lost+found | grep -vc -E '\.tiyb$|\.tiyb\.check\.json$|^\.this-is-you-backups$')" 0
  sudo grep -q "SQLite format" $DRIVE/$sealed; is "nothing readable is in it" $? 1
  sudo grep -q "Fictional" $DRIVE/$sealed; is "no record text is in it" $? 1
  is "no plain copy stayed in the archive folder" "$(sudo ls $DATA | grep -c backup-staging)" 0
  r=$(printf 'fictional wrong passphrase\n' | XIN app python -m this_is_you verify /mnt/backups/backup-drive/$sealed 2>&1); has "the wrong passphrase cannot open it" "$r" "could not be opened"
  r=$(printf '%s\n' "$KEY" | XIN app python -m this_is_you verify /mnt/backups/backup-drive/$sealed 2>&1); has "the right one opens and verifies it" "$r" "Check passed"
  has "a folder that is not a prepared drive is refused" "$(X app python -m this_is_you backup --to /tmp/plain 2>&1)" "not connected"
  X app sh -c 'mkdir /tmp/plain && touch /tmp/plain/.this-is-you-backups'
  plain=$(X app python -m this_is_you backup --plain --to /tmp/plain 2>&1)
  has "a plain backup needs asking for, and says what it is" "$plain" "NOT encrypted"

  sudo cp $DRIVE/$sealed /var/tmp/sealed-copy.tiyb
  sudo umount $DRIVE
  sleep 1
  is "with the drive unplugged, the app sees an empty mount point" "$(X app sh -c 'ls -A /mnt/backups/backup-drive 2>/dev/null | wc -l')" 0
  has "Back up now refuses" "$(back_up)" "not connected"
  is "and nothing landed on the system disk" "$(sudo ls -A $DRIVE | wc -l)" 0
  is "the empty mount point cannot be written by the app" "$(X app sh -c 'touch /mnt/backups/backup-drive/x 2>/dev/null; echo $?')" 1
  has "the command line refuses too" "$(X app python -m this_is_you backup 2>&1)" "not connected"
  sudo mount -o loop /var/tmp/fictional-backup-drive.img $DRIVE
  sleep 1
  is "plugged back in, the app sees it with no restart" "$(X app sh -c 'test -e /mnt/backups/backup-drive/.this-is-you-backups; echo $?')" 0
  has "plugged back in, with no restart, it works again" "$(back_up)" '"ok":true'
  is "the app sees the older backups again too" "$(api $ORIGIN/api/backups | python3 -c "import json,sys;print(sum(1 for b in json.load(sys.stdin)['backups'] if b['state'] == 'encrypted'))")" "$(sudo ls $DRIVE | grep -c '\.tiyb$')"
  is "same document count after all that" "$(count)" "$before"
  sudo cp $DRIVE/$sealed /var/tmp/tampered.tiyb; sudo python3 -c "
b=bytearray(open('/var/tmp/tampered.tiyb','rb').read()); b[len(b)//2]^=1; open('/var/tmp/tampered.tiyb','wb').write(b)"
  sudo chown 10001 /var/tmp/tampered.tiyb; sudo mv /var/tmp/tampered.tiyb $DRIVE/this-is-you-backup-20200101T000000Z.tiyb
  r=$(printf '%s\n' "$KEY" | XIN app python -m this_is_you verify /mnt/backups/backup-drive/this-is-you-backup-20200101T000000Z.tiyb 2>&1); has "a changed byte is caught" "$r" "could not be opened"
  sudo rm $DRIVE/this-is-you-backup-20200101T000000Z.tiyb

  echo "--- disaster recovery: the archive folder is gone"
  ids=$(api $ORIGIN/api/documents | python3 -c "import json,sys;print(sorted((d['id'],d['sha256']) for d in json.load(sys.stdin)['documents']))")
  orig=$(sudo find $DATA/originals -type f -exec sha256sum {} + | awk '{print $1}' | sort | sha256sum)
  latest=$(sudo ls $DRIVE | grep '\.tiyb$' | sort | tail -1)
  C down >/dev/null 2>&1
  sudo mv $DATA $ROOT/data.lost
  sudo install -d -m 0700 -o 10001 -g 10001 $DATA
  sudo chown root:root /var/tmp/sealed-copy.tiyb
  C up -d net >/dev/null 2>&1 # The app shares its network, so it has to be running for a one-off command too.
  r=$(printf '%s\n' "$KEY" | sudo docker compose $FILES run --rm -T --no-deps app python -m this_is_you restore /mnt/backups/backup-drive/$latest --to /data/restored 2>&1)
  has "restoring from the drive works" "$r" "Restored to"
  sudo sh -c "mv $DATA/restored/* $DATA/restored/.[!.]* $DATA/ 2>/dev/null; rmdir $DATA/restored"
  C up -d --wait --wait-timeout 180 >/dev/null 2>&1; check "the stack starts on the restored archive" $?
  has "it stays closed until given a passphrase, as sign-in details are never backed up" "$(web $ORIGIN/api/status)" '"passphrase_set":false'
  printf '%s\n' "$SIGNIN" | XIN app python -m this_is_you set-passphrase >/dev/null
  printf '%s\n' "$KEY" | XIN app python -m this_is_you backup-key set >/dev/null
  login >/dev/null
  is "every document came back" "$(api $ORIGIN/api/documents | python3 -c "import json,sys;print(sorted((d['id'],d['sha256']) for d in json.load(sys.stdin)['documents']))")" "$ids"
  is "every original's bytes came back" "$(sudo find $DATA/originals -type f -exec sha256sum {} + | awk '{print $1}' | sort | sha256sum)" "$orig"
  is "relationships are intact" "$(X app python -I -c "import sqlite3;c=sqlite3.connect('/data/archive.sqlite3');print(c.execute('pragma foreign_key_check').fetchall(),c.execute('pragma integrity_check').fetchone()[0])")" "[] ok"
  sudo rm -rf $ROOT/data.lost /var/tmp/sealed-copy.tiyb
}

crashes() {
  echo "--- crashes: real kills of real processes"
  login >/dev/null; before=$(count)
  for s in app reader proxy net; do
    pid=$(sudo docker inspect -f '{{.State.Pid}}' this-is-you-$s-1)
    sudo kill -9 "$pid"
    sleep 3
    for _ in $(seq 1 60); do [ "$(sudo docker inspect -f '{{.State.Running}}' this-is-you-$s-1)" = true ] && break; sleep 2; done
    is "killing $s: it comes back by itself" "$(sudo docker inspect -f '{{.State.Running}}' this-is-you-$s-1)" true
    sleep 5
    # Nothing here is expected to need help, except after the one that holds the network.
    [ $s = net ] && sudo docker compose $FILES up -d --force-recreate --wait --wait-timeout 180 </dev/null >/dev/null 2>&1
    wait_healthy; check "killing $s: the app is healthy again" $?
    sleep 3
    is "killing $s: the session still works" "$(api -o /dev/null -w '%{http_code}' $ORIGIN/api/documents)" 200
    is "killing $s: no documents lost or added" "$(count)" "$before"
  done
  echo "--- crashes: kill the app in the middle of uploads"
  for n in 1 2 3 4 5 6 7 8; do make_pdf /tmp/samples/c$n.pdf "crash $n"; done
  (for n in 1 2 3 4 5 6 7 8; do upload /tmp/samples/c$n.pdf "fictional c$n.pdf" >/dev/null; done) &
  sleep 0.7; sudo kill -9 "$(sudo docker inspect -f '{{.State.Pid}}' this-is-you-app-1)"; wait
  sudo docker compose $FILES up -d --wait --wait-timeout 120 </dev/null >/dev/null 2>&1
  wait_healthy
  for n in 1 2 3 4 5 6 7 8; do upload /tmp/samples/c$n.pdf "fictional c$n.pdf" >/dev/null; done
  is "sending them all again gives exactly one of each" "$(count)" "$((before + 8))"
  is "the database is intact" "$(X app python -I -c "import sqlite3;c=sqlite3.connect('/data/archive.sqlite3');print(c.execute('pragma integrity_check').fetchone()[0])")" ok
  wait_read; check "every one gets read" $?
  is "a stopped stack stays stopped: no restart after docker compose stop" "$(C stop >/dev/null 2>&1; sleep 4; sudo docker inspect -f '{{.State.Running}}' this-is-you-app-1)" false
  C up -d --wait --wait-timeout 180 >/dev/null 2>&1
  has "two services on one archive are refused" "$(X app python -m this_is_you 2>&1 | head -3)" "already using this archive"
}

update() {
  echo "--- update: a new image, an older schema"
  login >/dev/null; before=$(api $ORIGIN/api/documents | sha256sum)
  C down >/dev/null 2>&1
  C up -d net >/dev/null 2>&1
  sudo docker compose $FILES run --rm -T --no-deps app python -I -c "
from pathlib import Path
from alembic import command
from this_is_you import db
from sqlalchemy import create_engine
engine = db.make_engine(Path('/data/archive.sqlite3'))
db.run_migration(engine, lambda config: command.downgrade(config, '0004'))
" </dev/null 2>&1 | tail -1 | cut -c1-100
  sudo sed -i 's/^TIY_VERSION=.*/TIY_VERSION=next/' .env
  sudo docker compose $FILES build --quiet </dev/null 2>&1 | tail -1
  C up -d --wait --wait-timeout 180 >/dev/null 2>&1; check "the new image starts and migrates the older schema" $?
  is "it really is the new image" "$(sudo docker inspect -f '{{.Config.Image}}' this-is-you-app-1)" this-is-you:next
  is "a copy of the old database was kept first" "$(sudo sh -c "ls $DATA | grep -c before-upgrade")" 1
  printf '%s\n' "$SIGNIN" | XIN app python -m this_is_you set-passphrase >/dev/null
  login >/dev/null
  is "every record is unchanged" "$(api $ORIGIN/api/documents | sha256sum)" "$before"
  sudo sed -i 's/^TIY_VERSION=.*/TIY_VERSION=local/' .env
  C up -d --wait --wait-timeout 180 >/dev/null 2>&1; check "going back to the previous image works when the schema has not changed" $?
}

isolation() {
  echo "--- isolation: an agent's account, and another hosted app"
  id agent >/dev/null 2>&1 || sudo useradd -m -s /bin/bash agent
  out=$(sudo -u agent bash deploy/check-isolation.sh $ROOT $DRIVE 2>&1); r=$?
  echo "$out" | sed 's/^/    /'
  is "an ordinary agent account passes the isolation check" "$r" 0
  sudo usermod -aG docker agent
  sudo -u agent bash deploy/check-isolation.sh $ROOT $DRIVE >/dev/null 2>&1; is "the check catches an agent added to the docker group" "$?" 1
  sudo gpasswd -d agent docker >/dev/null
  r=$(sudo -u agent sh -c "cat $DATA/archive.sqlite3 2>&1; ls $DRIVE 2>&1; cat $ROOT/secrets/* 2>&1" | head -3)
  has "the agent is really refused" "$r" "Permission denied"
  is "the agent cannot reach Docker's socket" "$(sudo -u agent curl -s --max-time 3 --unix-socket /var/run/docker.sock http://x/version >/dev/null 2>&1; echo $?)" 7
  cat > /tmp/other.py <<'PY'
import socket
def probe(host, port):
    s = socket.socket(); s.settimeout(3)
    try:
        s.connect((host, port)); return "open"
    except OSError:
        return "closed"
gateway = open("/proc/net/route").read().splitlines()[1].split()[2]
gateway = ".".join(str(int(gateway[i:i+2], 16)) for i in (6, 4, 2, 0))
print(probe(gateway, 8000), probe(gateway, 8443), probe("127.0.0.1", 8000))
PY
  sudo docker network create other-app >/dev/null 2>&1
  r=$(sudo docker run --rm -i --network other-app --entrypoint python this-is-you:local -I - < /tmp/other.py 2>&1)
  is "another hosted app's container cannot reach this one" "$r" "closed closed closed"
  r=$(sudo docker run --rm --network other-app --entrypoint sh this-is-you:local -c 'ls /data /backups 2>&1; ls /run/reader 2>&1' </dev/null | grep -c "No such file")
  is "and shares none of its storage" "$r" 3
  sudo docker network rm other-app >/dev/null 2>&1
}

tailscale_image() {
  echo "--- the real Tailscale image, hardened as in production, with a fake key and no tailnet"
  # This cannot show Tailscale working. It shows the container runs at all under these restrictions, and how a bad key fails.
  C down >/dev/null 2>&1
  sudo sh -c 'echo fictional-not-a-real-key > /srv/this-is-you/secrets/ts_authkey; chmod 444 /srv/this-is-you/secrets/ts_authkey'
  sudo sed -i 's#^TIY_AUTHKEY_FILE=.*#TIY_AUTHKEY_FILE=/srv/this-is-you/secrets/ts_authkey#' .env
  sudo docker compose -f compose.yaml up -d proxy </dev/null >/dev/null 2>&1
  sleep 15
  log=$(sudo docker compose -f compose.yaml logs proxy 2>&1 </dev/null)
  echo "$log" | tail -12 | cut -c1-150 | sed 's/^/    /'
  is "it runs as its own unprivileged account" "$(sudo docker inspect -f '{{.Config.User}}' this-is-you-proxy-1)" "10003:10003"
  hasnt "no permission problems with this hardening" "$log" "ermission denied"
  # Its one convenience symlink cannot be made, and it says so. The socket it needs is set in compose.yaml.
  hasnt "no other read-only filesystem problems" "$(echo "$log" | grep -v 'failed to symlink socket')" "ead-only file system"
  has "the daemon starts in userspace mode" "$log" "userspace"
  has "the key file is read, and a fake key is refused by Tailscale's own server" "$log" "invalid key"
  is "the state folder is private" "$(sudo stat -c '%u %a' $ROOT/tailscale)" "10003 700"
  is "it publishes nothing on the host" "$(sudo docker inspect -f '{{json .HostConfig.PortBindings}}' this-is-you-proxy-1)" "{}"
  sudo docker compose -f compose.yaml down </dev/null >/dev/null 2>&1
  sudo sed -i 's#^TIY_AUTHKEY_FILE=.*#TIY_AUTHKEY_FILE=/dev/null#' .env
  C up -d --wait --wait-timeout 180 >/dev/null 2>&1; check "the stand-in stack comes back afterwards" $?
}

timer() {
  echo "--- the daily backup timer, run once by hand"
  login >/dev/null
  sudo sed "s#^WorkingDirectory=.*#WorkingDirectory=$PWD#" deploy/this-is-you-backup.service | sudo tee /etc/systemd/system/this-is-you-backup.service >/dev/null
  sudo cp deploy/this-is-you-backup.timer /etc/systemd/system/
  sudo systemctl daemon-reload; sudo systemctl enable --now this-is-you-backup.timer >/dev/null 2>&1
  is "the timer is scheduled" "$(systemctl is-active this-is-you-backup.timer)" active
  before=$(sudo ls $DRIVE | grep -c '\.tiyb$')
  sudo systemctl start this-is-you-backup.service; is "the service succeeds" "$?" 0
  is "and one more encrypted backup is on the drive" "$(sudo ls $DRIVE | grep -c '\.tiyb$')" "$((before + 1))"
  sudo umount $DRIVE; sleep 1
  sudo systemctl start this-is-you-backup.service 2>/dev/null; is "with the drive unplugged, the service fails visibly" "$?" 1
  is "and nothing landed on the system disk" "$(sudo ls -A $DRIVE | wc -l)" 0
  sudo mount -o loop /var/tmp/fictional-backup-drive.img $DRIVE
  sudo systemctl disable --now this-is-you-backup.timer >/dev/null 2>&1
  login >/dev/null; check "signed in again, ready for a reboot" $?
}

after_reboot() {
  echo "--- after a real reboot of the machine"
  # The test drive is a loop mount with no fstab line, so this is also what an unplugged drive looks like at boot.
  for _ in $(seq 1 60); do [ "$(sudo docker inspect -f '{{.State.Health.Status}}' this-is-you-app-1 2>/dev/null)" = healthy ] && break; sleep 3; done
  is "the app came back by itself" "$(sudo docker inspect -f '{{.State.Health.Status}}' this-is-you-app-1)" healthy
  is "the reader came back by itself" "$(sudo docker inspect -f '{{.State.Health.Status}}' this-is-you-reader-1)" healthy
  is "the proxy came back by itself" "$(sudo docker inspect -f '{{.State.Running}}' this-is-you-proxy-1)" true
  is "and reaches the app, so they share a network again" "$(code $ORIGIN/)" 200
  has "the reader passed its test again" "$(X app python -m this_is_you doctor)" "in its own container, and it passed"
  is "the session survived" "$(api -o /dev/null -w '%{http_code}' $ORIGIN/api/documents)" 200
  is "nothing is left waiting to be read" "$(pending)" 0
  is "the database is intact" "$(X app python -I -c "import sqlite3;c=sqlite3.connect('/data/archive.sqlite3');print(c.execute('pragma integrity_check').fetchone()[0])")" ok
  has "Back up now knows the drive is missing" "$(api -o /dev/null -X POST $ORIGIN/api/backups; sleep 3; api $ORIGIN/api/backups)" "not connected"
}

"${1//-/_}"
echo "RESULT $1: $pass passed, $fail failed"
[ "$fail" = 0 ]
