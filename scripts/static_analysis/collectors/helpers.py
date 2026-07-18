"""Shared file discovery and finding construction for policy collectors."""

from __future__ import annotations

import subprocess
from collections.abc import Sequence
from pathlib import Path

from ..fingerprints import FingerprintInput, fingerprint, normalize_source
from ..model import Finding, Mechanism, TargetKind
from .errors import CollectionError


def relative_path(root: Path, path: Path) -> str:
    """Return a normalized repository-relative POSIX path."""

    return path.resolve().relative_to(root.resolve()).as_posix()


def tracked_files(root: Path) -> tuple[Path, ...]:
    """Return existing tracked files using Git's NUL-safe file listing."""

    try:
        result = subprocess.run(
            ["git", "ls-files", "-z"],
            cwd=root,
            check=True,
            capture_output=True,
        )
    except (OSError, subprocess.CalledProcessError) as exc:
        raise CollectionError(f"git ls-files failed: {exc}") from exc

    try:
        names = result.stdout.decode("utf-8").split("\0")
    except UnicodeDecodeError as exc:
        raise CollectionError("git ls-files returned non-UTF-8 paths") from exc
    paths = [root / name for name in names if name and (root / name).is_file()]
    return tuple(sorted(paths, key=lambda path: relative_path(root, path)))


def make_finding(
    *,
    root: Path,
    path: Path,
    tool: str,
    rule: str,
    mechanism: Mechanism | str,
    target_kind: TargetKind | str,
    target: str,
    message: str,
    display_line: int | None,
    source: str,
    tool_version: str = "inventory",
    evidence: Sequence[str] = (),
    peer_path: str | None = None,
    peer_target: str | None = None,
) -> Finding:
    """Construct one finding without making any authorization decision."""

    mechanism_value = Mechanism(getattr(mechanism, "value", mechanism))
    target_kind_value = TargetKind(getattr(target_kind, "value", target_kind))
    display_path = relative_path(root, path)
    normalized_source = normalize_source(source)
    digest = fingerprint(
        FingerprintInput(
            tool=tool,
            rule=rule,
            mechanism=mechanism_value.value,
            target_kind=target_kind_value,
            path=display_path,
            target=target,
            normalized_source=normalized_source,
            peer_path=peer_path,
            peer_target=peer_target,
        )
    )
    return Finding(
        tool=tool,
        rule=rule,
        mechanism=mechanism_value,
        target_kind=target_kind_value,
        path=display_path,
        target=target,
        fingerprint=digest,
        message=message,
        display_line=display_line,
        tool_version=tool_version,
        evidence=tuple(evidence) or (message,),
        peer_path=peer_path,
        peer_target=peer_target,
    )
