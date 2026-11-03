"""Attacks on the service, the reader, and the archive's files. Every record here is fictional."""
from __future__ import annotations

import os
import re
import socket
import sqlite3
import stat
import subprocess
import sys
import time
from pathlib import Path

import pytest
from fastapi.testclient import TestClient
from starlette.websockets import WebSocketDisconnect

from this_is_you import auth, backup, backup_crypto
from this_is_you.backup import BackupProblem, apply_prune, create_backup, create_encrypted_backup, plan_prune, restore_sealed, verify_backup, verify_sealed
from this_is_you.config import Settings
from this_is_you.extraction import sandbox
from this_is_you.extraction.runner import Limits, extract, worker_command
from this_is_you.main import create_app
from this_is_you.models import AuthSession
from this_is_you.security import PUBLIC

from . import pdfs
from .conftest import CLIENT_HEADERS, client_for, make_pdf, upload

PASSPHRASE = "fictional correct horse battery"
PY = [sys.executable, "-m", "this_is_you"]


def anonymous(data_dir: Path) -> TestClient:
    return TestClient(create_app(Settings(data_dir=data_dir)), base_url="http://localhost", client=("127.0.0.1", 50000))


def login(client: TestClient, passphrase: str = PASSPHRASE, **headers):
    return client.post("/api/auth/login", json={"passphrase": passphrase}, headers={**CLIENT_HEADERS, **headers})


@pytest.fixture
def anon(data_dir: Path) -> TestClient:
    client = anonymous(data_dir)
    auth.set_passphrase(client.app.state.sessions, PASSPHRASE)
    return client


# ---- Nothing is open without a session

def _every_route(app) -> list[tuple[str, str]]:
    # The schema is how the framework itself lists what it serves, including routers it has wrapped.
    return [(method.upper(), re.sub(r"\{[^}]+\}", "0" * 32, path)) for path, methods in app.openapi()["paths"].items() for method in methods]


def test_every_route_but_the_listed_ones_needs_a_session(anon):
    routes = _every_route(anon.app)
    assert len(routes) > 25, "the route list should not have come back nearly empty"
    assert {("GET", "/api/documents/" + "0" * 32 + "/content"), ("GET", "/api/identity"), ("POST", "/api/backups"), ("GET", "/api/backups")} <= set(routes)
    for method, path in routes:
        if (method, path) not in PUBLIC:
            answer = anon.request(method, path, headers=CLIENT_HEADERS)
            assert answer.status_code == 401, (method, path, answer.status_code)
            assert answer.json()["code"] == "signed_out" and answer.headers["x-content-type-options"] == "nosniff"


def test_a_route_nobody_knows_about_is_refused_too(anon):
    assert anon.get("/api/not-a-route").status_code == 401
    assert anon.get("/anything-else").status_code == 401


def test_no_route_hides_from_the_list_above(anon):
    # A route left out of the schema would escape the test above, though not the middleware.
    source = "".join(p.read_text() for p in Path(sys.modules["this_is_you.main"].__file__).parent.rglob("*.py"))
    assert "include_in_schema=False" not in source


def test_only_two_requests_are_open(anon):
    assert PUBLIC == {("GET", "/api/status"), ("POST", "/api/auth/login")}
    assert set(anon.get("/api/status").json()) == {"status", "max_upload_bytes", "passphrase_set"}


def test_no_web_route_can_set_or_replace_a_passphrase(anon):
    paths = {path for _, path in _every_route(anon.app)}
    assert not [p for p in paths if "passphrase" in p or "setup" in p or "register" in p]


def test_an_archive_with_no_passphrase_stays_closed(data_dir):
    client = anonymous(data_dir)
    assert client.get("/api/status").json()["passphrase_set"] is False
    assert client.get("/api/documents").status_code == 401
    answer = login(client)
    assert answer.status_code == 409 and answer.json()["code"] == "setup_required"
    assert auth.COOKIE not in client.cookies


def test_websockets_cannot_get_past_the_checks(anon):
    with pytest.raises(WebSocketDisconnect):
        with anon.websocket_connect("/api/documents"):
            pass


# ---- Signing in

def test_signing_in_gives_a_private_cookie_and_opens_the_archive(anon):
    assert anon.get("/api/identity").status_code == 401
    answer = login(anon)
    assert answer.status_code == 204
    cookie = answer.headers["set-cookie"].lower()
    assert "httponly" in cookie and "samesite=strict" in cookie and "path=/" in cookie and "max-age=" in cookie
    assert anon.get("/api/identity").status_code == 200


def test_a_wrong_passphrase_opens_nothing_and_says_nothing_extra(anon):
    answer = login(anon, "fictional wrong passphrase")
    assert answer.status_code == 401 and answer.json()["code"] == "wrong_passphrase" and "set-cookie" not in answer.headers
    assert anon.get("/api/documents").status_code == 401


def test_guessing_gets_slower_and_a_guess_during_the_wait_is_not_even_tried(anon):
    for _ in range(5):
        assert login(anon, "fictional wrong passphrase").status_code == 401
    answer = login(anon)  # Right, but inside the wait.
    assert answer.status_code == 429 and answer.json()["code"] == "too_many_tries"
    assert auth.COOKIE not in anon.cookies


def test_a_correct_sign_in_clears_the_count(anon):
    for _ in range(4):
        login(anon, "fictional wrong passphrase")
    assert login(anon).status_code == 204
    for _ in range(4):
        assert login(anon, "fictional wrong passphrase").status_code == 401


def test_the_same_words_in_another_unicode_form_still_sign_in(data_dir):
    client = anonymous(data_dir)
    auth.set_passphrase(client.app.state.sessions, "café fictional passphrase")
    assert login(client, "café fictional passphrase").status_code == 204


@pytest.mark.parametrize("weak", ["short", "", "elevenchars"])
def test_short_passphrases_are_refused(data_dir, weak):
    with pytest.raises(auth.WeakPassphrase):
        auth.set_passphrase(anonymous(data_dir).app.state.sessions, weak)


def test_the_database_holds_no_passphrase_and_no_usable_token(anon, data_dir):
    login(anon)
    token = anon.cookies[auth.COOKIE]
    connection = sqlite3.connect(data_dir / "archive.sqlite3")
    dump = "\n".join(connection.iterdump())
    connection.close()
    assert PASSPHRASE not in dump and token not in dump
    assert len(dump) > 0


@pytest.mark.parametrize("path", ["/api/auth/logout", "/api/auth/logout-everywhere"])
def test_signing_out_ends_the_session_on_the_server(anon, path):
    login(anon)
    token = anon.cookies[auth.COOKIE]
    assert anon.post(path, headers=CLIENT_HEADERS).status_code == 204
    anon.cookies.set(auth.COOKIE, token)  # A copy of the old cookie is worth nothing now.
    assert anon.get("/api/documents").status_code == 401


def test_signing_out_everywhere_ends_other_devices_and_signing_out_does_not(anon):
    other = auth.create_session(anon.app.state.sessions)
    login(anon)
    anon.post("/api/auth/logout", headers=CLIENT_HEADERS)
    assert auth.session_is_valid(anon.app.state.sessions, other)
    login(anon)
    anon.post("/api/auth/logout-everywhere", headers=CLIENT_HEADERS)
    assert not auth.session_is_valid(anon.app.state.sessions, other)


def test_a_new_passphrase_signs_out_every_device(anon):
    token = auth.create_session(anon.app.state.sessions)
    auth.set_passphrase(anon.app.state.sessions, "another fictional passphrase")
    assert not auth.session_is_valid(anon.app.state.sessions, token)
    assert login(anon).status_code == 401


@pytest.mark.parametrize("field,age", [("last_seen_at", auth.IDLE_SECONDS + 5), ("created_at", auth.ABSOLUTE_SECONDS + 5)])
def test_sessions_end_after_idling_and_after_a_fixed_time(anon, field, age):
    sessions = anon.app.state.sessions
    token = auth.create_session(sessions)
    assert auth.session_is_valid(sessions, token)
    with sessions() as session:
        row = session.scalars(__import__("sqlalchemy").select(AuthSession)).one()
        setattr(row, field, int(time.time()) - age)
        session.commit()
    assert not auth.session_is_valid(sessions, token)
    assert auth.count_sessions(sessions) == 0


def test_a_session_survives_a_restart_so_an_import_can_carry_on(data_dir):
    client = client_for(data_dir)
    token = client.cookies[auth.COOKIE]
    again = anonymous(data_dir)
    again.cookies.set(auth.COOKIE, token)
    assert again.get("/api/documents").status_code == 200


@pytest.mark.parametrize("cookie", ["", "tiy_session=", "tiy_session=forged", "tiy_session=" + "a" * 5000, 'tiy_session="; x=1', "other=1", "\xff\xfe=broken"])
def test_forged_or_broken_cookies_are_just_signed_out(anon, cookie):
    answer = anon.get("/api/documents", headers={"cookie": cookie.encode("latin-1")})
    assert answer.status_code == 401


# ---- Other websites and other names

@pytest.mark.parametrize("origin", ["https://evil.example", "http://localhost.evil.example", "http://localhost:9999", "null", "http://127.0.0.1"])
def test_a_request_from_another_origin_is_refused_even_when_signed_in(client, origin):
    assert client.get("/api/documents", headers={"origin": origin}).status_code == 403
    assert client.post("/api/auth/logout", headers={**CLIENT_HEADERS, "origin": origin}).status_code == 403


def test_the_app_s_own_origin_is_accepted(client):
    assert client.get("/api/documents", headers={"origin": "http://localhost"}).status_code == 200
    assert client.get("/api/documents", headers={"host": "127.0.0.1:5180", "origin": "http://127.0.0.1:5180"}).status_code == 200


@pytest.mark.parametrize("site", ["cross-site", "same-site"])
def test_browsers_reporting_another_site_are_refused(client, site):
    assert client.get("/api/documents", headers={"sec-fetch-site": site}).status_code == 403


@pytest.mark.parametrize("site", ["same-origin", "none"])
def test_the_app_and_a_typed_address_are_accepted(client, site):
    assert client.get("/api/documents", headers={"sec-fetch-site": site}).status_code == 200


def test_signing_in_also_needs_the_app_header_and_origin(anon):
    assert anon.post("/api/auth/login", json={"passphrase": PASSPHRASE}).status_code == 403
    assert login(anon, origin="https://evil.example").status_code == 403
    assert login(anon, host="evil.example").status_code == 403
    assert auth.COOKIE not in anon.cookies


def test_forwarded_headers_do_not_change_who_a_client_is(data_dir):
    remote = TestClient(create_app(Settings(data_dir=data_dir)), base_url="http://localhost", client=("192.168.1.20", 50000))
    assert remote.get("/api/status", headers={"x-forwarded-for": "127.0.0.1", "forwarded": "for=127.0.0.1", "x-real-ip": "127.0.0.1"}).status_code == 403


def test_the_service_ignores_forwarded_headers():
    assert "proxy_headers=False" in Path(sys.modules["this_is_you.main"].__file__).with_name("__main__.py").read_text()


def test_another_app_s_odd_cookie_does_not_sign_anyone_out(client):
    token = client.cookies[auth.COOKIE]
    client.cookies.clear()
    answer = client.get("/api/documents", headers={"cookie": f'other={{"json":"value, with; odd"}}; broken; {auth.COOKIE}={token}; x=\\y'})
    assert answer.status_code == 200


def test_a_client_that_stops_reading_cannot_keep_the_service_from_stopping(data_dir):
    """A real process and a real socket: an answer far larger than the socket buffers, which nobody reads."""
    client = client_for(data_dir)
    big = make_pdf("Fictional large file").replace(b"%%EOF", b"%" + b"x" * (32 * 1024 * 1024) + b"\n%%EOF")
    document = upload(client, big, "large.pdf").json()["document"]["id"]
    client.app.state.extraction.wait_idle()
    client.app.state.engine.dispose()
    token = client.cookies[auth.COOKIE]
    with socket.socket() as probe:
        probe.bind(("127.0.0.1", 0))
        port = probe.getsockname()[1]
    env = {**os.environ, "THIS_IS_YOU_DATA_DIR": str(data_dir), "THIS_IS_YOU_PORT": str(port)}
    service = subprocess.Popen(PY, env=env, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    try:
        for _ in range(100):
            try:
                stalled = socket.create_connection(("127.0.0.1", port))
                break
            except OSError:
                time.sleep(0.2)
        stalled.sendall(f"GET /api/documents/{document}/content HTTP/1.1\r\nHost: 127.0.0.1\r\nCookie: {auth.COOKIE}={token}\r\n\r\n".encode())
        time.sleep(1.5)  # Never read. The service is now blocked writing the answer.
        service.terminate()
        assert service.wait(timeout=25) is not None
    finally:
        service.kill()
        stalled.close()


# ---- The PDF reader

needs_sandbox = pytest.mark.skipif(sandbox.isolation() != sandbox.FULL, reason="no operating-system sandbox on this machine")


def _hostile(code: str, stdin=subprocess.DEVNULL) -> subprocess.CompletedProcess:
    return subprocess.run(sandbox.wrap([sys.executable, "-I", "-c", code]), stdin=stdin, capture_output=True, text=True, env={}, timeout=60)


def test_the_reader_is_not_told_where_the_archive_is():
    command = worker_command(Limits(), __import__("datetime").date(2026, 1, 1))
    assert not [part for part in command if ".pdf" in part or "originals" in part or "archive" in part]


def test_a_reading_works_inside_the_sandbox(tmp_path):
    path = tmp_path / "a.pdf"
    path.write_bytes(pdfs.text_pdf(pdfs.LAB_REPORT))
    result = extract(path)
    assert result.status == "extracted" and result.lab_rows


def test_a_missing_file_is_a_failed_reading_not_a_crash(tmp_path):
    assert extract(tmp_path / "gone.pdf").status == "failed"


@needs_sandbox
def test_subverted_code_cannot_read_private_files(tmp_path):
    secret = tmp_path / "fictional-private.txt"
    secret.write_text("FICTIONAL SECRET")
    answer = _hostile(f"print(open({str(secret)!r}).read())")
    assert answer.returncode != 0 and "FICTIONAL SECRET" not in answer.stdout


@needs_sandbox
def test_subverted_code_cannot_read_the_home_folder_or_an_archive(data_dir, tmp_path):
    client = client_for(data_dir)
    upload(client, make_pdf("Fictional private original"), "a.pdf")
    client.app.state.extraction.wait_idle()
    original = next((data_dir / "originals").rglob("*.pdf"))
    for target in (original, data_dir / "archive.sqlite3"):
        assert _hostile(f"open({str(target)!r},'rb').read(1)").returncode != 0
    if (Path.home() / ".zshrc").exists():
        assert _hostile(f"open({str(Path.home() / '.zshrc')!r},'rb').read(1)").returncode != 0


@needs_sandbox
def test_subverted_code_cannot_use_the_network_even_past_python_s_socket_wrapper():
    code = "import _socket\ns=_socket.socket(_socket.AF_INET,_socket.SOCK_STREAM)\ns.settimeout(3)\ns.connect(('127.0.0.1',9))\nprint('CONNECTED')"
    answer = _hostile(code)
    assert "CONNECTED" not in answer.stdout and "refused" not in answer.stderr.lower()
    assert answer.returncode != 0


@needs_sandbox
def test_subverted_code_cannot_write_or_start_other_programs(tmp_path):
    target = tmp_path / "written.txt"
    assert _hostile(f"open({str(target)!r},'w').write('x')").returncode != 0
    assert not target.exists()
    assert _hostile("import os\nos.fork()").returncode != 0


@needs_sandbox
def test_only_the_document_it_was_handed_is_readable(tmp_path):
    path = tmp_path / "a.pdf"
    path.write_bytes(b"%PDF-fictional")
    with path.open("rb") as f:
        answer = _hostile("import sys\nprint(sys.stdin.buffer.read().decode())", stdin=f)
    assert answer.returncode == 0 and "%PDF-fictional" in answer.stdout


def test_the_linux_sandbox_gives_no_network_and_only_python_and_system_files():
    command = sandbox._linux(["python"], "/usr/bin/bwrap")
    assert "--unshare-all" in command and "--die-with-parent" in command and "--clearenv" in command
    assert "--bind" not in command, "nothing may be writable from inside"
    bound = {command[i + 1] for i, part in enumerate(command) if part in ("--ro-bind", "--ro-bind-try")}
    assert str(Path.home()) not in bound and not [b for b in bound if b.endswith("originals") or "ThisIsYou" in b]
    assert command[-2:] == ["--", "python"]


@pytest.mark.parametrize("broken", ["no tool", "tool fails"])
def test_with_no_working_sandbox_reading_still_works_and_it_says_so(tmp_path, monkeypatch, caplog, broken):
    monkeypatch.setattr(sandbox, "_wrap", (lambda command: None) if broken == "no tool" else (lambda command: ["/usr/bin/false"]))
    sandbox.isolation.cache_clear()
    try:
        assert sandbox.isolation() == sandbox.BASIC
        assert "no operating-system sandbox" in caplog.text
        path = tmp_path / "a.pdf"
        path.write_bytes(pdfs.text_pdf(pdfs.LAB_REPORT))
        assert extract(path).status == "extracted"
    finally:
        monkeypatch.undo()
        sandbox.isolation.cache_clear()


# ---- Files with no record

def _orphan(data_dir: Path, body: bytes) -> Path:
    digest = __import__("hashlib").sha256(body).hexdigest()
    path = data_dir / "originals" / digest[:2] / digest[2:4] / f"{digest}.pdf"
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(body)
    return path


def test_an_orphan_with_the_right_bytes_comes_back_and_gets_read(data_dir):
    client_for(data_dir)
    body = pdfs.text_pdf(pdfs.LAB_REPORT)
    path = _orphan(data_dir, body)
    client = client_for(data_dir)
    assert client.app.state.reconciled.recovered == 1
    documents = client.get("/api/documents").json()["documents"]
    assert len(documents) == 1 and documents[0]["original_filename"].startswith("Recovered file ")
    assert documents[0]["verification_status"] == "unverified"
    client.app.state.extraction.wait_idle()
    assert path.read_bytes() == body and stat.S_IMODE(path.stat().st_mode) == 0o400
    assert client.get(f"/api/documents/{documents[0]['id']}/content").content == body


def test_recovery_happens_once(data_dir):
    client_for(data_dir)
    _orphan(data_dir, make_pdf("Fictional once"))
    assert client_for(data_dir).app.state.reconciled.recovered == 1
    client = client_for(data_dir)
    assert client.app.state.reconciled.recovered == 0 and len(client.get("/api/documents").json()["documents"]) == 1


def test_a_retried_file_gives_a_recovered_document_its_name_back(data_dir):
    client_for(data_dir)
    body = make_pdf("Fictional named")
    _orphan(data_dir, body)
    client = client_for(data_dir)
    assert upload(client, body, "Fictional report.pdf").json()["duplicate"] is True
    documents = client.get("/api/documents").json()["documents"]
    assert [d["original_filename"] for d in documents] == ["Fictional report.pdf"]


def test_a_file_that_does_not_match_its_name_is_set_aside_not_deleted(data_dir):
    client_for(data_dir)
    path = _orphan(data_dir, make_pdf("Fictional damaged"))
    path.write_bytes(make_pdf("Fictional other bytes"))
    stray = data_dir / "originals" / "notes.txt"
    stray.write_text("fictional stray")
    client = client_for(data_dir)
    assert (client.app.state.reconciled.recovered, client.app.state.reconciled.set_aside) == (0, 2)
    assert client.get("/api/documents").json()["documents"] == []
    aside = data_dir / "set-aside"
    assert (aside / "notes.txt").read_text() == "fictional stray" and (aside / path.name).exists()
    assert stat.S_IMODE(aside.stat().st_mode) == 0o700


def test_a_link_planted_in_the_originals_is_moved_not_followed(data_dir, tmp_path):
    client_for(data_dir)
    outside = tmp_path / "outside.pdf"
    outside.write_bytes(make_pdf("Fictional outside"))
    (data_dir / "originals" / "link.pdf").symlink_to(outside)
    client = client_for(data_dir)
    assert client.app.state.reconciled.set_aside == 1 and client.get("/api/documents").json()["documents"] == []
    assert outside.exists() and (data_dir / "set-aside" / "link.pdf").is_symlink()


def test_a_missing_original_is_counted_and_nothing_else_changes(data_dir):
    client = client_for(data_dir)
    upload(client, make_pdf("Fictional will go missing"), "a.pdf")
    client.app.state.extraction.wait_idle()
    path = next((data_dir / "originals").rglob("*.pdf"))
    path.chmod(0o600)
    path.unlink()
    again = client_for(data_dir)
    assert again.app.state.reconciled.missing == 1 and len(again.get("/api/documents").json()["documents"]) == 1


def test_the_health_of_the_archive_needs_a_session_and_reports_counts(client):
    answer = client.get("/api/backups/archive-health").json()
    assert set(answer) == {"recovered", "set_aside", "missing", "reader_isolation"}


# ---- Leftovers and old copies

def test_old_pre_upgrade_copies_are_cleared_and_the_newest_stay(data_dir):
    client_for(data_dir)
    names = [f"archive.sqlite3.before-upgrade-2026010{n}T000000" for n in range(1, 5)]
    for name in names:
        (data_dir / name).write_text("fictional")
    client_for(data_dir)
    assert sorted(p.name for p in data_dir.glob("*.before-upgrade-*")) == names[-2:]


def test_plain_copies_left_by_a_crash_are_cleared_at_start(data_dir):
    client_for(data_dir)
    staging = data_dir / "backup-staging" / "x"
    staging.mkdir(parents=True)
    (staging / "archive.sqlite3").write_text("fictional")
    (staging / "archive.sqlite3").chmod(0o400)
    test_dir = data_dir.with_name(data_dir.name + " Backups") / ".restore-test-abc"
    test_dir.mkdir(parents=True)
    client_for(data_dir)
    assert not (data_dir / "backup-staging").exists() and not test_dir.exists()


def _settings(data_dir: Path) -> Settings:
    return Settings(data_dir=data_dir)


def _backups(settings: Settings, count: int) -> list[Path]:
    made = []
    for n in range(count):
        folder = settings.backups_dir / f"this-is-you-backup-2026010{n + 1}T000000Z"
        folder.mkdir(parents=True)
        (folder / "manifest.json").write_text("{}")
        made.append(folder)
    return made


def test_prune_lists_first_and_removes_only_what_it_listed(data_dir):
    client_for(data_dir)
    settings = _settings(data_dir)
    made = _backups(settings, 5)
    unfinished = settings.backups_dir / "this-is-you-backup-20260109T000000Z.incomplete"
    unfinished.mkdir()
    bystander = settings.backups_dir / "my own notes"
    bystander.mkdir()
    plan = plan_prune(settings, keep=3, include_replaced=False)
    assert {p.path for p in plan} == {made[0], made[1], unfinished}
    assert all(p.path.exists() for p in plan)
    apply_prune(plan)
    assert not unfinished.exists() and not made[0].exists() and made[4].exists() and bystander.exists()


def test_prune_always_keeps_the_newest_backup_that_passed_a_check(data_dir):
    client_for(data_dir)
    settings = _settings(data_dir)
    made = _backups(settings, 3)
    (made[0] / "last-check.json").write_text('{"ok": true, "checked_at": "2026-01-01T00:00:00Z", "problems": []}')
    (made[2] / "last-check.json").write_text('{"ok": false, "checked_at": "2026-01-03T00:00:00Z", "problems": ["x"]}')
    assert {p.path for p in plan_prune(settings, keep=1, include_replaced=False)} == {made[1]}


def test_prune_leaves_replaced_archives_unless_asked(data_dir):
    client_for(data_dir)
    replaced = data_dir.with_name(data_dir.name + ".replaced-20260101T000000Z")
    replaced.mkdir()
    settings = _settings(data_dir)
    assert not plan_prune(settings, keep=3, include_replaced=False)
    assert {p.path for p in plan_prune(settings, keep=3, include_replaced=True)} == {replaced}


def test_a_drive_that_is_not_connected_does_not_become_a_folder_here(data_dir, tmp_path):
    missing = tmp_path / "Volumes" / "Fictional Drive" / "Backups"
    client = client_for(data_dir, backups_dir_override=missing)
    assert client.post("/api/backups", headers=CLIENT_HEADERS).status_code == 202
    client.app.state.backups.wait()
    assert not missing.parent.exists()
    last = client.get("/api/backups").json()["last_result"]
    assert last["ok"] is False and "connected" in last["problems"][0]


def test_the_listing_says_when_backups_share_the_archive_s_drive_and_hides_the_account_name(client, monkeypatch):
    answer = client.get("/api/backups").json()
    assert answer["same_drive"] is True
    monkeypatch.setattr(Path, "home", lambda: client.app.state.settings.data_dir.parent)
    assert client.get("/api/backups").json()["location"].startswith("~/")


# ---- What backups hold

def test_backups_hold_no_sign_in_details(anon, data_dir, tmp_path):
    login(anon)
    sessions = anon.app.state.sessions
    with sessions() as session:
        from this_is_you.models import AuthCredential

        salt = session.get(AuthCredential, 1).salt
    result = create_backup(data_dir / "archive.sqlite3", data_dir / "originals", tmp_path / "out")
    copy = sqlite3.connect(result.path / "archive.sqlite3")
    assert copy.execute("SELECT COUNT(*) FROM auth_credential").fetchone()[0] == 0
    assert copy.execute("SELECT COUNT(*) FROM auth_sessions").fetchone()[0] == 0
    copy.close()
    raw = (result.path / "archive.sqlite3").read_bytes()
    assert salt.encode() not in raw
    assert verify_backup(result.path).ok
    with sessions() as session:
        assert session.get(AuthCredential, 1) is not None  # The live archive keeps them.


def test_removing_a_report_deletes_its_paths_and_leaves_the_documents(client, data_dir):
    batch = client.post("/api/import-batches", json={"label": "Fictional Clinic Folder"}, headers=CLIENT_HEADERS).json()["id"]
    items = client.post(f"/api/import-batches/{batch}/items", json={"items": [{"path": "Fictional Clinic Folder/private-name/a.pdf", "size": 10, "modified": 1}]}, headers=CLIENT_HEADERS).json()["items"]
    client.post(f"/api/import-batches/{batch}/items/{items[0]['id']}/file", content=make_pdf("Fictional report"), headers={**CLIENT_HEADERS, "content-type": "application/pdf"})
    client.app.state.extraction.wait_idle()
    assert client.delete(f"/api/import-batches/{batch}", headers=CLIENT_HEADERS).status_code == 204
    assert client.get("/api/import-batches").json()["batches"] == []
    assert len(client.get("/api/documents").json()["documents"]) == 1
    connection = sqlite3.connect(data_dir / "archive.sqlite3")
    connection.execute("PRAGMA wal_checkpoint(TRUNCATE)")
    connection.close()
    assert b"private-name" not in (data_dir / "archive.sqlite3").read_bytes()


# ---- Encrypted backups

KEY = "fictional backup passphrase"


@pytest.fixture
def fast_kdf(monkeypatch):
    monkeypatch.setattr(backup_crypto, "_LOG2_N", 12)


@pytest.fixture
def archive(data_dir):
    client = client_for(data_dir)
    upload(client, make_pdf("Fictional sealed original"), "sealed.pdf")
    client.app.state.extraction.wait_idle()
    return client


def _seal(data_dir: Path, tmp_path: Path) -> Path:
    return create_encrypted_backup(Settings(data_dir=data_dir), tmp_path / "drive", KEY).path


def test_a_sealed_backup_hides_everything_and_restores_whole(archive, data_dir, tmp_path, fast_kdf):
    original = next((data_dir / "originals").rglob("*.pdf"))
    sealed = _seal(data_dir, tmp_path)
    raw = sealed.read_bytes()
    assert raw.startswith(backup_crypto.MAGIC) and sealed.name.endswith(".tiyb") and stat.S_IMODE(sealed.stat().st_mode) == 0o600
    for visible in (b"Fictional sealed original", b"sealed.pdf", b"SQLite format", b"manifest.json", original.name.encode()):
        assert visible not in raw
    assert verify_sealed(sealed, tmp_path / "staging", KEY).ok
    assert not (tmp_path / "staging").exists()
    restore_sealed(sealed, tmp_path / "restored", KEY)
    copy = next((tmp_path / "restored" / "originals").rglob("*.pdf"))
    assert copy.read_bytes() == original.read_bytes()
    connection = sqlite3.connect(tmp_path / "restored" / "archive.sqlite3")
    assert connection.execute("SELECT original_filename FROM documents").fetchone()[0] == "sealed.pdf"
    connection.close()
    assert not list(tmp_path.glob(".restored.restoring*"))


def test_no_plain_copy_touches_the_destination_or_outlives_the_run(archive, data_dir, tmp_path, fast_kdf, monkeypatch):
    seen: list[list[str]] = []
    real = backup_crypto.seal_folder

    def spy(folder, target, passphrase):
        seen.append([p.name for p in target.parent.iterdir()])
        real(folder, target, passphrase)

    monkeypatch.setattr(backup, "seal_folder", spy)
    sealed = _seal(data_dir, tmp_path)
    assert seen == [[]] and [p.name for p in sealed.parent.iterdir()] == [sealed.name]
    assert not (data_dir / "backup-staging").exists()


def test_a_crash_while_sealing_leaves_no_usable_or_plain_file(archive, data_dir, tmp_path, fast_kdf, monkeypatch):
    def fail(folder, target, passphrase):
        target.write_bytes(b"partial")
        raise OSError(28, "No space left on device")

    monkeypatch.setattr(backup, "seal_folder", fail)
    with pytest.raises(OSError):
        _seal(data_dir, tmp_path)
    assert list((tmp_path / "drive").iterdir()) == [] and not (data_dir / "backup-staging").exists()


def test_a_wrong_passphrase_opens_nothing(archive, data_dir, tmp_path, fast_kdf):
    sealed = _seal(data_dir, tmp_path)
    check = verify_sealed(sealed, tmp_path / "staging", "fictional wrong passphrase")
    assert not check.ok and "could not be opened" in check.problems[0]
    with pytest.raises(BackupProblem):
        restore_sealed(sealed, tmp_path / "restored", "fictional wrong passphrase")
    assert not (tmp_path / "restored").exists() and not list(tmp_path.glob(".restored*"))


def _flip(raw: bytes, at: int) -> bytes:
    return raw[:at] + bytes([raw[at] ^ 1]) + raw[at + 1:]


TAMPER = {
    "magic": lambda raw: _flip(raw, 0),
    "header": lambda raw: _flip(raw, len(backup_crypto.MAGIC) + 18),
    "first chunk": lambda raw: _flip(raw, len(backup_crypto.MAGIC) + backup_crypto._HEADER.size + 40),
    "last byte": lambda raw: _flip(raw, len(raw) - 1),
    "cut short": lambda raw: raw[: len(raw) // 2],
    "last chunk removed": lambda raw: raw[:-20],
    "bytes added": lambda raw: raw + b"extra",
    "emptied": lambda raw: b"",
}


@pytest.mark.parametrize("name", TAMPER)
def test_any_change_to_a_sealed_backup_stops_it_and_restores_nothing(archive, data_dir, tmp_path, fast_kdf, name):
    sealed = _seal(data_dir, tmp_path)
    raw = sealed.read_bytes()
    sealed.chmod(0o600)
    sealed.write_bytes(TAMPER[name](raw))
    with pytest.raises(BackupProblem):
        restore_sealed(sealed, tmp_path / "restored", KEY)
    assert not (tmp_path / "restored").exists() and not list(tmp_path.glob(".restored*"))


def test_chunks_cannot_be_reordered(tmp_path, fast_kdf):
    folder = tmp_path / "plain"
    folder.mkdir()
    (folder / "big.bin").write_bytes(os.urandom(3 * backup_crypto._CHUNK))
    sealed = tmp_path / "s.tiyb"
    backup_crypto.seal_folder(folder, sealed, KEY)
    raw = sealed.read_bytes()
    start = len(backup_crypto.MAGIC) + backup_crypto._HEADER.size
    length = int.from_bytes(raw[start:start + 4], "big") + 4
    swapped = raw[:start] + raw[start + length:start + 2 * length] + raw[start:start + length] + raw[start + 2 * length:]
    sealed.write_bytes(swapped)
    with pytest.raises(backup_crypto.CannotOpen):
        backup_crypto.open_into(sealed, tmp_path / "out", KEY)


def test_a_header_cannot_demand_unlimited_memory(tmp_path):
    sealed = tmp_path / "s.tiyb"
    sealed.write_bytes(backup_crypto.MAGIC + backup_crypto._HEADER.pack(b"s" * 16, 40, 8, 1, b"p" * 7, 1024))
    with pytest.raises(backup_crypto.CannotOpen):
        backup_crypto.open_into(sealed, tmp_path / "out", KEY)


def test_an_interrupted_sealed_backup_is_listed_as_not_finished(client, data_dir):
    root = data_dir.with_name(data_dir.name + " Backups")
    root.mkdir()
    (root / "this-is-you-backup-20260101T000000Z.tiyb.incomplete").write_bytes(b"partial")
    (root / "this-is-you-backup-20260102T000000Z.tiyb").write_bytes(b"sealed")
    states = {b["name"]: b["state"] for b in client.get("/api/backups").json()["backups"]}
    assert states == {"this-is-you-backup-20260102T000000Z.tiyb": "encrypted", "this-is-you-backup-20260101T000000Z.tiyb.incomplete": "incomplete"}


# ---- The command line

def _cli(data_dir: Path, *args: str, stdin: str = "") -> subprocess.CompletedProcess:
    env = {**os.environ, "THIS_IS_YOU_DATA_DIR": str(data_dir)}
    return subprocess.run([*PY, *args], input=stdin, capture_output=True, text=True, env=env, timeout=120)


def test_the_command_line_sets_a_passphrase_that_then_works(data_dir):
    answer = _cli(data_dir, "set-passphrase", stdin=PASSPHRASE + "\n")
    assert answer.returncode == 0 and PASSPHRASE not in answer.stdout + answer.stderr
    client = anonymous(data_dir)
    assert login(client).status_code == 204


def test_the_command_line_refuses_a_short_passphrase(data_dir):
    answer = _cli(data_dir, "set-passphrase", stdin="short\n")
    assert answer.returncode != 0 and "Nothing was changed" in answer.stderr


def test_the_command_line_seals_checks_and_restores(archive, data_dir, tmp_path):
    drive = tmp_path / "drive"
    drive.mkdir()
    answer = _cli(data_dir, "backup", "--encrypt", "--to", str(drive), stdin=KEY + "\n")
    assert answer.returncode == 0, answer.stderr
    sealed = next(drive.iterdir())
    assert _cli(data_dir, "verify", str(sealed), stdin=KEY + "\n").returncode == 0
    wrong = _cli(data_dir, "verify", str(sealed), stdin="fictional wrong passphrase\n")
    assert wrong.returncode != 0 and "could not be opened" in wrong.stdout
    restored = tmp_path / "restored"
    assert _cli(data_dir, "restore", str(sealed), "--to", str(restored), stdin=KEY + "\n").returncode == 0
    assert (restored / "archive.sqlite3").exists()


def test_the_command_line_will_not_write_to_a_drive_that_is_not_connected(data_dir, tmp_path):
    client_for(data_dir)
    missing = tmp_path / "Fictional Drive" / "Backups"
    answer = _cli(data_dir, "backup", "--to", str(missing))
    assert answer.returncode != 0 and "connected" in answer.stderr and not missing.parent.exists()


def test_the_command_line_prunes_only_with_yes(data_dir):
    client_for(data_dir)
    made = _backups(_settings(data_dir), 2)
    assert "Nothing was removed" in _cli(data_dir, "prune", "--keep", "1").stdout
    assert made[0].exists()
    assert _cli(data_dir, "prune", "--keep", "1", "--yes").returncode == 0
    assert not made[0].exists() and made[1].exists()


def test_doctor_reports_without_changing_anything_or_showing_secrets(anon, data_dir):
    answer = _cli(data_dir, "doctor")
    assert answer.returncode == 0 and "Passphrase: set" in answer.stdout and "SAME DRIVE" in answer.stdout
    assert PASSPHRASE not in answer.stdout


def test_sign_out_everywhere_from_the_command_line(anon, data_dir):
    token = auth.create_session(anon.app.state.sessions)
    assert _cli(data_dir, "sign-out-everywhere").returncode == 0
    assert not auth.session_is_valid(anon.app.state.sessions, token)
