"""Small bounded reads for untrusted local contract inputs."""

from __future__ import annotations

import os
import stat
from pathlib import Path
from typing import NamedTuple


MAX_CONTRACT_MANIFEST_BYTES = 2 * 1024 * 1024


class InputTooLargeError(Exception):
    """Raised when an input has at least one byte beyond its allowed size."""


class InputChangedError(OSError):
    """Raised when an input changes while its bounded snapshot is read."""


class FileIdentity(NamedTuple):
    """Stable identity fields used to detect replacement or mutation."""

    device: int
    inode: int
    mode: int
    size: int
    modified_ns: int
    changed_ns: int


class BoundedRead(NamedTuple):
    """Bounded input bytes and the identity of the opened regular file."""

    value: bytes
    identity: FileIdentity


def _file_identity(value: os.stat_result) -> FileIdentity:
    return FileIdentity(
        device=value.st_dev,
        inode=value.st_ino,
        mode=value.st_mode,
        size=value.st_size,
        modified_ns=value.st_mtime_ns,
        changed_ns=value.st_ctime_ns,
    )


def read_snapshot(
    path: Path,
    max_bytes: int,
    *,
    no_follow: bool = False,
) -> BoundedRead:
    """Read one regular-file snapshot without consuming oversized content."""

    flags = os.O_RDONLY | getattr(os, "O_CLOEXEC", 0)
    if no_follow:
        flags |= getattr(os, "O_NOFOLLOW", 0)
    descriptor = os.open(path, flags)
    with os.fdopen(descriptor, "rb") as stream:
        before = _file_identity(os.fstat(stream.fileno()))
        if not stat.S_ISREG(before.mode):
            raise OSError("input is not a regular file")
        if before.size > max_bytes:
            raise InputTooLargeError
        value = stream.read(max_bytes + 1)
        after = _file_identity(os.fstat(stream.fileno()))
    if before != after:
        raise InputChangedError("input changed during read")
    if len(value) > max_bytes:
        raise InputTooLargeError
    return BoundedRead(value=value, identity=after)


def read_bytes(path: Path, max_bytes: int) -> bytes:
    """Read at most ``max_bytes + 1`` bytes and reject oversized input."""

    return read_snapshot(path, max_bytes).value
