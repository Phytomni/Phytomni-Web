"""Tests for the offline Bot activation-manifest generator."""

from __future__ import annotations

import base64
import copy
import json
import os
from pathlib import Path
from collections.abc import Callable
from typing import Any

import pytest

from scripts import check_bot_web_activation as checker
from scripts import bounded_input
from scripts import generate_bot_activation_manifest as generator
from scripts import run_pinned_bot_agent_catalog as catalog_runner


MANIFEST_PATH = checker.ROOT / checker.BOT_CONTRACT_MANIFEST_REL
FIXTURE_PATH = checker.ROOT / checker.RESEARCH_INPUT_FIXTURE_REL


def test_catalog_runner_rejects_python_311_without_parsing_bot_source(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
    capsys: pytest.CaptureFixture[str],
) -> None:
    monkeypatch.setattr(catalog_runner.sys, "version_info", (3, 11, 9))
    monkeypatch.setattr(
        catalog_runner,
        "_execute",
        lambda _source_root: pytest.fail("Python 3.11 executed fixed Bot source"),
    )

    result = catalog_runner.main(["--source-root", str(tmp_path)])

    assert result == 1
    assert "requires Python 3.12 or newer" in capsys.readouterr().err


def _install_manifest_parent_swap(
    monkeypatch: pytest.MonkeyPatch,
    root: Path,
    outside_parent: Path,
) -> tuple[Path, Any]:
    """Swap the manifest parent at the pathname-open race boundary."""

    manifest_path = root / checker.BOT_CONTRACT_MANIFEST_REL
    inside_parent = manifest_path.parent
    parked_parent = inside_parent.with_name(f"{inside_parent.name}-parked")
    real_open = bounded_input.os.open
    component_swapped = False

    def swap_to_outside() -> None:
        inside_parent.rename(parked_parent)
        inside_parent.symlink_to(outside_parent, target_is_directory=True)

    def restore() -> None:
        if inside_parent.is_symlink():
            inside_parent.unlink()
        if parked_parent.exists() and not inside_parent.exists():
            parked_parent.rename(inside_parent)

    def racing_open(
        path: str | bytes | os.PathLike[str] | os.PathLike[bytes],
        flags: int,
        mode: int = 0o777,
        *,
        dir_fd: int | None = None,
    ) -> int:
        nonlocal component_swapped
        path_value = os.fspath(path)
        if dir_fd is None and path_value == os.fspath(manifest_path):
            swap_to_outside()
            try:
                return real_open(path, flags, mode)
            finally:
                restore()
        if (
            dir_fd is not None
            and path_value == inside_parent.name
            and not component_swapped
        ):
            descriptor = real_open(path, flags, mode, dir_fd=dir_fd)
            swap_to_outside()
            component_swapped = True
            return descriptor
        if dir_fd is None:
            return real_open(path, flags, mode)
        return real_open(path, flags, mode, dir_fd=dir_fd)

    monkeypatch.setattr(bounded_input.os, "open", racing_open)
    return manifest_path, restore


def _committed_authority(commit: str) -> dict[str, Any]:
    manifest = json.loads(MANIFEST_PATH.read_text(encoding="utf-8"))
    binding = manifest["activation_source_binding"]
    if commit == checker.ACTIVATION_SOURCE_BOT_COMMIT:
        return binding
    assert commit == checker.RESEARCH_FIXTURE_BOT_COMMIT
    return binding["research_fixture"]["authority"]


def _source_objects(
    commit: str,
) -> tuple[bytes, dict[str, bytes], list[dict[str, str]]]:
    authority = _committed_authority(commit)
    proof = authority["git_object_proof"]
    commit = base64.b64decode(proof["commit"]["content_base64"], validate=True)
    trees = {
        entry["oid"]: base64.b64decode(entry["content_base64"], validate=True)
        for entry in proof["trees"]
    }
    return commit, trees, copy.deepcopy(authority["sources"])


def _generation_root(tmp_path: Path, fixture_raw: bytes) -> Path:
    fixture = tmp_path / checker.RESEARCH_INPUT_FIXTURE_REL
    fixture.parent.mkdir(parents=True)
    fixture.write_bytes(fixture_raw)
    return tmp_path


def _generate_with_current_sources(
    monkeypatch: pytest.MonkeyPatch,
    root: Path,
    execute: Callable[[Path, str], bytes] | None = None,
) -> dict[str, object]:
    monkeypatch.setattr(
        generator,
        "_commit_oid",
        lambda _repository, revision: revision,
    )
    monkeypatch.setattr(
        generator,
        "_source_objects",
        lambda _repository, commit, _paths: _source_objects(commit),
    )
    monkeypatch.setattr(
        generator,
        "_execute_bot_agent_catalog",
        execute or (lambda _repository, _commit: FIXTURE_PATH.read_bytes()),
    )
    with bounded_input.RootedDirectory(root) as opened_root:
        return generator._generate_binding(
            opened_root,
            Path("/unused/bot-repository"),
            checker.ACTIVATION_SOURCE_BOT_COMMIT,
        )


def test_generation_rejects_oversized_manifest_before_unbounded_read(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    manifest_path = tmp_path / checker.BOT_CONTRACT_MANIFEST_REL
    manifest_path.parent.mkdir(parents=True)
    with manifest_path.open("wb") as stream:
        stream.seek(checker.MAX_BOT_CONTRACT_MANIFEST_BYTES)
        stream.write(b"}")
    original_read_bytes = Path.read_bytes

    def reject_manifest_read_bytes(path: Path) -> bytes:
        if path == manifest_path:
            raise AssertionError("manifest used an unbounded read")
        return original_read_bytes(path)

    monkeypatch.setattr(Path, "read_bytes", reject_manifest_read_bytes)

    with bounded_input.RootedDirectory(tmp_path) as opened_root:
        with pytest.raises(ValueError, match="manifest is oversized"):
            generator._load_manifest(opened_root)


@pytest.mark.parametrize("check_flag", [[], ["--check"]])
def test_generator_rejects_initial_hardlinked_manifest_without_modifying_inode(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
    check_flag: list[str],
) -> None:
    manifest_path = tmp_path / checker.BOT_CONTRACT_MANIFEST_REL
    manifest_path.parent.mkdir(parents=True)
    outside_path = tmp_path.parent / f"{tmp_path.name}-hardlink.json"
    manifest_raw = MANIFEST_PATH.read_bytes()
    outside_path.write_bytes(manifest_raw)
    os.link(outside_path, manifest_path)
    monkeypatch.setattr(
        generator,
        "_generate_binding",
        lambda *_args: pytest.fail("hardlinked manifest reached generation"),
    )

    result = generator.main(
        [
            "--web-root",
            str(tmp_path),
            "--bot-repo",
            str(tmp_path),
            *check_flag,
        ]
    )

    assert result == 1
    assert outside_path.read_bytes() == manifest_raw


def test_generator_rejects_hardlink_added_during_generation(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    manifest_path = tmp_path / checker.BOT_CONTRACT_MANIFEST_REL
    manifest_path.parent.mkdir(parents=True)
    manifest_raw = MANIFEST_PATH.read_bytes()
    manifest_path.write_bytes(manifest_raw)
    outside_path = tmp_path.parent / f"{tmp_path.name}-racing-hardlink.json"
    binding = copy.deepcopy(
        json.loads(manifest_raw)["activation_source_binding"]
    )
    binding["racing_marker"] = True

    def add_hardlink(*_args: object) -> dict[str, object]:
        os.link(manifest_path, outside_path)
        return binding

    monkeypatch.setattr(generator, "_generate_binding", add_hardlink)

    result = generator.main(
        [
            "--web-root",
            str(tmp_path),
            "--bot-repo",
            str(tmp_path),
        ]
    )

    assert result == 1
    assert manifest_path.read_bytes() == manifest_raw
    assert outside_path.read_bytes() == manifest_raw


def test_check_mode_uses_bounded_final_manifest_reread(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    manifest_path = tmp_path / checker.BOT_CONTRACT_MANIFEST_REL
    manifest_path.parent.mkdir(parents=True)
    manifest_raw = MANIFEST_PATH.read_bytes()
    manifest_path.write_bytes(manifest_raw)
    binding = json.loads(manifest_raw)["activation_source_binding"]
    monkeypatch.setattr(
        generator,
        "_generate_binding",
        lambda _web_root, _bot_repository, _bot_commit: binding,
    )
    original_read_text = Path.read_text

    def reject_manifest_read_text(path: Path, *args: Any, **kwargs: Any) -> str:
        if path == manifest_path:
            raise AssertionError("check mode reread the manifest without a bound")
        return original_read_text(path, *args, **kwargs)

    monkeypatch.setattr(Path, "read_text", reject_manifest_read_text)

    assert (
        generator.main(
            [
                "--web-root",
                str(tmp_path),
                "--bot-repo",
                str(tmp_path),
                "--check",
            ]
        )
        == 0
    )


def test_check_mode_rejects_manifest_replacement_during_generation(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    manifest_path = tmp_path / checker.BOT_CONTRACT_MANIFEST_REL
    manifest_path.parent.mkdir(parents=True)
    manifest_raw = MANIFEST_PATH.read_bytes()
    manifest_path.write_bytes(manifest_raw)
    binding = json.loads(manifest_raw)["activation_source_binding"]

    def replace_manifest(
        _web_root: Path,
        _bot_repository: Path,
        _bot_commit: str,
    ) -> dict[str, object]:
        replacement = manifest_path.with_suffix(".replacement")
        replacement.write_bytes(manifest_raw)
        replacement.replace(manifest_path)
        return binding

    monkeypatch.setattr(generator, "_generate_binding", replace_manifest)

    assert (
        generator.main(
            [
                "--web-root",
                str(tmp_path),
                "--bot-repo",
                str(tmp_path),
                "--check",
            ]
        )
        == 1
    )


def test_check_mode_rejects_oversized_manifest_replacement_during_generation(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    manifest_path = tmp_path / checker.BOT_CONTRACT_MANIFEST_REL
    manifest_path.parent.mkdir(parents=True)
    manifest_raw = MANIFEST_PATH.read_bytes()
    manifest_path.write_bytes(manifest_raw)
    binding = json.loads(manifest_raw)["activation_source_binding"]

    def replace_manifest(
        _web_root: Path,
        _bot_repository: Path,
        _bot_commit: str,
    ) -> dict[str, object]:
        replacement = manifest_path.with_suffix(".replacement")
        with replacement.open("wb") as stream:
            stream.seek(checker.MAX_BOT_CONTRACT_MANIFEST_BYTES)
            stream.write(b"}")
        replacement.replace(manifest_path)
        return binding

    monkeypatch.setattr(generator, "_generate_binding", replace_manifest)

    assert (
        generator.main(
            [
                "--web-root",
                str(tmp_path),
                "--bot-repo",
                str(tmp_path),
                "--check",
            ]
        )
        == 1
    )


@pytest.mark.parametrize("check_flag", [[], ["--check"]])
def test_generator_rejects_manifest_symlink_escape_before_read(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
    check_flag: list[str],
) -> None:
    manifest_path = tmp_path / checker.BOT_CONTRACT_MANIFEST_REL
    manifest_path.parent.mkdir(parents=True)
    outside_path = tmp_path.parent / f"{tmp_path.name}-outside-manifest.json"
    outside_path.write_bytes(MANIFEST_PATH.read_bytes())
    manifest_path.symlink_to(outside_path)

    assert (
        generator.main(
            [
                "--web-root",
                str(tmp_path),
                "--bot-repo",
                str(tmp_path),
                *check_flag,
            ]
        )
        == 1
    )


def test_write_mode_rejects_manifest_symlink_replacement_before_write(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    manifest_path = tmp_path / checker.BOT_CONTRACT_MANIFEST_REL
    manifest_path.parent.mkdir(parents=True)
    manifest_raw = MANIFEST_PATH.read_bytes()
    manifest_path.write_bytes(manifest_raw)
    binding = json.loads(manifest_raw)["activation_source_binding"]
    outside_path = tmp_path.parent / f"{tmp_path.name}-outside-manifest.json"
    outside_raw = b"outside target must not change\n"
    outside_path.write_bytes(outside_raw)

    def replace_manifest(
        _web_root: Path,
        _bot_repository: Path,
        _bot_commit: str,
    ) -> dict[str, object]:
        manifest_path.unlink()
        manifest_path.symlink_to(outside_path)
        return binding

    monkeypatch.setattr(generator, "_generate_binding", replace_manifest)

    result = generator.main(
        [
            "--web-root",
            str(tmp_path),
            "--bot-repo",
            str(tmp_path),
        ]
    )

    assert result == 1
    assert outside_path.read_bytes() == outside_raw


def test_check_mode_rejects_manifest_parent_swap_during_open(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    manifest_path = tmp_path / checker.BOT_CONTRACT_MANIFEST_REL
    manifest_path.parent.mkdir(parents=True)
    manifest_raw = MANIFEST_PATH.read_bytes()
    manifest_path.write_bytes(manifest_raw)
    binding = json.loads(manifest_raw)["activation_source_binding"]
    outside_parent = tmp_path.parent / f"{tmp_path.name}-outside-check"
    outside_parent.mkdir()
    (outside_parent / manifest_path.name).write_bytes(manifest_raw)
    monkeypatch.setattr(
        generator,
        "_generate_binding",
        lambda _web_root, _bot_repository, _bot_commit: binding,
    )
    _, restore = _install_manifest_parent_swap(
        monkeypatch, tmp_path, outside_parent
    )

    try:
        result = generator.main(
            [
                "--web-root",
                str(tmp_path),
                "--bot-repo",
                str(tmp_path),
                "--check",
            ]
        )
    finally:
        restore()

    assert result == 1


def test_write_mode_rejects_manifest_parent_swap_without_touching_outside(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    manifest_path = tmp_path / checker.BOT_CONTRACT_MANIFEST_REL
    manifest_path.parent.mkdir(parents=True)
    manifest_raw = MANIFEST_PATH.read_bytes()
    manifest_path.write_bytes(manifest_raw)
    binding = copy.deepcopy(
        json.loads(manifest_raw)["activation_source_binding"]
    )
    binding["round_two_review_marker"] = True
    outside_parent = tmp_path.parent / f"{tmp_path.name}-outside-write"
    outside_parent.mkdir()
    outside_path = outside_parent / manifest_path.name
    outside_path.write_bytes(manifest_raw)
    monkeypatch.setattr(
        generator,
        "_generate_binding",
        lambda _web_root, _bot_repository, _bot_commit: binding,
    )
    _, restore = _install_manifest_parent_swap(
        monkeypatch, tmp_path, outside_parent
    )

    try:
        result = generator.main(
            [
                "--web-root",
                str(tmp_path),
                "--bot-repo",
                str(tmp_path),
            ]
        )
    finally:
        restore()

    assert result == 1
    assert outside_path.read_bytes() == manifest_raw


def test_generation_rejects_research_fixture_trailing_byte_drift(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    root = _generation_root(tmp_path, FIXTURE_PATH.read_bytes() + b"\n")

    with pytest.raises(ValueError, match="exact Bot-authoritative bytes"):
        _generate_with_current_sources(monkeypatch, root)


def test_generation_uses_authenticated_endpoint_execution_bytes(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    fixture_raw = FIXTURE_PATH.read_bytes()
    root = _generation_root(tmp_path, fixture_raw)
    calls: list[tuple[Path, str]] = []

    def execute(repository: Path, commit: str) -> bytes:
        calls.append((repository, commit))
        return fixture_raw

    binding = _generate_with_current_sources(monkeypatch, root, execute)

    assert calls == [
        (Path("/unused/bot-repository"), checker.RESEARCH_FIXTURE_BOT_COMMIT)
    ]
    execution = binding["research_fixture"]["execution"]
    assert execution == {
        "profile": "full_readiness_offline_v1",
        "method": "GET",
        "path": "/v1/agents",
        "authenticated": True,
        "network_allowed": False,
        "bot_commit": checker.RESEARCH_FIXTURE_BOT_COMMIT,
    }


def test_generation_rejects_research_fixture_ignored_field_drift(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    fixture = json.loads(FIXTURE_PATH.read_bytes())
    fixture["web_only"] = True
    drifted = json.dumps(fixture, separators=(",", ":")).encode("utf-8")
    root = _generation_root(tmp_path, drifted)

    with pytest.raises(ValueError, match="exact Bot-authoritative bytes"):
        _generate_with_current_sources(monkeypatch, root)


def test_generation_rejects_oversized_research_fixture(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    fixture = tmp_path / checker.RESEARCH_INPUT_FIXTURE_REL
    fixture.parent.mkdir(parents=True)
    with fixture.open("wb") as stream:
        stream.seek(checker.MAX_RESEARCH_INPUT_FIXTURE_BYTES)
        stream.write(b"}")

    with pytest.raises(ValueError, match="Research fixture is oversized"):
        _generate_with_current_sources(monkeypatch, tmp_path)


def test_generation_rejects_research_fixture_symlink(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    fixture = tmp_path / checker.RESEARCH_INPUT_FIXTURE_REL
    fixture.parent.mkdir(parents=True)
    outside = tmp_path.parent / f"{tmp_path.name}-outside-research.json"
    outside.write_bytes(FIXTURE_PATH.read_bytes())
    fixture.symlink_to(outside)

    with pytest.raises(ValueError, match="Research fixture cannot be read"):
        _generate_with_current_sources(monkeypatch, tmp_path)


def test_write_mode_rejects_oversized_generated_manifest(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    manifest_path = tmp_path / checker.BOT_CONTRACT_MANIFEST_REL
    manifest_path.parent.mkdir(parents=True)
    manifest_raw = MANIFEST_PATH.read_bytes()
    manifest_path.write_bytes(manifest_raw)
    oversized_binding = {
        "padding": "x" * checker.MAX_BOT_CONTRACT_MANIFEST_BYTES
    }
    monkeypatch.setattr(
        generator,
        "_generate_binding",
        lambda _web_root, _bot_repository, _bot_commit: oversized_binding,
    )

    result = generator.main(
        [
            "--web-root",
            str(tmp_path),
            "--bot-repo",
            str(tmp_path),
        ]
    )

    assert result == 1
    assert manifest_path.read_bytes() == manifest_raw
