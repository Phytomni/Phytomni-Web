"""Tests for descriptor-rooted bounded input access."""

from __future__ import annotations

import os
from pathlib import Path

import pytest

from scripts import bounded_input


def test_bounded_read_rejects_hardlinked_regular_file(tmp_path: Path) -> None:
    target = tmp_path / "contract.json"
    outside = tmp_path.parent / f"{tmp_path.name}-outside.json"
    outside.write_bytes(b"outside\n")
    os.link(outside, target)

    with bounded_input.RootedDirectory(tmp_path) as root:
        with pytest.raises(bounded_input.UnsafeInputPathError):
            root.read_bytes(Path("contract.json"), 1024)

    assert outside.read_bytes() == b"outside\n"


def test_atomic_write_preserves_concurrently_hardlinked_inode(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setenv(bounded_input._SANDBOX_ENV, "1")
    target = tmp_path / "contract.json"
    outside = tmp_path.parent / f"{tmp_path.name}-concurrent.json"
    original = b"original\n"
    replacement = b"replacement\n"
    target.write_bytes(original)
    original_inode = target.stat().st_ino
    real_rename = bounded_input._rename_rooted

    def add_link_before_replace(
        directory: int,
        source: str,
        destination: str,
    ) -> None:
        os.link(target, outside)
        real_rename(directory, source, destination)

    with bounded_input.RootedDirectory(tmp_path) as root:
        snapshot = root.read_snapshot(Path("contract.json"), 1024)
        monkeypatch.setattr(bounded_input, "_rename_rooted", add_link_before_replace)
        root.write_bytes(Path("contract.json"), replacement, snapshot.identity)

    assert target.read_bytes() == replacement
    assert target.stat().st_ino != original_inode
    assert outside.read_bytes() == original
    assert outside.stat().st_ino == original_inode


def test_read_rejects_descendant_moved_before_final_kernel_resolution(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    nested = tmp_path / "nested"
    nested.mkdir()
    (nested / "contract.json").write_bytes(b"inside\n")
    outside = tmp_path.parent / f"{tmp_path.name}-outside-read"
    outside.mkdir()
    outside_target = outside / "contract.json"
    outside_target.write_bytes(b"outside\n")
    parked = tmp_path / "nested-parked"
    real_openat2 = bounded_input._openat2
    swapped = False

    def move_before_open(
        directory: int,
        relative: str,
        flags: int,
        mode: int = 0,
    ) -> int:
        nonlocal swapped
        if relative == "nested/contract.json" and not swapped:
            nested.rename(parked)
            nested.symlink_to(outside, target_is_directory=True)
            swapped = True
        return real_openat2(directory, relative, flags, mode)

    monkeypatch.setattr(bounded_input, "_openat2", move_before_open)
    with bounded_input.RootedDirectory(tmp_path) as root:
        with pytest.raises(bounded_input.UnsafeInputPathError):
            root.read_bytes(Path("nested/contract.json"), 1024)

    assert outside_target.read_bytes() == b"outside\n"


def test_write_rejects_descendant_moved_before_rooted_rename(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setenv(bounded_input._SANDBOX_ENV, "1")
    nested = tmp_path / "nested"
    nested.mkdir()
    target = nested / "contract.json"
    target.write_bytes(b"inside\n")
    outside = tmp_path.parent / f"{tmp_path.name}-outside-write"
    outside.mkdir()
    outside_target = outside / "contract.json"
    outside_target.write_bytes(b"outside\n")
    parked = tmp_path / "nested-parked"
    real_rename = bounded_input._rename_rooted

    def move_before_rename(directory: int, source: str, destination: str) -> None:
        nested.rename(parked)
        nested.symlink_to(outside, target_is_directory=True)
        real_rename(directory, source, destination)

    with bounded_input.RootedDirectory(tmp_path) as root:
        snapshot = root.read_snapshot(Path("nested/contract.json"), 1024)
        monkeypatch.setattr(bounded_input, "_rename_rooted", move_before_rename)
        with pytest.raises(bounded_input.InputChangedError):
            root.write_bytes(
                Path("nested/contract.json"), b"replacement\n", snapshot.identity
            )

    assert outside_target.read_bytes() == b"outside\n"


def test_read_rechecks_link_count_after_open(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    target = tmp_path / "contract.json"
    target.write_bytes(b"inside\n")
    outside = tmp_path.parent / f"{tmp_path.name}-late-link.json"
    real_read = bounded_input.os.read

    def add_hardlink(descriptor: int, size: int) -> bytes:
        os.link(target, outside)
        return real_read(descriptor, size)

    monkeypatch.setattr(bounded_input.os, "read", add_hardlink)
    with bounded_input.RootedDirectory(tmp_path) as root:
        with pytest.raises(bounded_input.UnsafeInputPathError):
            root.read_snapshot(Path("contract.json"), 1024)

    assert outside.read_bytes() == b"inside\n"


def test_nested_write_runs_inside_the_private_mount_namespace(tmp_path: Path) -> None:
    nested = tmp_path / "nested"
    nested.mkdir()
    target = nested / "contract.json"
    target.write_bytes(b"inside\n")

    with bounded_input.RootedDirectory(tmp_path) as root:
        snapshot = root.read_snapshot(Path("nested/contract.json"), 1024)
        root.write_bytes(
            Path("nested/contract.json"), b"replacement\n", snapshot.identity
        )

    assert target.read_bytes() == b"replacement\n"


def test_write_cleanup_closes_descriptors_when_unlink_fails(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setenv(bounded_input._SANDBOX_ENV, "1")
    target = tmp_path / "contract.json"
    target.write_bytes(b"inside\n")
    real_write = bounded_input.os.write
    real_close = bounded_input.os.close
    closed: list[int] = []

    def fail_write(_descriptor: int, _value: memoryview) -> int:
        raise OSError("write failed")

    def fail_unlink(_path: str, *, dir_fd: int | None = None) -> None:
        raise OSError("unlink failed")

    def record_close(descriptor: int) -> None:
        closed.append(descriptor)
        real_close(descriptor)

    with bounded_input.RootedDirectory(tmp_path) as root:
        snapshot = root.read_snapshot(Path("contract.json"), 1024)
        monkeypatch.setattr(bounded_input.os, "write", fail_write)
        monkeypatch.setattr(bounded_input.os, "unlink", fail_unlink)
        monkeypatch.setattr(bounded_input.os, "close", record_close)
        with pytest.raises(OSError, match="write failed"):
            root.write_bytes(Path("contract.json"), b"replacement\n", snapshot.identity)

    assert len(closed) >= 2
    monkeypatch.setattr(bounded_input.os, "write", real_write)
