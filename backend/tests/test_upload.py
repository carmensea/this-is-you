from __future__ import annotations

import hashlib
import logging
import stat
from concurrent.futures import ThreadPoolExecutor
from urllib.parse import quote

import pytest

from .conftest import client_for, make_pdf, upload


def files_under(path):
    return sorted(p for p in path.rglob("*") if p.is_file())


def test_stores_the_exact_original_bytes(client, data_dir):
    body = make_pdf()
    response = upload(client, body, "lab results.pdf")
    assert response.status_code == 201
    result = response.json()
    assert result["duplicate"] is False
    document = result["document"]
    assert document["original_filename"] == "lab results.pdf"
    assert document["sha256"] == hashlib.sha256(body).hexdigest()
    assert document["byte_size"] == len(body)
    assert document["media_type"] == "application/pdf"
    assert document["extraction_status"] == "pending"
    assert document["review_status"] == "not_started"
    assert document["verification_status"] == "unverified"
    assert document["imported_at"].endswith("Z")
    stored = files_under(data_dir / "originals")
    assert len(stored) == 1
    assert stored[0].read_bytes() == body


def test_original_and_archive_are_private(client, data_dir):
    upload(client, make_pdf())
    original = files_under(data_dir / "originals")[0]
    assert stat.S_IMODE(original.stat().st_mode) == 0o400
    assert stat.S_IMODE(data_dir.stat().st_mode) == 0o700
    assert stat.S_IMODE((data_dir / "archive.sqlite3").stat().st_mode) == 0o600


def test_filename_never_reaches_the_file_system(client, data_dir):
    response = upload(client, make_pdf(), quote("../../../evil/passwörd.pdf"))
    assert response.status_code == 201
    assert response.json()["document"]["original_filename"] == "passwörd.pdf"
    stored = files_under(data_dir)
    assert not any("evil" in str(p) or "passw" in str(p) for p in stored)
    assert all(p.is_relative_to(data_dir) for p in stored)


@pytest.mark.parametrize("raw,expected", [("..%5C..%5Cwin.pdf", "win.pdf"), ("a%00b.pdf", "ab.pdf"), ("a%0Ab.PDF", "ab.PDF")])
def test_filename_is_cleaned(client, raw, expected):
    assert upload(client, make_pdf(raw), raw).json()["document"]["original_filename"] == expected


def test_unreadable_filename_is_rejected(client):
    assert upload(client, make_pdf(), "%FF%FE.pdf").json()["code"] == "missing_filename"


def test_long_filename_is_shortened_keeping_extension(client):
    name = upload(client, make_pdf(), "x" * 400 + ".pdf").json()["document"]["original_filename"]
    assert len(name) == 255 and name.endswith(".pdf")


@pytest.mark.parametrize(
    "body,name,overrides,status,code",
    [
        (b"hello, not a pdf" * 10, "fake.pdf", {}, 415, "not_pdf"),
        (make_pdf(), "report.exe", {}, 415, "not_pdf"),
        (make_pdf(), ".pdf", {}, 415, "not_pdf"),
        (make_pdf(), "report.pdf", {"content-type": "text/html"}, 415, "not_pdf"),
        (make_pdf()[:-20], "truncated.pdf", {}, 415, "not_pdf"),
        (b"", "empty.pdf", {}, 400, "empty"),
    ],
)
def test_invalid_uploads_store_nothing(client, data_dir, body, name, overrides, status, code):
    response = upload(client, body, name, **overrides)
    assert response.status_code == status
    assert response.json()["code"] == code
    assert files_under(data_dir / "originals") == []
    assert files_under(data_dir / "incoming") == []
    assert client.get("/api/documents").json()["documents"] == []


def test_missing_filename_is_rejected(client):
    response = client.post("/api/documents", content=make_pdf(), headers={"x-this-is-you-client": "1", "content-type": "application/pdf"})
    assert response.status_code == 400
    assert response.json()["code"] == "missing_filename"


def test_size_limit_from_declared_length(tmp_path):
    client = client_for(tmp_path / "a", max_upload_bytes=100)
    assert upload(client, make_pdf()).json()["code"] == "too_large"


def test_size_limit_while_streaming_when_length_is_undeclared(tmp_path):
    client = client_for(tmp_path / "a", max_upload_bytes=100)

    def chunks():
        yield b"%PDF-1.4\n" + b"0" * 60
        yield b"0" * 60

    response = client.post("/api/documents", content=chunks(), headers={"x-this-is-you-client": "1", "content-type": "application/pdf", "x-original-filename": "big.pdf"})
    assert response.status_code == 413
    assert files_under(tmp_path / "a" / "incoming") == []
    assert files_under(tmp_path / "a" / "originals") == []


def test_exactly_the_limit_is_accepted(tmp_path):
    body = make_pdf()
    assert upload(client_for(tmp_path / "a", max_upload_bytes=len(body)), body).status_code == 201


def test_logs_never_contain_filenames_or_contents(client, caplog):
    caplog.set_level(logging.DEBUG)
    secret_name, secret_text = "hiv-result-jordan.pdf", "SECRETDIAGNOSIS"
    body = make_pdf(secret_text)
    upload(client, body, secret_name)
    upload(client, body, secret_name)
    upload(client, b"nope", secret_name)
    assert any("stored" in r.getMessage() for r in caplog.records)
    assert secret_name not in caplog.text and secret_text not in caplog.text


def test_duplicate_returns_existing_document_and_stores_nothing_new(client, data_dir):
    body = make_pdf()
    first = upload(client, body, "first.pdf").json()["document"]
    response = upload(client, body, "renamed copy.pdf")
    assert response.status_code == 200
    result = response.json()
    assert result["duplicate"] is True
    assert result["document"]["id"] == first["id"]
    assert result["document"]["original_filename"] == "first.pdf"
    assert len(files_under(data_dir / "originals")) == 1
    assert files_under(data_dir / "incoming") == []
    assert len(client.get("/api/documents").json()["documents"]) == 1


def test_duplicate_is_recorded_as_provenance(client):
    body = make_pdf()
    doc = upload(client, body, "first.pdf").json()["document"]
    upload(client, body, "second.pdf")
    imports = client.get(f"/api/documents/{doc['id']}").json()["imports"]
    assert [(i["submitted_filename"], i["outcome"]) for i in imports] == [("first.pdf", "stored"), ("second.pdf", "duplicate")]


def test_different_files_are_different_documents(client):
    upload(client, make_pdf("one"), "same name.pdf")
    upload(client, make_pdf("two"), "same name.pdf")
    assert len(client.get("/api/documents").json()["documents"]) == 2


def test_same_file_uploaded_concurrently_makes_one_document(client, data_dir):
    body = make_pdf()
    with ThreadPoolExecutor(6) as pool:
        codes = sorted(r.status_code for r in pool.map(lambda i: upload(client, body, f"{i}.pdf"), range(6)))
    assert codes == [200] * 5 + [201]
    assert len(client.get("/api/documents").json()["documents"]) == 1
    assert len(files_under(data_dir / "originals")) == 1
    assert files_under(data_dir / "incoming") == []


def test_reupload_restores_a_missing_original(client, data_dir):
    body = make_pdf()
    doc = upload(client, body).json()["document"]
    original = files_under(data_dir / "originals")[0]
    original.unlink()
    assert client.get(doc["content_url"]).status_code == 404
    assert upload(client, body).json()["duplicate"] is True
    assert client.get(doc["content_url"]).content == body
