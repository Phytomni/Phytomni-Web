"""Git-range and path-with-spaces contracts for the secret scanner."""

from __future__ import annotations

import subprocess

import pytest

import scan_secrets
from scan_secrets import parse_diff_path

pytestmark = pytest.mark.unit


def test_parse_diff_path_preserves_quoted_spaces() -> None:
    header = 'diff --git "a/path with spaces" "b/path with spaces"'

    assert parse_diff_path(header) == "path with spaces"


def test_scan_git_range_reports_deleted_sensitive_paths_and_modified_secrets(
    tmp_path, monkeypatch
) -> None:
    repo = tmp_path / "repo"
    repo.mkdir()

    def git(*args: str) -> None:
        subprocess.run(["git", *args], cwd=repo, check=True, capture_output=True)

    git("init", "-q")
    git("config", "user.email", "scan@example.invalid")
    git("config", "user.name", "Secret Scan")
    (repo / "README.md").write_text("initial\n", encoding="utf-8")
    git("add", "README.md")
    git("commit", "-q", "-m", "initial")
    base = subprocess.run(
        ["git", "rev-parse", "HEAD"],
        cwd=repo,
        check=True,
        capture_output=True,
        text=True,
    ).stdout.strip()

    secret_value = "q9X7m2k4nR8t" + "P1bL5wF"
    (repo / "notes with spaces.txt").write_text(
        f'password = "{secret_value}"\n', encoding="utf-8"
    )
    (repo / "credentials.json").write_text("{}\n", encoding="utf-8")
    git("add", "notes with spaces.txt", "credentials.json")
    git("commit", "-q", "-m", "add temporary data")
    (repo / "notes with spaces.txt").write_text("password = safe\n", encoding="utf-8")
    git("add", "notes with spaces.txt")
    git("commit", "-q", "-m", "replace temporary value")
    git("rm", "-q", "credentials.json")
    git("commit", "-q", "-m", "remove credential file")

    monkeypatch.chdir(repo)
    findings = scan_secrets.scan_git_range(f"{base}..HEAD")

    assert any(finding.rule == "secret-assignment" for finding in findings)
    assert any(
        finding.rule == "sensitive-path" and finding.path == "credentials.json"
        for finding in findings
    )


def test_invalid_range_returns_controlled_cli_error() -> None:
    assert scan_secrets.main(["--range", "missing-base..missing-head"]) == 2
