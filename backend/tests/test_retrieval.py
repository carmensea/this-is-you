from __future__ import annotations

from urllib.parse import quote

import pytest
from sqlalchemy import update

from this_is_you.models import Document

from .conftest import client_for, make_pdf, upload


def test_returns_the_original_bytes_as_an_inline_pdf(client):
    body = make_pdf()
    doc = upload(client, body, quote('résumé "final".pdf')).json()["document"]
    response = client.get(doc["content_url"])
    assert response.status_code == 200
    assert response.content == body
    assert response.headers["content-type"] == "application/pdf"
    assert response.headers["content-disposition"].startswith("inline; filename*=UTF-8''r%C3%A9sum%C3%A9")
    assert response.headers["x-content-type-options"] == "nosniff"
    assert response.headers["cache-control"] == "no-store"
    assert "frame-ancestors 'self'" in response.headers["content-security-policy"]
    assert response.headers["cross-origin-resource-policy"] == "same-origin"


def test_download_is_an_attachment(client):
    doc = upload(client, make_pdf()).json()["document"]
    assert client.get(doc["content_url"], params={"download": "true"}).headers["content-disposition"].startswith("attachment;")


def test_range_requests_work_for_the_pdf_viewer(client):
    body = make_pdf()
    doc = upload(client, body).json()["document"]
    response = client.get(doc["content_url"], headers={"range": "bytes=0-7"})
    assert response.status_code == 206
    assert response.content == body[:8]


@pytest.mark.parametrize(
    "path",
    [
        "/api/documents/..%2F..%2F..%2Fetc%2Fpasswd/content",
        "/api/documents/../../etc/passwd",
        "/api/documents/%2e%2e%2farchive.sqlite3/content",
        "/api/documents/notahexid/content",
        "/api/documents/" + "a" * 31 + "/content",
    ],
)
def test_path_traversal_ids_are_refused(client, path):
    response = client.get(path)
    assert response.status_code in (404, 422)
    assert b"root:" not in response.content and b"SQLite" not in response.content


def test_unknown_document_is_404(client):
    assert client.get("/api/documents/" + "a" * 32 + "/content").json()["code"] == "not_found"
    assert client.get("/api/documents/" + "a" * 32).status_code == 404


@pytest.mark.parametrize("key", ["../../archive.sqlite3", "/etc/passwd", "aa/bb/../../../archive.sqlite3", "aa/bb/" + "c" * 64 + ".pdf"])
def test_a_tampered_storage_key_cannot_escape(client, key):
    doc = upload(client, make_pdf()).json()["document"]
    with client.app.state.engine.begin() as connection:
        connection.execute(update(Document).values(storage_key=key))
    with pytest.raises(ValueError):
        client.get(doc["content_url"])


def test_responses_do_not_reveal_storage_paths(client, data_dir):
    upload(client, make_pdf())
    listing = client.get("/api/documents").text
    assert "storage_key" not in listing and str(data_dir) not in listing


def test_listing_is_newest_first(client):
    with_ids = [upload(client, make_pdf(str(i))).json()["document"] for i in range(3)]
    with client.app.state.engine.begin() as connection:
        for i, doc in enumerate(with_ids):
            connection.execute(update(Document).where(Document.id == doc["id"]).values(imported_at=f"2026-01-0{i + 1}T00:00:00Z"))
    assert [d["id"] for d in client.get("/api/documents").json()["documents"]] == [d["id"] for d in reversed(with_ids)]


def test_documents_survive_a_restart(data_dir):
    body = make_pdf()
    first = client_for(data_dir)
    doc = upload(first, body, "kept.pdf").json()["document"]
    first.app.state.engine.dispose()

    second = client_for(data_dir)
    assert second.get("/api/documents").json()["documents"] == [doc]
    assert second.get(doc["content_url"]).content == body
    again = upload(second, body, "kept again.pdf")
    assert again.status_code == 200 and again.json()["duplicate"] is True


def test_restart_clears_partial_uploads_but_not_originals(data_dir):
    first = client_for(data_dir)
    doc = upload(first, make_pdf()).json()["document"]
    (data_dir / "incoming" / "crashed.part").write_bytes(b"partial")
    second = client_for(data_dir)
    assert list((data_dir / "incoming").iterdir()) == []
    assert second.get(doc["content_url"]).status_code == 200
