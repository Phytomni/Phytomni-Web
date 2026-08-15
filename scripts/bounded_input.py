"""Bounded, descriptor-rooted access to untrusted local contract inputs."""

from __future__ import annotations

import errno
import os
import stat
from pathlib import Path
from typing import NamedTuple, NoReturn


MAX_CONTRACT_MANIFEST_BYTES = 2 * 1024 * 1024


class InputTooLargeError(Exception):
    """Raised when an input has at least one byte beyond its allowed size."""


class InputChangedError(OSError):
    """Raised when an input or path component changes during access."""


class UnsafeInputPathError(OSError):
    """Raised when a descendant path crosses a symlink or non-directory."""


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


def _same_entry(left: os.stat_result, right: os.stat_result) -> bool:
    return (
        left.st_dev == right.st_dev
        and left.st_ino == right.st_ino
        and stat.S_IFMT(left.st_mode) == stat.S_IFMT(right.st_mode)
    )


class RootedDirectory:
    """Retain one directory descriptor and open descendants relative to it."""

    def __init__(self, root: Path) -> None:
        try:
            resolved = Path(root).resolve(strict=True)
        except (OSError, RuntimeError) as exc:
            raise OSError("input root cannot be resolved") from exc
        flags = (
            os.O_RDONLY
            | os.O_DIRECTORY
            | os.O_NOFOLLOW
            | getattr(os, "O_CLOEXEC", 0)
        )
        descriptor = os.open(resolved, flags)
        try:
            opened = os.fstat(descriptor)
            current = os.stat(resolved, follow_symlinks=False)
            if not stat.S_ISDIR(opened.st_mode) or not _same_entry(
                opened, current
            ):
                raise InputChangedError("input root changed during open")
        except BaseException:
            os.close(descriptor)
            raise
        self.path = resolved
        self._descriptor = descriptor

    def __enter__(self) -> RootedDirectory:
        return self

    def __exit__(self, *_exc: object) -> None:
        self.close()

    def close(self) -> None:
        if self._descriptor >= 0:
            os.close(self._descriptor)
            self._descriptor = -1

    @staticmethod
    def _relative_parts(relative: Path) -> tuple[str, ...]:
        path = Path(relative)
        parts = path.parts
        if (
            path.is_absolute()
            or not parts
            or any(part in {"", ".", ".."} or "\0" in part for part in parts)
        ):
            raise OSError("input path is not a safe relative path")
        return parts

    @staticmethod
    def _raise_safe_open_error(error: OSError) -> NoReturn:
        if error.errno in {errno.ELOOP, errno.ENOTDIR}:
            raise UnsafeInputPathError("input path is unsafe") from error
        raise error

    @staticmethod
    def _verify_opened_entry(
        parent_descriptor: int,
        name: str,
        descriptor: int,
        *,
        directory: bool,
    ) -> os.stat_result:
        opened = os.fstat(descriptor)
        current = os.stat(
            name,
            dir_fd=parent_descriptor,
            follow_symlinks=False,
        )
        expected_type = stat.S_ISDIR if directory else stat.S_ISREG
        if not expected_type(opened.st_mode) or not _same_entry(opened, current):
            raise InputChangedError("input path changed during open")
        return opened

    def _open_parent(self, relative: Path) -> tuple[int, str]:
        if self._descriptor < 0:
            raise OSError("input root is closed")
        parts = self._relative_parts(relative)
        parent = os.dup(self._descriptor)
        directory_flags = (
            os.O_RDONLY
            | os.O_DIRECTORY
            | os.O_NOFOLLOW
            | getattr(os, "O_CLOEXEC", 0)
        )
        try:
            for part in parts[:-1]:
                try:
                    child = os.open(
                        part,
                        directory_flags,
                        dir_fd=parent,
                    )
                except OSError as exc:
                    self._raise_safe_open_error(exc)
                try:
                    self._verify_opened_entry(
                        parent,
                        part,
                        child,
                        directory=True,
                    )
                except BaseException:
                    os.close(child)
                    raise
                os.close(parent)
                parent = child
            return parent, parts[-1]
        except BaseException:
            os.close(parent)
            raise

    def _open_regular(self, relative: Path, flags: int) -> int:
        parent, name = self._open_parent(relative)
        descriptor = -1
        try:
            try:
                descriptor = os.open(
                    name,
                    flags | os.O_NOFOLLOW | getattr(os, "O_CLOEXEC", 0),
                    dir_fd=parent,
                )
            except OSError as exc:
                self._raise_safe_open_error(exc)
            self._verify_opened_entry(
                parent,
                name,
                descriptor,
                directory=False,
            )
            return descriptor
        except BaseException:
            if descriptor >= 0:
                os.close(descriptor)
            raise
        finally:
            os.close(parent)

    def read_snapshot(self, relative: Path, max_bytes: int) -> BoundedRead:
        """Read one regular-file snapshot without consuming oversized input."""

        if max_bytes < 0:
            raise ValueError("input size bound must not be negative")
        descriptor = self._open_regular(relative, os.O_RDONLY)
        with os.fdopen(descriptor, "rb") as stream:
            before = _file_identity(os.fstat(stream.fileno()))
            if before.size > max_bytes:
                raise InputTooLargeError
            value = stream.read(max_bytes + 1)
            after = _file_identity(os.fstat(stream.fileno()))
        if before != after:
            raise InputChangedError("input changed during read")
        if len(value) > max_bytes:
            raise InputTooLargeError
        return BoundedRead(value=value, identity=after)

    def read_bytes(self, relative: Path, max_bytes: int) -> bytes:
        """Read one bounded regular file beneath the retained root."""

        return self.read_snapshot(relative, max_bytes).value

    def write_bytes(
        self,
        relative: Path,
        value: bytes,
        expected_identity: FileIdentity,
    ) -> None:
        """Replace one existing regular file through its retained descriptor."""

        descriptor = self._open_regular(relative, os.O_WRONLY)
        try:
            if _file_identity(os.fstat(descriptor)) != expected_identity:
                raise InputChangedError("input changed before write")
            os.ftruncate(descriptor, 0)
            remaining = memoryview(value)
            while remaining:
                written = os.write(descriptor, remaining)
                if written <= 0:
                    raise OSError("cannot write input file")
                remaining = remaining[written:]
        finally:
            os.close(descriptor)
