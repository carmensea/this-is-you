from __future__ import annotations

from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from this_is_you.config import Settings, UnsafeConfiguration, is_loopback_host, load_settings, validate
from this_is_you.main import create_app

from .conftest import CLIENT_HEADERS, make_pdf, upload


@pytest.mark.parametrize("client_ip", ["192.168.1.20", "10.0.0.5", "8.8.8.8", "testclient"])
def test_refuses_connections_from_other_machines(data_dir, client_ip):
    app = create_app(Settings(data_dir=data_dir))
    remote = TestClient(app, base_url="http://localhost", client=(client_ip, 50000))
    assert remote.get("/api/documents").status_code == 403
    assert remote.post("/api/documents", content=make_pdf(), headers=CLIENT_HEADERS).status_code == 403


@pytest.mark.parametrize("client_ip", ["127.0.0.1", "::1", "::ffff:127.0.0.1"])
def test_accepts_loopback(data_dir, client_ip):
    app = create_app(Settings(data_dir=data_dir))
    assert TestClient(app, base_url="http://localhost", client=(client_ip, 50000)).get("/api/documents").status_code == 200


@pytest.mark.parametrize("host", ["evil.example", "evil.example:8000", "192.168.1.20", "localhost.evil.example"])
def test_refuses_other_host_headers(client, host):
    assert client.get("/api/documents", headers={"host": host}).status_code == 403


@pytest.mark.parametrize("host", ["localhost:5173", "127.0.0.1:8000", "[::1]:8000"])
def test_accepts_local_host_headers(client, host):
    assert client.get("/api/documents", headers={"host": host}).status_code == 200


def test_upload_without_the_app_header_is_refused(client, data_dir):
    response = client.post("/api/documents", content=make_pdf(), headers={"content-type": "application/pdf", "x-original-filename": "a.pdf"})
    assert response.status_code == 403
    assert client.get("/api/documents").json()["documents"] == []


def test_cross_site_requests_are_refused(client):
    doc = upload(client, make_pdf()).json()["document"]
    assert client.get(doc["content_url"], headers={"sec-fetch-site": "cross-site"}).status_code == 403
    assert client.get(doc["content_url"], headers={"sec-fetch-site": "same-origin"}).status_code == 200


def test_no_cors_approval_is_ever_given(client):
    response = client.options("/api/documents", headers={"origin": "https://evil.example", "access-control-request-method": "POST", "access-control-request-headers": "x-this-is-you-client"})
    assert "access-control-allow-origin" not in response.headers


@pytest.mark.parametrize("path", ["/docs", "/redoc", "/openapi.json"])
def test_docs_pages_that_load_external_scripts_are_off(client, path):
    assert client.get(path).status_code == 404


@pytest.mark.parametrize("host,ok", [("127.0.0.1", True), ("localhost", True), ("::1", True), ("0.0.0.0", False), ("192.168.1.2", False), ("::", False), ("example.com", False)])
def test_loopback_detection(host, ok):
    assert is_loopback_host(host) is ok


def test_will_not_start_on_a_network_address(tmp_path):
    with pytest.raises(UnsafeConfiguration):
        load_settings({"THIS_IS_YOU_DATA_DIR": str(tmp_path), "THIS_IS_YOU_HOST": "0.0.0.0"})


def test_will_not_store_documents_in_a_git_repository(tmp_path):
    (tmp_path / ".git").mkdir()
    with pytest.raises(UnsafeConfiguration):
        validate(Settings(data_dir=tmp_path / "deep" / "archive"))
    with pytest.raises(UnsafeConfiguration):
        create_app(Settings(data_dir=tmp_path / "archive"))
    assert not (tmp_path / "archive").exists()


def test_default_data_dir_is_outside_this_repository():
    settings = load_settings({})
    repo = Path(__file__).resolve().parents[2]
    assert not settings.data_dir.is_relative_to(repo)
    assert settings.host == "127.0.0.1"
