"""Contract tests for the root Makefile quality-gate entrypoints."""

from __future__ import annotations

from pathlib import Path

import pytest

pytestmark = pytest.mark.unit


@pytest.fixture
def repo_root() -> Path:
    return Path(__file__).resolve().parents[2]


def test_bootstrap_scoped_gate_is_fail_safe(repo_root: Path) -> None:
    text = (repo_root / "Makefile").read_text(encoding="utf-8")

    assert "scoped:" in text
    assert "full:" in text
    assert "./scripts/validate_web_local.sh" in text
    assert "--no-verify" not in text
    assert "|| true" not in text


def test_push_uses_keepalive_and_preserves_hooks(repo_root: Path) -> None:
    text = (repo_root / "Makefile").read_text(encoding="utf-8")

    assert "ServerAliveInterval=30" in text
    assert "ServerAliveCountMax=6" in text
    assert "GIT_SSH_COMMAND" in text
    assert "git push $(ARGS)" in text
    assert "PHYTOMNI_SCOPED_GATE" not in text


def test_help_explains_bootstrap_full_gate(repo_root: Path) -> None:
    text = (repo_root / "Makefile").read_text(encoding="utf-8")

    assert "temporary" in text.lower()
    assert "full gate" in text.lower()
