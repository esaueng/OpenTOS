from __future__ import annotations

import base64


def b64_to_bytes(data_base64: str) -> bytes:
    return base64.b64decode(data_base64.encode("utf-8"))


def bytes_to_b64(raw: bytes) -> str:
    return base64.b64encode(raw).decode("utf-8")
