"""The two credentials connections need, each in its own file readable only by the service's user.

- A signing key: proves this installation to the provider (private_key_jwt). Only its public half is ever shared.
- A token key: encrypts provider tokens in the database.

Both live beside the database but are never copied into backups, so a backup holds no usable credential.
After a restore elsewhere, providers are connected again.
"""
from __future__ import annotations

import base64
import hashlib
import json
import os
from pathlib import Path

from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric import padding, rsa
from cryptography.hazmat.primitives.ciphers.aead import AESGCM

SIGNING_KEY = "connector-signing-key.pem"
TOKEN_KEY = "connector-token.key"


class TokensUnreadable(Exception):
    """The tokens were sealed with a key this installation does not have, as after a restore. Sign in again."""


def _b64url(data: bytes) -> str:
    return base64.urlsafe_b64encode(data).rstrip(b"=").decode()


def _write_new(path: Path, data: bytes) -> None:
    # O_EXCL: two first uses at once cannot both write, and an existing key is never replaced.
    fd = os.open(path, os.O_CREAT | os.O_EXCL | os.O_WRONLY, 0o600)
    try:
        os.write(fd, data)
        os.fsync(fd)
    finally:
        os.close(fd)


def _read_or_make(path: Path, make) -> bytes:
    if not path.exists():
        try:
            _write_new(path, make())
        except FileExistsError:
            pass
    path.chmod(0o600)
    return path.read_bytes()


class ConnectorKeys:
    def __init__(self, data_dir: Path) -> None:
        self.data_dir = data_dir

    def signing_key(self) -> rsa.RSAPrivateKey:
        pem = _read_or_make(self.data_dir / SIGNING_KEY, lambda: rsa.generate_private_key(public_exponent=65537, key_size=3072).private_bytes(
            serialization.Encoding.PEM, serialization.PrivateFormat.PKCS8, serialization.NoEncryption()))
        key = serialization.load_pem_private_key(pem, password=None)
        assert isinstance(key, rsa.RSAPrivateKey)
        return key

    def _public_numbers(self) -> tuple[str, str]:
        numbers = self.signing_key().public_key().public_numbers()
        n = numbers.n.to_bytes((numbers.n.bit_length() + 7) // 8, "big")
        e = numbers.e.to_bytes((numbers.e.bit_length() + 7) // 8, "big")
        return _b64url(n), _b64url(e)

    def key_id(self) -> str:
        n, e = self._public_numbers()
        # RFC 7638 thumbprint, so the same key always has the same ID.
        return _b64url(hashlib.sha256(json.dumps({"e": e, "kty": "RSA", "n": n}, separators=(",", ":"), sort_keys=True).encode()).digest())

    def public_jwks(self) -> dict:
        """What Epic on FHIR takes for a patient-facing confidential client: a JSON Web Key Set, RSA, signing with RS384."""
        n, e = self._public_numbers()
        return {"keys": [{"kty": "RSA", "n": n, "e": e, "kid": self.key_id(), "alg": "RS384", "use": "sig"}]}

    def sign_jwt(self, claims: dict) -> str:
        header = {"alg": "RS384", "typ": "JWT", "kid": self.key_id()}
        signing_input = f"{_b64url(json.dumps(header, separators=(',', ':')).encode())}.{_b64url(json.dumps(claims, separators=(',', ':')).encode())}"
        signature = self.signing_key().sign(signing_input.encode(), padding.PKCS1v15(), hashes.SHA384())
        return f"{signing_input}.{_b64url(signature)}"

    def _token_key(self) -> bytes:
        return _read_or_make(self.data_dir / TOKEN_KEY, lambda: AESGCM.generate_key(bit_length=256))

    def seal(self, tokens: dict, bound_to: str) -> str:
        nonce = os.urandom(12)
        sealed = AESGCM(self._token_key()).encrypt(nonce, json.dumps(tokens).encode(), bound_to.encode())
        return _b64url(nonce + sealed)

    def open(self, ciphertext: str, bound_to: str) -> dict:
        raw = base64.urlsafe_b64decode(ciphertext + "=" * (-len(ciphertext) % 4))
        try:
            return json.loads(AESGCM(self._token_key()).decrypt(raw[:12], raw[12:], bound_to.encode()))
        except Exception as problem:
            raise TokensUnreadable() from problem
