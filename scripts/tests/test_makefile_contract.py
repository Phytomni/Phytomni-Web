"""Contract tests for the root Makefile quality-gate entrypoints."""

from __future__ import annotations

from pathlib import Path

import pytest

pytestmark = pytest.mark.unit


@pytest.fixture
def repo_root() -> Path:
    return Path(__file__).resolve().parents[2]


def test_make_targets_delegate_to_the_shared_scoped_gate(repo_root: Path) -> None:
    text = (repo_root / "Makefile").read_text(encoding="utf-8")

    assert ".PHONY: help scoped precommit prepush full push" in text
    assert "scoped:\n\t@./scripts/scoped_gate.sh scoped" in text
    assert "precommit:\n\t@./scripts/scoped_gate.sh precommit" in text
    assert "prepush:\n\t@./scripts/scoped_gate.sh prepush" in text
    assert "full:\n\t@./scripts/validate_web_local.sh" in text
    assert "--no-verify" not in text
    assert "|| true" not in text


def test_push_uses_keepalive_and_preserves_hooks(repo_root: Path) -> None:
    text = (repo_root / "Makefile").read_text(encoding="utf-8")

    assert "ServerAliveInterval=30" in text
    assert "ServerAliveCountMax=6" in text
    assert "GIT_SSH_COMMAND" in text
    assert "git push $(ARGS)" in text


def test_help_explains_scoped_and_full_gate_modes(repo_root: Path) -> None:
    text = (repo_root / "Makefile").read_text(encoding="utf-8")
    lowered = text.lower()

    assert "staged index" in lowered
    assert "BASE..work-tree" in text
    assert "alias of prepush" in text
    assert "full gate" in text.lower()
