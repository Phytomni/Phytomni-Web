"""Small bounded reads for untrusted local contract inputs."""

from __future__ import annotations

from pathlib import Path


MAX_CONTRACT_MANIFEST_BYTES = 2 * 1024 * 1024


class InputTooLargeError(Exception):
    """Raised when an input has at least one byte beyond its allowed size."""


def read_bytes(path: Path, max_bytes: int) -> bytes:
    """Read at most ``max_bytes + 1`` bytes and reject oversized input."""

    with path.open("rb") as stream:
        value = stream.read(max_bytes + 1)
    if len(value) > max_bytes:
        raise InputTooLargeError
    return value
