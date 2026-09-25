"""Bounded, kernel-rooted access to untrusted local contract inputs."""

from __future__ import annotations

import ctypes
import errno
import json
import os
import platform
import secrets
import shutil
import stat
import subprocess
import sys
from pathlib import Path
from typing import NamedTuple

MAX_CONTRACT_MANIFEST_BYTES = 2 * 1024 * 1024
_SYS_OPENAT2 = 437
_RESOLVE_NO_MAGICLINKS = 0x02
_RESOLVE_NO_SYMLINKS = 0x04
_RESOLVE_BENEATH = 0x08
_RESOLVE_FLAGS = _RESOLVE_NO_MAGICLINKS | _RESOLVE_NO_SYMLINKS | _RESOLVE_BENEATH
_AT_FDCWD = -100
_SANDBOX_ENV = "PHYTOMNI_BOUNDED_INPUT_SANDBOXED"
_WRITE_TIMEOUT_SECONDS = 30


class InputTooLargeError(Exception):
    """Raised when an input has at least one byte beyond its allowed size."""


class InputChangedError(OSError):
    """Raised when an input or path component changes during access."""


class UnsafeInputPathError(OSError):
    """Raised when a descendant path crosses a symlink or non-directory."""


class UnsupportedRootedAccessError(OSError):
    """Raised when the kernel cannot enforce rooted descendant resolution."""


class FileIdentity(NamedTuple):
    """Stable identity fields used to detect replacement or mutation."""

    device: int
    inode: int
    mode: int
    size: int
    modified_ns: int
    changed_ns: int
    links: int


class BoundedRead(NamedTuple):
    """Bounded input bytes and the identity of the opened regular file."""

    value: bytes
    identity: FileIdentity


class _OpenHow(ctypes.Structure):
    _fields_ = [
        ("flags", ctypes.c_ulonglong),
        ("mode", ctypes.c_ulonglong),
        ("resolve", ctypes.c_ulonglong),
    ]


_LIBC = ctypes.CDLL(None, use_errno=True)


def _file_identity(value: os.stat_result) -> FileIdentity:
    return FileIdentity(
        device=value.st_dev,
        inode=value.st_ino,
        mode=value.st_mode,
        size=value.st_size,
        modified_ns=value.st_mtime_ns,
        changed_ns=value.st_ctime_ns,
        links=value.st_nlink,
    )


def _same_entry(left: os.stat_result, right: os.stat_result) -> bool:
    return (
        left.st_dev == right.st_dev
        and left.st_ino == right.st_ino
        and stat.S_IFMT(left.st_mode) == stat.S_IFMT(right.st_mode)
    )


def _require_openat2() -> None:
    if sys.platform != "linux" or platform.machine() not in {"x86_64", "aarch64"}:
        raise UnsupportedRootedAccessError(
            "Linux x86_64 or aarch64 openat2 support is required"
        )


def _openat2(directory: int, relative: str, flags: int, mode: int = 0) -> int:
    """Open a complete relative path in one kernel-rooted resolution."""

    _require_openat2()
    how = _OpenHow(flags, mode, _RESOLVE_FLAGS)
    result = _LIBC.syscall(
        _SYS_OPENAT2,
        directory,
        os.fsencode(relative),
        ctypes.byref(how),
        ctypes.sizeof(how),
    )
    if result >= 0:
        return int(result)
    error = ctypes.get_errno()
    if error in {errno.ENOSYS, errno.EINVAL}:
        raise UnsupportedRootedAccessError(
            "Linux kernel openat2 RESOLVE_BENEATH support is required"
        )
    if error in {errno.ELOOP, errno.ENOTDIR, errno.EXDEV}:
        raise UnsafeInputPathError("input path is unsafe")
    raise OSError(error, os.strerror(error), relative)


def _rename_rooted(directory: int, source: str, destination: str) -> None:
    """Rename relative paths from the trusted root without a movable parent fd."""

    renameat2 = getattr(_LIBC, "renameat2", None)
    if renameat2 is None:
        raise UnsupportedRootedAccessError("Linux renameat2 support is required")
    result = renameat2(
        directory,
        os.fsencode(source),
        directory,
        os.fsencode(destination),
        0,
    )
    if result == 0:
        return
    error = ctypes.get_errno()
    if error in {errno.ENOENT, errno.ENOTDIR, errno.EXDEV}:
        raise InputChangedError("input path changed before replacement")
    if error == errno.ELOOP:
        raise UnsafeInputPathError("input path is unsafe")
    raise OSError(error, os.strerror(error), destination)


class RootedDirectory:
    """Resolve every descendant from a retained root descriptor in one syscall."""

    def __init__(self, root: Path) -> None:
        _require_openat2()
        try:
            resolved = Path(root).resolve(strict=True)
        except (OSError, RuntimeError) as exc:
            raise OSError("input root cannot be resolved") from exc
        flags = (
            os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW | getattr(os, "O_CLOEXEC", 0)
        )
        descriptor = os.open(resolved, flags)
        try:
            opened = os.fstat(descriptor)
            current = os.stat(resolved, follow_symlinks=False)
            if not stat.S_ISDIR(opened.st_mode) or not _same_entry(opened, current):
                raise InputChangedError("input root changed during open")
        except BaseException:
            os.close(descriptor)
            raise
        self.path = resolved
        self._descriptor = descriptor

    def _verify_root(self) -> None:
        if self._descriptor < 0:
            raise OSError("input root is closed")
        opened = os.fstat(self._descriptor)
        current = os.stat(self.path, follow_symlinks=False)
        if not stat.S_ISDIR(current.st_mode) or not _same_entry(opened, current):
            raise InputChangedError("input root changed during access")

    def __enter__(self) -> RootedDirectory:
        return self

    def __exit__(self, *_exc: object) -> None:
        self.close()

    def close(self) -> None:
        if self._descriptor >= 0:
            os.close(self._descriptor)
            self._descriptor = -1

    @staticmethod
    def _relative_path(relative: Path) -> str:
        path = Path(relative)
        parts = path.parts
        if (
            path.is_absolute()
            or not parts
            or any(part in {"", ".", ".."} or "\0" in part for part in parts)
        ):
            raise OSError("input path is not a safe relative path")
        return path.as_posix()

    @staticmethod
    def _verify_regular(descriptor: int) -> os.stat_result:
        opened = os.fstat(descriptor)
        if not stat.S_ISREG(opened.st_mode):
            raise UnsafeInputPathError("input path is not a regular file")
        if opened.st_nlink != 1:
            raise UnsafeInputPathError("input regular file has multiple links")
        return opened

    def _open_regular(self, relative: Path, flags: int) -> int:
        self._verify_root()
        descriptor = _openat2(
            self._descriptor,
            self._relative_path(relative),
            flags | os.O_NOFOLLOW | getattr(os, "O_CLOEXEC", 0),
        )
        try:
            self._verify_regular(descriptor)
            return descriptor
        except BaseException:
            os.close(descriptor)
            raise

    def read_snapshot(self, relative: Path, max_bytes: int) -> BoundedRead:
        """Read one regular-file snapshot without consuming oversized input."""

        if max_bytes < 0:
            raise ValueError("input size bound must not be negative")
        descriptor = self._open_regular(relative, os.O_RDONLY)
        try:
            before = _file_identity(self._verify_regular(descriptor))
            if before.size > max_bytes:
                raise InputTooLargeError
            value = os.read(descriptor, max_bytes + 1)
            after = _file_identity(self._verify_regular(descriptor))
        finally:
            os.close(descriptor)
        if before != after:
            raise InputChangedError("input changed during read")
        if len(value) > max_bytes:
            raise InputTooLargeError
        self._verify_root()
        return BoundedRead(value=value, identity=after)

    def read_bytes(self, relative: Path, max_bytes: int) -> bytes:
        """Read one bounded regular file beneath the retained root."""

        return self.read_snapshot(relative, max_bytes).value

    def _write_bytes_in_sandbox(
        self,
        relative: Path,
        value: bytes,
        expected_identity: FileIdentity,
    ) -> None:
        """Atomically replace one existing regular file beneath the root."""

        target = self._relative_path(relative)
        descriptor = -1
        temporary = -1
        temporary_path: str | None = None
        try:
            descriptor = self._open_regular(relative, os.O_RDONLY)
            opened = self._verify_regular(descriptor)
            if _file_identity(opened) != expected_identity:
                raise InputChangedError("input changed before write")

            temporary_path = (
                f"{Path(target).parent.as_posix()}/.{Path(target).name}.tmp-"
                f"{secrets.token_hex(16)}"
            )
            if temporary_path.startswith("./"):
                temporary_path = temporary_path[2:]
            temporary = _openat2(
                self._descriptor,
                temporary_path,
                os.O_WRONLY
                | os.O_CREAT
                | os.O_EXCL
                | os.O_NOFOLLOW
                | getattr(os, "O_CLOEXEC", 0),
                stat.S_IMODE(opened.st_mode),
            )
            os.fchmod(temporary, stat.S_IMODE(opened.st_mode))
            self._verify_regular(temporary)
            remaining = memoryview(value)
            while remaining:
                written = os.write(temporary, remaining)
                if written <= 0:
                    raise OSError("cannot write input file")
                remaining = remaining[written:]
            os.fsync(temporary)

            current = _file_identity(self._verify_regular(descriptor))
            if current != expected_identity:
                raise InputChangedError("input changed before replacement")
            self._verify_root()
            _rename_rooted(self._descriptor, temporary_path, target)
            temporary_path = None
            os.fsync(self._descriptor)
        finally:
            cleanup_error: OSError | None = None
            if temporary_path is not None:
                try:
                    os.unlink(temporary_path, dir_fd=self._descriptor)
                except FileNotFoundError:
                    pass
                except OSError as exc:
                    cleanup_error = exc
            try:
                if temporary >= 0:
                    os.close(temporary)
            finally:
                try:
                    if descriptor >= 0:
                        os.close(descriptor)
                finally:
                    if cleanup_error is not None and sys.exc_info()[0] is None:
                        raise cleanup_error

    def _write_bytes_in_private_namespace(
        self,
        relative: Path,
        value: bytes,
        expected_identity: FileIdentity,
    ) -> None:
        bwrap = shutil.which("bwrap")
        if bwrap is None:
            raise UnsupportedRootedAccessError(
                "bubblewrap is required for rooted atomic replacement"
            )
        runner_root = Path(__file__).resolve().parent
        python_root = Path(sys.executable).resolve().parents[1]
        python = Path("/python/bin") / Path(sys.executable).resolve().name
        worker = "/runner/rooted_atomic_replace_worker.py"
        command = [
            bwrap,
            "--unshare-user",
            "--uid",
            "0",
            "--gid",
            "0",
            "--unshare-pid",
            "--unshare-net",
            "--die-with-parent",
            "--bind",
            str(self.path),
            "/workspace",
            "--ro-bind",
            str(runner_root),
            "/runner",
            "--ro-bind",
            str(python_root),
            "/python",
            "--ro-bind",
            "/lib",
            "/lib",
            "--ro-bind",
            "/lib64",
            "/lib64",
            "--dev",
            "/dev",
            "--proc",
            "/proc",
            "--tmpfs",
            "/tmp",
            "--chdir",
            "/workspace",
            str(python),
            "-I",
            worker,
            "--relative",
            self._relative_path(relative),
            "--identity",
            json.dumps(expected_identity),
            "--max-bytes",
            str(MAX_CONTRACT_MANIFEST_BYTES),
        ]
        environment = {
            "PATH": "/usr/bin:/bin",
            _SANDBOX_ENV: "1",
        }
        try:
            process = subprocess.run(
                command,
                input=value,
                stdout=subprocess.DEVNULL,
                stderr=subprocess.DEVNULL,
                env=environment,
                check=False,
                timeout=_WRITE_TIMEOUT_SECONDS,
            )
        except (OSError, subprocess.TimeoutExpired) as exc:
            raise UnsupportedRootedAccessError(
                "rooted atomic replacement sandbox is unavailable"
            ) from exc
        if process.returncode != 0:
            raise InputChangedError("rooted atomic replacement was refused")

    def write_bytes(
        self,
        relative: Path,
        value: bytes,
        expected_identity: FileIdentity,
    ) -> None:
        """Atomically replace under a namespace that cannot reach root-external paths."""

        if os.environ.get(_SANDBOX_ENV) == "1":
            self._write_bytes_in_sandbox(relative, value, expected_identity)
            return
        self._write_bytes_in_private_namespace(relative, value, expected_identity)
