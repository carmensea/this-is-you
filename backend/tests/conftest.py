from __future__ import annotations

from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from this_is_you.config import Settings
from this_is_you.main import create_app

CLIENT_HEADERS = {"x-this-is-you-client": "1"}


def make_pdf(text: str = "Fictional test document") -> bytes:
    """A small, valid one-page PDF. Different text gives different bytes."""
    stream = f"BT /F1 14 Tf 72 720 Td ({text}) Tj ET".encode()
    objects = [
        b"<< /Type /Catalog /Pages 2 0 R >>",
        b"<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
        b"<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>",
        b"<< /Length %d >>\nstream\n%s\nendstream" % (len(stream), stream),
        b"<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
    ]
    out, offsets = b"%PDF-1.4\n", []
    for number, body in enumerate(objects, 1):
        offsets.append(len(out))
        out += b"%d 0 obj\n%s\nendobj\n" % (number, body)
    xref = len(out)
    out += b"xref\n0 6\n0000000000 65535 f \n" + b"".join(b"%010d 00000 n \n" % o for o in offsets)
    out += b"trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n%d\n%%%%EOF\n" % xref
    return out


def client_for(data_dir: Path, **settings) -> TestClient:
    app = create_app(Settings(data_dir=data_dir, **settings))
    return TestClient(app, base_url="http://localhost", client=("127.0.0.1", 50000), raise_server_exceptions=True)


def upload(client: TestClient, body: bytes, name: str = "report.pdf", **overrides):
    headers = {**CLIENT_HEADERS, "content-type": "application/pdf", "x-original-filename": name, **overrides}
    return client.post("/api/documents", content=body, headers=headers)


@pytest.fixture
def data_dir(tmp_path: Path) -> Path:
    return tmp_path / "archive"


@pytest.fixture
def client(data_dir: Path) -> TestClient:
    return client_for(data_dir)
