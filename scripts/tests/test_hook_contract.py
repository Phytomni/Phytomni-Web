"""Contract tests for the staged and full Git hooks."""

from __future__ import annotations

import os
import shutil
import stat
import subprocess
from pathlib import Path

import pytest

pytestmark = pytest.mark.unit

ROOT = Path(__file__).resolve().parents[2]
HOOKS = ROOT / ".githooks"
INSTALLER = ROOT / "scripts" / "install_git_hooks.sh"


def _run_git(repo: Path, *args: str) -> subprocess.CompletedProcess[str]:
    return subprocess.run(
        ["git", *args],
        cwd=repo,
        check=True,
        capture_output=True,
        text=True,
    )


def _write_executable(path: Path, content: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(content, encoding="utf-8")
    path.chmod(0o755)


def _copy_hooks(repo: Path) -> None:
    hooks = repo / ".githooks"
    hooks.mkdir(parents=True, exist_ok=True)
    for name in ("pre-commit", "pre-push"):
        shutil.copy2(HOOKS / name, hooks / name)
        (hooks / name).chmod(0o755)


def _init_hook_repo(tmp_path: Path) -> Path:
    repo = tmp_path / "repo"
    repo.mkdir()
    _run_git(repo, "init", "-q")
    _run_git(repo, "config", "user.email", "hook-contract@example.invalid")
    _run_git(repo, "config", "user.name", "Hook Contract")
    _copy_hooks(repo)
    return repo


def _stub_bin(repo: Path, *, secret_exit: int = 0) -> Path:
    bin_dir = repo / "bin"
    _write_executable(
        bin_dir / "python3",
        "#!/usr/bin/env sh\n"
        "printf 'python3 %s\\n' \"$*\" >> \"${HOOK_LOG:?}\"\n"
        f"exit {secret_exit}\n",
    )
    _write_executable(
        bin_dir / "python",
        "#!/usr/bin/env sh\n"
        "printf 'python %s\\n' \"$*\" >> \"${HOOK_LOG:?}\"\n"
        "exit 0\n",
    )
    _write_executable(
        bin_dir / "make",
        "#!/usr/bin/env sh\n"
        "printf 'make %s\\n' \"$*\" >> \"${HOOK_LOG:?}\"\n"
        "exit 0\n",
    )
    return bin_dir


def _run_hook(
    repo: Path,
    hook: str,
    *,
    env_value: str | None = None,
    secret_exit: int = 0,
) -> tuple[subprocess.CompletedProcess[str], list[str]]:
    log = repo / "hook.log"
    bin_dir = _stub_bin(repo, secret_exit=secret_exit)
    env = os.environ.copy()
    env["HOOK_LOG"] = str(log)
    env["PATH"] = f"{bin_dir}{os.pathsep}{env['PATH']}"
    if env_value is None:
        env.pop("PHYTOMNI_SCOPED_GATE", None)
    else:
        env["PHYTOMNI_SCOPED_GATE"] = env_value
    result = subprocess.run(
        [str(repo / ".githooks" / hook)],
        cwd=repo,
        env=env,
        check=False,
        capture_output=True,
        text=True,
    )
    lines = log.read_text(encoding="utf-8").splitlines() if log.exists() else []
    return result, lines


def test_hooks_are_executable_and_do_not_advertise_bypasses() -> None:
    for name in ("pre-commit", "pre-push"):
        mode = (HOOKS / name).stat().st_mode
        assert mode & stat.S_IXUSR

    text = "\n".join(
        (HOOKS / name).read_text(encoding="utf-8") for name in ("pre-commit", "pre-push")
    ) + INSTALLER.read_text(encoding="utf-8")
    assert "--no-verify" not in text
    assert "|| true" not in text


def test_precommit_runs_secret_scan_before_staged_quality(tmp_path: Path) -> None:
    repo = _init_hook_repo(tmp_path)

    result, lines = _run_hook(repo, "pre-commit")

    assert result.returncode == 0, result.stderr
    assert lines == [
        "python3 scripts/scan_secrets.py --staged",
        "make precommit",
    ]


def test_precommit_stops_before_quality_when_secret_scan_fails(tmp_path: Path) -> None:
    repo = _init_hook_repo(tmp_path)

    result, lines = _run_hook(repo, "pre-commit", secret_exit=7)

    assert result.returncode == 7
    assert lines == ["python3 scripts/scan_secrets.py --staged"]


def test_prepush_defaults_to_full_gate(tmp_path: Path) -> None:
    repo = _init_hook_repo(tmp_path)

    result, lines = _run_hook(repo, "pre-push")

    assert result.returncode == 0, result.stderr
    assert lines == ["make full"]


def test_prepush_scoped_gate_requires_explicit_opt_in(tmp_path: Path) -> None:
    repo = _init_hook_repo(tmp_path)

    result, lines = _run_hook(repo, "pre-push", env_value="1")

    assert result.returncode == 0, result.stderr
    assert lines == ["make prepush"]


def test_prepush_rejects_unknown_scoped_gate_value(tmp_path: Path) -> None:
    repo = _init_hook_repo(tmp_path)

    result, lines = _run_hook(repo, "pre-push", env_value="yes")

    assert result.returncode == 2
    assert lines == []
    assert "must be unset or exactly 1" in result.stderr


def test_installer_is_idempotent_and_sets_all_required_modes(tmp_path: Path) -> None:
    repo = _init_hook_repo(tmp_path)
    scripts = repo / "scripts"
    scripts.mkdir()
    shutil.copy2(INSTALLER, scripts / "install_git_hooks.sh")
    (scripts / "install_git_hooks.sh").chmod(0o755)
    for name in (
        "scan_secrets.py",
        "scoped_gate.sh",
        "run_gate_group.sh",
        "validate_web_local.sh",
    ):
        _write_executable(scripts / name, "#!/usr/bin/env sh\nexit 0\n")

    first = subprocess.run(
        [str(scripts / "install_git_hooks.sh")],
        cwd=repo,
        check=False,
        capture_output=True,
        text=True,
    )
    second = subprocess.run(
        [str(scripts / "install_git_hooks.sh")],
        cwd=repo,
        check=False,
        capture_output=True,
        text=True,
    )

    assert first.returncode == 0, first.stderr
    assert second.returncode == 0, second.stderr
    assert _run_git(repo, "config", "--get", "core.hooksPath").stdout.strip() == ".githooks"
    for path in (
        repo / ".githooks" / "pre-commit",
        repo / ".githooks" / "pre-push",
        scripts / "scan_secrets.py",
        scripts / "scoped_gate.sh",
        scripts / "run_gate_group.sh",
        scripts / "validate_web_local.sh",
    ):
        assert path.stat().st_mode & stat.S_IXUSR
    assert "PHYTOMNI_SCOPED_GATE=1" in second.stdout
