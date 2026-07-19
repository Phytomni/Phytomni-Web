"""Contract tests for the NUL-safe scoped quality gate."""

from __future__ import annotations

import os
import shutil
import subprocess
from pathlib import Path

import pytest

pytestmark = pytest.mark.unit

ROOT = Path(__file__).resolve().parents[2]
SCOPED_GATE = ROOT / "scripts" / "scoped_gate.sh"
COMMON_GATE = ROOT / "scripts" / "gates" / "common.sh"


def _run_git(repo: Path, *args: str, check: bool = True) -> subprocess.CompletedProcess[str]:
    return subprocess.run(
        ["git", *args],
        cwd=repo,
        check=check,
        capture_output=True,
        text=True,
    )


def _write(repo: Path, relative: str, content: str = "content\n") -> Path:
    path = repo / relative
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(content, encoding="utf-8")
    return path


def _executable(path: Path, content: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(content, encoding="utf-8")
    path.chmod(0o755)


def _init_repo(tmp_path: Path) -> Path:
    repo = tmp_path / "repo"
    repo.mkdir()
    _run_git(repo, "init", "-q")
    _run_git(repo, "config", "user.email", "scoped-gate@example.invalid")
    _run_git(repo, "config", "user.name", "Scoped Gate")
    _run_git(repo, "checkout", "-q", "-b", "main")

    scoped_copy = repo / "scripts" / "scoped_gate.sh"
    scoped_copy.parent.mkdir(parents=True)
    shutil.copy2(SCOPED_GATE, scoped_copy)
    scoped_copy.chmod(0o755)
    common_copy = repo / "scripts" / "gates" / "common.sh"
    common_copy.parent.mkdir(parents=True, exist_ok=True)
    shutil.copy2(COMMON_GATE, common_copy)
    common_copy.chmod(0o755)
    _executable(
        repo / "scripts" / "run_gate_group.sh",
        "#!/usr/bin/env bash\n"
        "set -eu\n"
        "printf '%s\\0' \"group:$1\" >> \"${SCOPED_TOOL_LOG:?}\"\n",
    )
    _executable(
        repo / "scripts" / "validate_web_local.sh",
        "#!/usr/bin/env bash\n"
        "set -eu\n"
        "printf '%s\\0' full >> \"${SCOPED_TOOL_LOG:?}\"\n",
    )
    _write(repo, ".gitignore", "ignored.ts\n")
    _run_git(repo, "add", "-A")
    _run_git(repo, "commit", "-q", "-m", "initial")
    return repo


def _install_frontend_tools(repo: Path) -> None:
    body = (
        "#!/usr/bin/env bash\n"
        "set -eu\n"
        "printf '%s\\0' \"$(basename \"$0\")\" \"$@\" >> \"${SCOPED_TOOL_LOG:?}\"\n"
    )
    for name in ("prettier", "eslint", "vue-tsc", "vitest"):
        _executable(repo / "apps" / "web" / "node_modules" / ".bin" / name, body)


def _install_command_stubs(repo: Path, *names: str) -> Path:
    bin_dir = repo / "test-bin"
    for name in names:
        _executable(
            bin_dir / name,
            "#!/usr/bin/env bash\n"
            "set -eu\n"
            "printf '%s\\0' \"$(basename \"$0\")\" \"$@\" >> \"${SCOPED_TOOL_LOG:?}\"\n",
        )
    return bin_dir


def _run_gate(
    repo: Path,
    mode: str,
    *,
    extra_path: Path | None = None,
) -> subprocess.CompletedProcess[str]:
    log = repo / "tool.log"
    env = os.environ.copy()
    env["SCOPED_TOOL_LOG"] = str(log)
    if extra_path is not None:
        env["PATH"] = f"{extra_path}{os.pathsep}{env['PATH']}"
    return subprocess.run(
        [str(repo / "scripts" / "scoped_gate.sh"), mode],
        cwd=repo,
        env=env,
        check=False,
        capture_output=True,
        text=True,
    )


def _log(repo: Path) -> bytes:
    return (repo / "tool.log").read_bytes() if (repo / "tool.log").exists() else b""


def test_scope_partitioning_is_nul_safe_and_has_no_fallback_success() -> None:
    text = SCOPED_GATE.read_text(encoding="utf-8")

    assert "--name-only" in text
    assert "-z" in text
    assert "ls-files --others --exclude-standard" in text
    assert 'for path in "${changed_paths[@]}"' in text
    assert "eval " not in text
    assert "|| true" not in text


def test_rejects_unknown_mode(tmp_path: Path) -> None:
    repo = _init_repo(tmp_path)

    result = _run_gate(repo, "unknown")

    assert result.returncode == 2
    assert "usage:" in result.stderr


def test_empty_precommit_scope_skips_every_tool(tmp_path: Path) -> None:
    repo = _init_repo(tmp_path)

    result = _run_gate(repo, "precommit")

    assert result.returncode == 0
    assert "no changed files; skipping all tools" in result.stdout
    assert _log(repo) == b""


def test_precommit_uses_staged_acmr_paths_and_preserves_special_names(tmp_path: Path) -> None:
    repo = _init_repo(tmp_path)
    _install_frontend_tools(repo)
    fake_bin = _install_command_stubs(repo, "python3")
    staged_space = _write(repo, "apps/web/src/with space.ts")
    staged_newline = _write(repo, "apps/web/src/line\nname.ts")
    _write(repo, "apps/web/src/unstaged.ts")
    _run_git(
        repo,
        "add",
        "--",
        str(staged_space.relative_to(repo)),
        str(staged_newline.relative_to(repo)),
    )

    result = _run_gate(repo, "precommit", extra_path=fake_bin)

    assert result.returncode == 0, result.stderr
    log = _log(repo)
    assert b"with space.ts" in log
    assert b"line\nname.ts" in log
    assert b"unstaged.ts" not in log


def test_scoped_checker_failure_is_propagated_without_fallback_success(
    tmp_path: Path,
) -> None:
    repo = _init_repo(tmp_path)
    _install_frontend_tools(repo)
    fake_bin = _install_command_stubs(repo, "python3")
    _executable(
        fake_bin / "python3",
        "#!/usr/bin/env bash\n"
        "printf '%s\\0' checker-failure >> \"${SCOPED_TOOL_LOG:?}\"\n"
        "exit 2\n",
    )
    _write(repo, "apps/web/src/checker-failure.ts")
    _run_git(repo, "add", "-A")

    result = _run_gate(repo, "precommit", extra_path=fake_bin)

    assert result.returncode == 2
    assert b"checker-failure\0" in _log(repo)


def test_staged_rename_and_delete_use_only_the_new_acmr_path(tmp_path: Path) -> None:
    repo = _init_repo(tmp_path)
    _install_frontend_tools(repo)
    fake_bin = _install_command_stubs(repo, "python3")
    _write(repo, "apps/web/src/old.ts")
    _write(repo, "apps/web/src/deleted.ts")
    _run_git(repo, "add", "-A")
    _run_git(repo, "commit", "-q", "-m", "frontend files")
    _run_git(repo, "mv", "apps/web/src/old.ts", "apps/web/src/new.ts")
    _run_git(repo, "rm", "-q", "apps/web/src/deleted.ts")

    result = _run_gate(repo, "precommit", extra_path=fake_bin)

    assert result.returncode == 0, result.stderr
    log = _log(repo)
    assert b"new.ts" in log
    assert b"old.ts" not in log
    assert b"deleted.ts" not in log


def test_prepush_uses_upstream_and_unions_committed_worktree_and_untracked_paths(
    tmp_path: Path,
) -> None:
    repo = _init_repo(tmp_path)
    _install_frontend_tools(repo)
    fake_bin = _install_command_stubs(repo, "python3")
    _run_git(repo, "checkout", "-q", "-b", "release")
    _write(repo, "apps/web/src/committed.ts")
    _run_git(repo, "add", "-A")
    _run_git(repo, "commit", "-q", "-m", "committed frontend change")
    _run_git(repo, "branch", "--set-upstream-to=main", "release")
    _write(repo, "apps/web/src/committed.ts", "worktree change\n")
    _write(repo, "apps/web/src/untracked.ts")
    _write(repo, "ignored.ts")

    result = _run_gate(repo, "prepush", extra_path=fake_bin)

    assert result.returncode == 0, result.stderr
    assert "upstream" in result.stdout
    log = _log(repo)
    assert b"committed.ts" in log
    assert b"untracked.ts" in log
    assert b"ignored.ts" not in log


def test_prepush_falls_back_to_main_without_upstream(tmp_path: Path) -> None:
    repo = _init_repo(tmp_path)
    _run_git(repo, "checkout", "-q", "-b", "feature")
    _write(repo, "docs/change.md")
    _run_git(repo, "add", "-A")
    _run_git(repo, "commit", "-q", "-m", "documentation change")

    result = _run_gate(repo, "prepush")

    assert result.returncode == 0, result.stderr
    assert "merge-base" in result.stdout


def test_prepush_fails_closed_without_upstream_or_main(tmp_path: Path) -> None:
    repo = _init_repo(tmp_path)
    _run_git(repo, "branch", "-m", "trunk")

    result = _run_gate(repo, "prepush")

    assert result.returncode == 1
    assert "cannot resolve @{upstream} or merge-base HEAD main" in result.stderr


def test_policy_paths_force_the_full_gate(tmp_path: Path) -> None:
    repo = _init_repo(tmp_path)
    _write(repo, "Makefile", "policy change\n")
    _run_git(repo, "add", "Makefile")

    result = _run_gate(repo, "precommit")

    assert result.returncode == 0, result.stderr
    assert _log(repo) == b"full\0"
    assert "policy change forces full gate" in result.stdout


def test_related_vitest_specs_are_mapped_by_source_stem(tmp_path: Path) -> None:
    repo = _init_repo(tmp_path)
    _install_frontend_tools(repo)
    fake_bin = _install_command_stubs(repo, "python3")
    _write(repo, "apps/web/src/feature.ts")
    _write(repo, "apps/web/tests/unit/unrelated.spec.ts")
    _run_git(repo, "add", "-A")
    _run_git(repo, "commit", "-q", "-m", "unrelated test")
    _write(repo, "apps/web/tests/unit/feature.spec.ts")
    _run_git(repo, "add", "-A")

    result = _run_gate(repo, "precommit", extra_path=fake_bin)

    assert result.returncode == 0, result.stderr
    log = _log(repo)
    vitest_log = log.split(b"vitest\0", 1)[1]
    assert b"feature.spec.ts" in vitest_log
    assert b"unrelated.spec.ts" not in vitest_log


def test_go_foundation_paths_expand_to_both_server_groups(tmp_path: Path) -> None:
    repo = _init_repo(tmp_path)
    _write(repo, "apps/server/db/schema.go")
    _write(repo, "apps/server/service/task.go")
    _run_git(repo, "add", "-A")

    result = _run_gate(repo, "precommit")

    assert result.returncode == 0, result.stderr
    log = _log(repo)
    assert b"group:server-static" in log
    assert b"group:server-runtime" in log


def test_go_changes_run_affected_package_checks(tmp_path: Path) -> None:
    repo = _init_repo(tmp_path)
    fake_bin = _install_command_stubs(repo, "gofmt", "go")
    _write(repo, "apps/server/service/task.go")
    _write(repo, "apps/server/service/task_test.go")
    _run_git(repo, "add", "-A")

    result = _run_gate(repo, "precommit", extra_path=fake_bin)

    assert result.returncode == 0, result.stderr
    log = _log(repo)
    assert b"go\0vet\0./service\0" in log
    assert b"go\0test\0./service\0" in log
    assert b"group:server-static" not in log
