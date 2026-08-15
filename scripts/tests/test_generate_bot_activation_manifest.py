"""Tests for the offline Bot activation-manifest generator."""

from __future__ import annotations

import base64
import copy
import json
from pathlib import Path
from typing import Any

import pytest

from scripts import check_bot_web_activation as checker
from scripts import generate_bot_activation_manifest as generator


MANIFEST_PATH = checker.ROOT / checker.BOT_CONTRACT_MANIFEST_REL
FIXTURE_PATH = checker.ROOT / checker.RESEARCH_INPUT_FIXTURE_REL


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
    return generator._generate_binding(
        root,
        Path("/unused/bot-repository"),
        checker.ACTIVATION_SOURCE_BOT_COMMIT,
    )


def test_generation_rejects_oversized_manifest_before_unbounded_read(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    manifest_path = tmp_path / "contract-manifest.json"
    with manifest_path.open("wb") as stream:
        stream.seek(checker.MAX_BOT_CONTRACT_MANIFEST_BYTES)
        stream.write(b"}")
    original_read_bytes = Path.read_bytes

    def reject_manifest_read_bytes(path: Path) -> bytes:
        if path == manifest_path:
            raise AssertionError("manifest used an unbounded read")
        return original_read_bytes(path)

    monkeypatch.setattr(Path, "read_bytes", reject_manifest_read_bytes)

    with pytest.raises(ValueError, match="manifest is oversized"):
        generator._load_manifest(manifest_path)


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

    def reject_manifest_read(_path: Path) -> tuple[dict[str, Any], str]:
        raise AssertionError("unsafe manifest path was read")

    monkeypatch.setattr(generator, "_load_manifest", reject_manifest_read)

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


def test_generation_rejects_research_fixture_trailing_byte_drift(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    root = _generation_root(tmp_path, FIXTURE_PATH.read_bytes() + b"\n")

    with pytest.raises(ValueError, match="exact Bot-authoritative bytes"):
        _generate_with_current_sources(monkeypatch, root)


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
