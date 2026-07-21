"""Contract tests for the approved pinned quality-tool runners."""

from __future__ import annotations

import os
import shutil
import subprocess
import tarfile
from pathlib import Path

import pytest


pytestmark = pytest.mark.unit

ROOT = Path(__file__).resolve().parents[2]
RUNNERS = {
    "staticcheck": ROOT / "scripts" / "staticcheck_runner.sh",
    "shellcheck": ROOT / "scripts" / "shellcheck_runner.sh",
    "shfmt": ROOT / "scripts" / "shfmt_runner.sh",
    "actionlint": ROOT / "scripts" / "actionlint_runner.sh",
}
VERSIONS = {
    "staticcheck": "2025.1.1",
    "shellcheck": "0.10.0",
    "shfmt": "v3.10.0",
    "actionlint": "v1.7.4",
}
VERSION_ARGS = {
    "staticcheck": "-version",
    "shellcheck": "--version",
    "shfmt": "-version",
    "actionlint": "-version",
}
VERSION_OUTPUT = {
    "staticcheck": "staticcheck 2025.1.1 (0.6.1)",
    "shellcheck": "version: 0.10.0",
    "shfmt": "v3.10.0",
    "actionlint": "1.7.4",
}
DEPENDENCY_FILES = (
    ROOT / "apps/server/go.mod",
    ROOT / "apps/server/go.sum",
    ROOT / "apps/web/package.json",
    ROOT / "apps/web/package-lock.json",
)


def _write_executable(path: Path, content: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(content, encoding="utf-8")
    path.chmod(0o755)


def _platform() -> str:
    system = "linux" if os.name == "posix" else "unknown"
    machine = "amd64" if os.uname().machine in {"x86_64", "amd64"} else os.uname().machine
    return f"{system}-{machine}"


def _cache_bin(tmp_path: Path, tool: str) -> Path:
    return tmp_path / "cache" / f"{tool}-{VERSIONS[tool]}" / _platform() / tool


def _tool_stub(tool: str, *, output: str, log: Path) -> str:
    version_arg = VERSION_ARGS[tool]
    return (
        "#!/usr/bin/env bash\n"
        "set -euo pipefail\n"
        f"if [[ ${{1:-}} == {version_arg!r} ]]; then printf '%s\\n' {output!r}; exit 0; fi\n"
        f"printf '%s\\0' \"$@\" >> {str(log)!r}\n"
    )


def _run_runner(
    tmp_path: Path,
    tool: str,
    *,
    fake_bin: Path | None = None,
    extra_env: dict[str, str] | None = None,
    args: tuple[str, ...] = (),
    cwd: Path = ROOT,
) -> subprocess.CompletedProcess[str]:
    env = os.environ.copy()
    env["QUALITY_RUNNER_CACHE_ROOT"] = str(tmp_path / "cache")
    path_parts = [str(fake_bin)] if fake_bin is not None else []
    path_parts.extend(("/usr/bin", "/bin"))
    env["PATH"] = os.pathsep.join(path_parts)
    if extra_env:
        env.update(extra_env)
    return subprocess.run(
        [str(RUNNERS[tool]), *args],
        cwd=cwd,
        env=env,
        capture_output=True,
        text=True,
        check=False,
    )


def _install_fake_tool(fake_bin: Path, tmp_path: Path, tool: str, *, exact: bool) -> Path:
    log = tmp_path / f"{tool}.log"
    output = VERSION_OUTPUT[tool] if exact else f"{tool} 0.0.0"
    path = fake_bin / tool
    _write_executable(path, _tool_stub(tool, output=output, log=log))
    return log


def _archive_asset(tmp_path: Path, tool: str) -> Path:
    source = tmp_path / f"{tool}-source"
    if tool == "staticcheck":
        relative = Path("staticcheck/staticcheck")
        archive = tmp_path / "staticcheck.tar.gz"
        mode = "w:gz"
    elif tool == "shellcheck":
        relative = Path("shellcheck-v0.10.0/shellcheck")
        archive = tmp_path / "shellcheck.tar.xz"
        mode = "w:xz"
    elif tool == "actionlint":
        relative = Path("actionlint")
        archive = tmp_path / "actionlint.tar.gz"
        mode = "w:gz"
    else:
        raise AssertionError(f"{tool} is a raw binary asset")
    _write_executable(source, _tool_stub(tool, output=VERSION_OUTPUT[tool], log=tmp_path / "download.log"))
    with tarfile.open(archive, mode) as handle:
        handle.add(source, arcname=relative)
    return archive


def _raw_asset(tmp_path: Path, tool: str) -> Path:
    source = tmp_path / f"{tool}-raw"
    _write_executable(source, _tool_stub(tool, output=VERSION_OUTPUT[tool], log=tmp_path / "download.log"))
    return source


def _fake_curl(fake_bin: Path) -> None:
    _write_executable(
        fake_bin / "curl",
        "#!/usr/bin/env bash\n"
        "set -euo pipefail\n"
        "if [[ ${QUALITY_FAKE_CURL_FAILURE:-0} == 1 ]]; then exit 42; fi\n"
        "output=''\n"
        "while (($#)); do\n"
        "  if [[ $1 == --output || $1 == -o ]]; then output=$2; shift 2; else shift; fi\n"
        "done\n"
        "[[ -n $output ]]\n"
        "cp \"${QUALITY_FAKE_ASSET:?}\" \"$output\"\n",
    )


def _fake_sha256sum(fake_bin: Path) -> None:
    _write_executable(
        fake_bin / "sha256sum",
        "#!/usr/bin/env bash\n"
        "set -euo pipefail\n"
        "if [[ ${QUALITY_FAKE_CHECKSUM_FAILURE:-0} == 1 ]]; then exit 1; fi\n"
        "if [[ ${1:-} == --check ]]; then exit 0; fi\n"
        "exec /usr/bin/sha256sum \"$@\"\n",
    )


def test_runner_scripts_exist_are_executable_and_have_no_floating_install() -> None:
    for tool, path in RUNNERS.items():
        assert path.exists(), tool
        assert os.access(path, os.X_OK), tool
        text = path.read_text(encoding="utf-8")
        assert VERSIONS[tool] in text, tool
        assert "@latest" not in text, tool
        assert "GOTOOLCHAIN=auto" not in text, tool
        assert "go install" not in text, tool
        assert "eval " not in text, tool

    common = ROOT / "scripts" / "quality_runner_common.sh"
    assert common.exists()
    assert "sha256sum" in common.read_text(encoding="utf-8")
    assert "uname -m" in common.read_text(encoding="utf-8")


@pytest.mark.parametrize("tool", RUNNERS)
def test_exact_path_version_is_used_and_arguments_are_forwarded(
    tmp_path: Path, tool: str
) -> None:
    fake_bin = tmp_path / "bin"
    log = _install_fake_tool(fake_bin, tmp_path, tool, exact=True)
    before = {path: path.read_bytes() for path in DEPENDENCY_FILES}

    result = _run_runner(
        tmp_path,
        tool,
        fake_bin=fake_bin,
        args=("--sentinel", "value"),
    )

    assert result.returncode == 0, result.stderr
    assert log.read_bytes() == b"--sentinel\x00value\x00"
    assert not (tmp_path / "cache").exists()
    assert before == {path: path.read_bytes() for path in DEPENDENCY_FILES}


def test_runner_preserves_caller_working_directory(tmp_path: Path) -> None:
    fake_bin = tmp_path / "bin"
    cwd_log = tmp_path / "cwd.log"
    _write_executable(
        fake_bin / "staticcheck",
        "#!/usr/bin/env bash\n"
        "set -euo pipefail\n"
        "if [[ ${1:-} == -version ]]; then printf 'staticcheck 2025.1.1 (0.6.1)\\n'; exit 0; fi\n"
        f"printf '%s\\n' \"$PWD\" > {str(cwd_log)!r}\n",
    )

    result = _run_runner(
        tmp_path,
        "staticcheck",
        fake_bin=fake_bin,
        cwd=ROOT / "apps" / "server",
        args=("./graceful",),
    )

    assert result.returncode == 0, result.stderr
    assert cwd_log.read_text(encoding="utf-8").strip() == str(ROOT / "apps" / "server")


@pytest.mark.parametrize("tool", RUNNERS)
def test_mismatched_path_version_is_rejected_without_offline_fallback(
    tmp_path: Path, tool: str
) -> None:
    fake_bin = tmp_path / "bin"
    _install_fake_tool(fake_bin, tmp_path, tool, exact=False)

    result = _run_runner(
        tmp_path,
        tool,
        fake_bin=fake_bin,
        extra_env={"QUALITY_RUNNER_OFFLINE": "1"},
    )

    assert result.returncode != 0
    assert "PATH" in result.stderr
    assert "exact" in result.stderr.lower()


@pytest.mark.parametrize("tool", RUNNERS)
def test_unapproved_platform_fails_closed_even_with_exact_path_version(
    tmp_path: Path, tool: str
) -> None:
    fake_bin = tmp_path / "bin"
    _install_fake_tool(fake_bin, tmp_path, tool, exact=True)
    _write_executable(
        fake_bin / "uname",
        "#!/usr/bin/env bash\n"
        "set -euo pipefail\n"
        "if [[ ${1:-} == -s ]]; then printf 'Darwin\\n'; else printf 'arm64\\n'; fi\n",
    )

    result = _run_runner(
        tmp_path,
        tool,
        fake_bin=fake_bin,
        extra_env={"QUALITY_RUNNER_OFFLINE": "1"},
    )

    assert result.returncode != 0
    assert "no approved" in result.stderr.lower()


@pytest.mark.parametrize("tool", RUNNERS)
def test_exact_cache_wins_over_mismatched_path(tmp_path: Path, tool: str) -> None:
    fake_bin = tmp_path / "bin"
    path_log = _install_fake_tool(fake_bin, tmp_path, tool, exact=False)
    cache_log = tmp_path / f"{tool}-cache.log"
    cached = _cache_bin(tmp_path, tool)
    _write_executable(
        cached,
        _tool_stub(tool, output=VERSION_OUTPUT[tool], log=cache_log),
    )

    result = _run_runner(tmp_path, tool, fake_bin=fake_bin, args=("--cached",))

    assert result.returncode == 0, result.stderr
    assert cache_log.read_bytes() == b"--cached\x00"
    assert not path_log.exists()


@pytest.mark.parametrize("tool", RUNNERS)
def test_wrong_cache_version_fails_closed(tmp_path: Path, tool: str) -> None:
    cached = _cache_bin(tmp_path, tool)
    _write_executable(
        cached,
        _tool_stub(tool, output=f"{tool} 0.0.0", log=tmp_path / "wrong.log"),
    )

    result = _run_runner(
        tmp_path,
        tool,
        extra_env={"QUALITY_RUNNER_OFFLINE": "1"},
    )

    assert result.returncode != 0
    assert "cache" in result.stderr.lower()
    assert "unexpected" in result.stderr.lower()


@pytest.mark.parametrize("tool", ("staticcheck", "shellcheck", "actionlint"))
def test_download_success_populates_versioned_cache(tmp_path: Path, tool: str) -> None:
    fake_bin = tmp_path / "bin"
    asset = _archive_asset(tmp_path, tool)
    _fake_curl(fake_bin)
    _fake_sha256sum(fake_bin)

    result = _run_runner(
        tmp_path,
        tool,
        fake_bin=fake_bin,
        extra_env={"QUALITY_FAKE_ASSET": str(asset)},
        args=("--downloaded",),
    )

    assert result.returncode == 0, result.stderr
    cached = _cache_bin(tmp_path, tool)
    assert cached.is_file()
    assert cached.stat().st_mode & 0o111


def test_shfmt_download_success_populates_versioned_cache(tmp_path: Path) -> None:
    fake_bin = tmp_path / "bin"
    asset = _raw_asset(tmp_path, "shfmt")
    _fake_curl(fake_bin)
    _fake_sha256sum(fake_bin)

    result = _run_runner(
        tmp_path,
        "shfmt",
        fake_bin=fake_bin,
        extra_env={"QUALITY_FAKE_ASSET": str(asset)},
        args=("--downloaded",),
    )

    assert result.returncode == 0, result.stderr
    assert _cache_bin(tmp_path, "shfmt").is_file()


@pytest.mark.parametrize("tool", RUNNERS)
def test_checksum_failure_never_populates_cache(tmp_path: Path, tool: str) -> None:
    fake_bin = tmp_path / "bin"
    asset = _raw_asset(tmp_path, tool) if tool == "shfmt" else _archive_asset(tmp_path, tool)
    _fake_curl(fake_bin)
    _fake_sha256sum(fake_bin)

    result = _run_runner(
        tmp_path,
        tool,
        fake_bin=fake_bin,
        extra_env={
            "QUALITY_FAKE_ASSET": str(asset),
            "QUALITY_FAKE_CHECKSUM_FAILURE": "1",
        },
    )

    assert result.returncode != 0
    assert "checksum" in result.stderr.lower()
    assert not _cache_bin(tmp_path, tool).exists()


@pytest.mark.parametrize("tool", RUNNERS)
def test_installer_failure_is_not_masked(tmp_path: Path, tool: str) -> None:
    fake_bin = tmp_path / "bin"
    _fake_curl(fake_bin)

    result = _run_runner(
        tmp_path,
        tool,
        fake_bin=fake_bin,
        extra_env={"QUALITY_FAKE_CURL_FAILURE": "1"},
    )

    assert result.returncode != 0
    assert "download" in result.stderr.lower()
    assert not _cache_bin(tmp_path, tool).exists()


def test_missing_archive_prerequisite_fails_closed(tmp_path: Path) -> None:
    fake_bin = tmp_path / "bin"
    asset = _archive_asset(tmp_path, "staticcheck")
    _fake_curl(fake_bin)
    _fake_sha256sum(fake_bin)
    _write_executable(fake_bin / "tar", "#!/usr/bin/env bash\nexit 127\n")

    result = _run_runner(
        tmp_path,
        "staticcheck",
        fake_bin=fake_bin,
        extra_env={"QUALITY_FAKE_ASSET": str(asset)},
    )

    assert result.returncode != 0
    assert "tar" in result.stderr.lower()
    assert not _cache_bin(tmp_path, "staticcheck").exists()


def test_dependency_manifests_are_not_modified_by_runner_resolution(tmp_path: Path) -> None:
    fake_bin = tmp_path / "bin"
    before = {path: path.read_bytes() for path in DEPENDENCY_FILES}
    for tool in RUNNERS:
        _install_fake_tool(fake_bin, tmp_path, tool, exact=True)
        result = _run_runner(tmp_path, tool, fake_bin=fake_bin, args=("--probe",))
        assert result.returncode == 0, result.stderr
    assert before == {path: path.read_bytes() for path in DEPENDENCY_FILES}
