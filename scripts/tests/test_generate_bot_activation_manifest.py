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
