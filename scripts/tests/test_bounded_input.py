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
    target = tmp_path / "contract.json"
    outside = tmp_path.parent / f"{tmp_path.name}-concurrent.json"
    original = b"original\n"
    replacement = b"replacement\n"
    target.write_bytes(original)
    original_inode = target.stat().st_ino
    real_replace = bounded_input.os.replace

    def add_link_before_replace(
        source: str,
        destination: str,
        *,
        src_dir_fd: int | None = None,
        dst_dir_fd: int | None = None,
    ) -> None:
        os.link(target, outside)
        real_replace(
            source,
            destination,
            src_dir_fd=src_dir_fd,
            dst_dir_fd=dst_dir_fd,
        )

    with bounded_input.RootedDirectory(tmp_path) as root:
        snapshot = root.read_snapshot(Path("contract.json"), 1024)
        monkeypatch.setattr(bounded_input.os, "replace", add_link_before_replace)
        root.write_bytes(Path("contract.json"), replacement, snapshot.identity)

    assert target.read_bytes() == replacement
    assert target.stat().st_ino != original_inode
    assert outside.read_bytes() == original
    assert outside.stat().st_ino == original_inode
