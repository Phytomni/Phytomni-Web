#!/usr/bin/env python3
"""Generate the offline activation source binding from one Bot Git commit."""

from __future__ import annotations

import argparse
import base64
import binascii
import hashlib
import io
import json
import os
import re
import selectors
import shutil
import subprocess
import sys
import tarfile
import tempfile
import time
from pathlib import Path
from pathlib import PurePosixPath
from typing import Any, NamedTuple

if __package__ in {None, ""}:
    sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from scripts import check_bot_web_activation as checker
from scripts.bounded_input import (
    FileIdentity,
    InputChangedError,
    InputTooLargeError,
    RootedDirectory,
)
from scripts.strict_json import StrictJsonError, loads_strict_json

BOT_CATALOG_PROFILE = "full_readiness_offline_v1"
MAX_BOT_ARCHIVE_BYTES = 64 * 1024 * 1024
MAX_BOT_ARCHIVE_FILES = 8_192
MAX_CATALOG_RUNNER_OUTPUT_BYTES = 256 * 1024
MAX_BOT_GIT_OBJECT_BYTES = 4 * 1024 * 1024
GIT_TIMEOUT_SECONDS = 30
RUNNER_TIMEOUT_SECONDS = 60
BOT_CATALOG_ARCHIVE_PATHS = (
    "pyproject.toml",
    "environment.yml",
    "conftest.py",
    "src",
    "tests/__init__.py",
    "tests/support/__init__.py",
    "tests/support/outbound_fakes.py",
)


class _ManifestSnapshot(NamedTuple):
    value: dict[str, Any]
    raw: bytes
    identity: FileIdentity


def _run_limited(
    command: list[str],
    *,
    max_stdout_bytes: int,
    timeout_seconds: int,
    environment: dict[str, str] | None = None,
) -> bytes:
    """Run one child with bounded stdout and unconditional process cleanup."""

    try:
        process = subprocess.Popen(
            command,
            stdin=subprocess.DEVNULL,
            stdout=subprocess.PIPE,
            stderr=subprocess.DEVNULL,
            env=environment,
        )
    except OSError as exc:
        raise ValueError("cannot start required activation command") from exc
    output = bytearray()
    selector = selectors.DefaultSelector()
    try:
        if process.stdout is None:
            raise ValueError("cannot capture required activation command")
        selector.register(process.stdout, selectors.EVENT_READ)
        deadline = time.monotonic() + timeout_seconds
        while selector.get_map():
            remaining = deadline - time.monotonic()
            if remaining <= 0:
                raise TimeoutError
            for key, _events in selector.select(remaining):
                chunk = os.read(key.fd, min(64 * 1024, max_stdout_bytes + 1))
                if not chunk:
                    selector.unregister(key.fileobj)
                    continue
                output.extend(chunk)
                if len(output) > max_stdout_bytes:
                    raise InputTooLargeError
        remaining = deadline - time.monotonic()
        if remaining <= 0:
            raise TimeoutError
        if process.wait(timeout=remaining) != 0:
            raise ValueError("required activation command failed")
        return bytes(output)
    except (InputTooLargeError, TimeoutError) as exc:
        raise ValueError("required activation command exceeded its bound") from exc
    finally:
        selector.close()
        if process.poll() is None:
            process.kill()
        try:
            process.wait(timeout=5)
        except subprocess.TimeoutExpired:
            pass


def _git(repository: Path, *arguments: str) -> bytes:
    try:
        return _run_limited(
            ["git", "-C", str(repository), *arguments],
            max_stdout_bytes=MAX_BOT_GIT_OBJECT_BYTES,
            timeout_seconds=GIT_TIMEOUT_SECONDS,
        )
    except ValueError as exc:
        raise ValueError("cannot read the requested Bot Git object") from exc


def _commit_oid(repository: Path, revision: str) -> str:
    raw = _git(repository, "rev-parse", "--verify", f"{revision}^{{commit}}")
    try:
        oid = raw.decode("ascii").strip()
    except UnicodeDecodeError as exc:
        raise ValueError("Bot commit identity is malformed") from exc
    if re.fullmatch(r"[0-9a-f]{40}", oid) is None:
        raise ValueError("Bot commit identity is malformed")
    return oid


def _root_tree_oid(commit_payload: bytes) -> str:
    headers = [
        line
        for line in commit_payload.split(b"\n\n", 1)[0].splitlines()
        if line.startswith(b"tree ")
    ]
    if len(headers) != 1 or re.fullmatch(rb"tree [0-9a-f]{40}", headers[0]) is None:
        raise ValueError("Bot commit tree is malformed")
    return headers[0][5:].decode("ascii")


def _source_objects(
    repository: Path,
    commit_oid: str,
    source_paths: dict[str, str],
) -> tuple[bytes, dict[str, bytes], list[dict[str, str]]]:
    commit_payload = _git(repository, "cat-file", "commit", commit_oid)
    if checker._git_object_oid("commit", commit_payload) != commit_oid:
        raise ValueError("Bot commit object does not match its identity")
    root_tree = _root_tree_oid(commit_payload)
    trees: dict[str, bytes] = {}
    entries: list[dict[str, str]] = []

    for role, path in source_paths.items():
        current_tree = root_tree
        blob_oid: str | None = None
        for index, part in enumerate(path.split("/")):
            tree_payload = trees.get(current_tree)
            if tree_payload is None:
                tree_payload = _git(repository, "cat-file", "tree", current_tree)
                if checker._git_object_oid("tree", tree_payload) != current_tree:
                    raise ValueError("Bot tree object does not match its identity")
                trees[current_tree] = tree_payload
            tree = checker._parse_git_tree(tree_payload)
            if tree is None or part not in tree:
                raise ValueError("Bot source path is absent from the pinned commit")
            mode, oid = tree[part]
            if index == len(path.split("/")) - 1:
                if mode not in {"100644", "100755"}:
                    raise ValueError("Bot source path is not a regular blob")
                blob_oid = oid
            else:
                if mode not in {"40000", "040000"}:
                    raise ValueError("Bot source path crosses a non-tree object")
                current_tree = oid
        if blob_oid is None:
            raise ValueError("Bot source path did not resolve to a blob")
        payload = _git(repository, "cat-file", "blob", blob_oid)
        if checker._git_object_oid("blob", payload) != blob_oid:
            raise ValueError("Bot source blob does not match its identity")
        entries.append(
            {
                "role": role,
                "path": path,
                "git_blob_oid": blob_oid,
                "sha256": hashlib.sha256(payload).hexdigest(),
                "content_base64": base64.b64encode(payload).decode("ascii"),
            }
        )
    return commit_payload, trees, entries


def _generate_source_authority(
    repository: Path,
    revision: str,
    expected_commit: str,
    source_paths: dict[str, str],
) -> tuple[dict[str, Any], dict[str, bytes]]:
    commit_oid = _commit_oid(repository, revision)
    if commit_oid != expected_commit:
        raise ValueError("Bot commit is not the accepted source SHA")
    commit_payload, trees, source_entries = _source_objects(
        repository, commit_oid, source_paths
    )
    sources = {
        entry["role"]: base64.b64decode(entry["content_base64"], validate=True)
        for entry in source_entries
    }
    return (
        {
            "schema_version": 1,
            "bot_commit": commit_oid,
            "object_format": "sha1",
            "git_object_proof": {
                "commit": {
                    "oid": commit_oid,
                    "content_base64": base64.b64encode(commit_payload).decode("ascii"),
                },
                "trees": [
                    {
                        "oid": oid,
                        "content_base64": base64.b64encode(payload).decode("ascii"),
                    }
                    for oid, payload in sorted(trees.items())
                ],
            },
            "sources": source_entries,
        },
        sources,
    )


def _safe_archive_path(name: str) -> PurePosixPath | None:
    path = PurePosixPath(name)
    if (
        path.is_absolute()
        or not path.parts
        or any(part in {"", ".", ".."} for part in path.parts)
    ):
        return None
    if (
        path.as_posix() in {"pyproject.toml", "environment.yml", "conftest.py"}
        or path.parts[0] == "src"
    ):
        return path
    allowed_test_entries = {
        "tests",
        "tests/__init__.py",
        "tests/support",
        "tests/support/__init__.py",
        "tests/support/outbound_fakes.py",
    }
    return path if path.as_posix() in allowed_test_entries else None


def _extract_bot_archive(raw: bytes, destination: Path) -> None:
    count = 0
    total = 0
    try:
        archive = tarfile.open(fileobj=io.BytesIO(raw), mode="r:")
    except tarfile.TarError as exc:
        raise ValueError("fixed Bot source archive is malformed") from exc
    with archive:
        for member in archive:
            count += 1
            total += max(member.size, 0)
            relative = _safe_archive_path(member.name)
            if (
                count > MAX_BOT_ARCHIVE_FILES
                or total > MAX_BOT_ARCHIVE_BYTES
                or relative is None
                or not (member.isdir() or member.isfile())
            ):
                raise ValueError("fixed Bot source archive is unsafe")
            target = destination.joinpath(*relative.parts)
            if member.isdir():
                target.mkdir(parents=True, exist_ok=True)
                continue
            target.parent.mkdir(parents=True, exist_ok=True)
            source = archive.extractfile(member)
            if source is None:
                raise ValueError("fixed Bot source archive is malformed")
            payload = source.read(member.size + 1)
            if len(payload) != member.size:
                raise ValueError("fixed Bot source archive is malformed")
            target.write_bytes(payload)


def _bot_python(repository: Path) -> Path:
    candidate = repository.resolve() / ".venv" / "bin" / "python"
    try:
        candidate.stat()
    except OSError as exc:
        raise ValueError("Bot Python environment is unavailable") from exc
    if not candidate.is_file() or not os.access(candidate, os.X_OK):
        raise ValueError("Bot Python environment is unavailable")
    return candidate


def _verify_archive_execution_contract(
    source_root: Path,
    authenticated_sources: dict[str, bytes],
) -> None:
    for role in ("project_definition", "dependency_lock"):
        expected = authenticated_sources.get(role)
        if expected is None:
            raise ValueError("fixed Bot execution contract is incomplete")
        relative = checker.RESEARCH_FIXTURE_SOURCE_PATHS[role]
        try:
            actual = (source_root / relative).read_bytes()
        except OSError as exc:
            raise ValueError("fixed Bot execution contract is unavailable") from exc
        if actual != expected:
            raise ValueError("fixed Bot execution contract is not authenticated")


def _uv_binary() -> str:
    binary = shutil.which("uv")
    if binary is None:
        raise ValueError("uv is required to build the fixed Bot environment")
    return binary


def _isolated_environment(source_root: Path, bot_python: Path) -> Path:
    (source_root / ".runner-tmp").mkdir(exist_ok=True)
    if not (source_root / "uv.lock").is_file():
        return bot_python
    uv_binary = _uv_binary()
    environment_root = source_root / ".venv"
    environment = {
        "PATH": f"{Path(uv_binary).parent}:/usr/bin:/bin",
        "TMPDIR": str(source_root / ".runner-tmp"),
        "UV_NO_MANAGED_PYTHON": "1",
    }
    _run_limited(
        [
            uv_binary,
            "sync",
            "--offline",
            "--frozen",
            "--no-install-project",
            "--no-dev",
            "--project",
            str(source_root),
            "--python",
            str(bot_python),
        ],
        max_stdout_bytes=MAX_CATALOG_RUNNER_OUTPUT_BYTES,
        timeout_seconds=RUNNER_TIMEOUT_SECONDS,
        environment=environment,
    )
    python = environment_root / "bin" / "python"
    if not python.is_file() or not os.access(python, os.X_OK):
        raise ValueError("fixed Bot environment is unavailable")
    return python


def _assert_isolated_environment(environment_root: Path, source_root: Path) -> None:
    site_packages = environment_root / "lib"
    for entry in site_packages.glob("python*/site-packages/*.pth"):
        try:
            lines = entry.read_text(encoding="utf-8").splitlines()
        except OSError as exc:
            raise ValueError("fixed Bot environment cannot be inspected") from exc
        if any(line and line != "import _virtualenv" for line in lines):
            raise ValueError("fixed Bot environment contains mutable path injection")
    if not (source_root / "src" / "mcp_server_phytomni").is_dir():
        raise ValueError("fixed Bot source package is unavailable")


def _execute_bot_agent_catalog(
    repository: Path,
    commit: str,
    authenticated_sources: dict[str, bytes],
) -> bytes:
    try:
        archive = _run_limited(
            [
                "git",
                "-C",
                str(repository),
                "archive",
                "--format=tar",
                commit,
                "--",
                *BOT_CATALOG_ARCHIVE_PATHS,
            ],
            max_stdout_bytes=MAX_BOT_ARCHIVE_BYTES,
            timeout_seconds=GIT_TIMEOUT_SECONDS,
        )
    except ValueError as exc:
        raise ValueError("cannot archive the fixed Bot commit") from exc

    runner = Path(__file__).with_name("run_pinned_bot_agent_catalog.py")
    with tempfile.TemporaryDirectory(prefix="pinned-bot-catalog-") as directory:
        source_root = Path(directory)
        _extract_bot_archive(archive, source_root)
        _verify_archive_execution_contract(source_root, authenticated_sources)
        environment_root = source_root / ".venv"
        runner_python = _isolated_environment(source_root, _bot_python(repository))
        _assert_isolated_environment(environment_root, source_root)
        try:
            execution = _run_limited(
                [
                    str(runner_python),
                    "-I",
                    str(runner),
                    "--source-root",
                    str(source_root),
                    "--environment-root",
                    str(environment_root),
                ],
                environment={
                    "PATH": "/usr/bin:/bin",
                    "TMPDIR": str(source_root / ".runner-tmp"),
                },
                max_stdout_bytes=MAX_CATALOG_RUNNER_OUTPUT_BYTES,
                timeout_seconds=RUNNER_TIMEOUT_SECONDS,
            )
        except ValueError as exc:
            raise ValueError("fixed Bot catalog endpoint cannot be executed") from exc
    try:
        receipt = loads_strict_json(execution)
        encoded = receipt.get("body_base64") if isinstance(receipt, dict) else None
        raw = (
            base64.b64decode(encoded, validate=True)
            if isinstance(encoded, str)
            else None
        )
    except (StrictJsonError, ValueError, binascii.Error) as exc:
        raise ValueError("fixed Bot catalog execution receipt is malformed") from exc
    expected = {
        "profile": BOT_CATALOG_PROFILE,
        "method": "GET",
        "path": "/v1/agents",
        "authenticated": True,
        "network_allowed": False,
        "offline_enforcement": "seccomp_socket_deny_v1",
        "body_base64": encoded,
    }
    if (
        receipt != expected
        or raw is None
        or len(raw) > checker.MAX_RESEARCH_INPUT_FIXTURE_BYTES
    ):
        raise ValueError("fixed Bot catalog execution receipt is malformed")
    return raw


def _generate_binding(
    web_root: RootedDirectory,
    bot_repository: Path,
    bot_commit: str,
) -> dict[str, Any]:
    authority, sources = _generate_source_authority(
        bot_repository,
        bot_commit,
        checker.ACTIVATION_SOURCE_BOT_COMMIT,
        checker.BOT_SOURCE_PATHS,
    )
    contract = checker._parse_pinned_bot_contract(sources)
    if contract is None:
        raise ValueError("pinned Bot sources do not expose the required contract")

    try:
        fixture_raw = web_root.read_bytes(
            checker.RESEARCH_INPUT_FIXTURE_REL,
            checker.MAX_RESEARCH_INPUT_FIXTURE_BYTES,
        )
        fixture_text = fixture_raw.decode("utf-8")
    except InputTooLargeError as exc:
        raise ValueError("Web Research fixture is oversized") from exc
    except (OSError, UnicodeDecodeError) as exc:
        raise ValueError("Web Research fixture cannot be read") from exc
    fixture_authority, fixture_sources = _generate_source_authority(
        bot_repository,
        checker.RESEARCH_FIXTURE_BOT_COMMIT,
        checker.RESEARCH_FIXTURE_BOT_COMMIT,
        checker.RESEARCH_FIXTURE_SOURCE_PATHS,
    )
    expected_fixture_raw = _execute_bot_agent_catalog(
        bot_repository,
        checker.RESEARCH_FIXTURE_BOT_COMMIT,
        fixture_sources,
    )
    if fixture_raw != expected_fixture_raw:
        raise ValueError(
            "Web Research fixture differs from exact Bot-authoritative bytes"
        )
    fixture = checker._parse_research_input_fixture(fixture_text)
    fixture_contract = (
        checker._fixture_contract_value(fixture, contract)
        if fixture is not None
        else None
    )
    expected_fixture_contract = checker._expected_fixture_contract(contract)
    if fixture_contract != expected_fixture_contract:
        raise ValueError("Web Research fixture differs from pinned Bot sources")

    source_entries = authority["sources"]
    packet_entry = next(
        entry for entry in source_entries if entry["role"] == "resumable_upload_packet"
    )
    packet = checker._resumable_packet_metadata(
        sources["resumable_upload_packet"], packet_entry["sha256"]
    )
    if packet is None or packet["protocol"] != contract.upload_protocol:
        raise ValueError("pinned resumable-upload packet manifest is malformed")

    return {
        **authority,
        "contract": checker._pinned_bot_contract_value(contract),
        "research_fixture": {
            "path": checker.RESEARCH_INPUT_FIXTURE_REL.as_posix(),
            "sha256": hashlib.sha256(fixture_raw).hexdigest(),
            "contract_sha256": checker._canonical_json_sha256(
                expected_fixture_contract
            ),
            "execution": {
                "profile": BOT_CATALOG_PROFILE,
                "method": "GET",
                "path": "/v1/agents",
                "authenticated": True,
                "network_allowed": False,
                "offline_enforcement": "seccomp_socket_deny_v1",
                "environment": {
                    "installer": "pinned_bot_interpreter_v1",
                    "project_source": "pyproject.toml",
                    "lock_source": "environment.yml",
                },
                "bot_commit": checker.RESEARCH_FIXTURE_BOT_COMMIT,
            },
            "authority": fixture_authority,
        },
        "resumable_upload_packet": packet,
    }


def _load_manifest(web_root: RootedDirectory) -> _ManifestSnapshot:
    try:
        snapshot = web_root.read_snapshot(
            checker.BOT_CONTRACT_MANIFEST_REL,
            checker.MAX_BOT_CONTRACT_MANIFEST_BYTES,
        )
    except InputTooLargeError as exc:
        raise ValueError("Web contract manifest is oversized") from exc
    except OSError as exc:
        raise ValueError("Web contract manifest cannot be read") from exc
    raw = snapshot.value
    try:
        raw.decode("utf-8")
    except UnicodeDecodeError as exc:
        raise ValueError("Web contract manifest is malformed") from exc
    value = checker._json_object(raw)
    if value is None:
        raise ValueError("Web contract manifest is malformed")
    return _ManifestSnapshot(value=value, raw=raw, identity=snapshot.identity)


def _write_manifest(
    web_root: RootedDirectory,
    raw: bytes,
    expected_identity: FileIdentity,
) -> None:
    try:
        web_root.write_bytes(
            checker.BOT_CONTRACT_MANIFEST_REL,
            raw,
            expected_identity,
        )
    except InputChangedError as exc:
        raise ValueError("Web contract manifest changed during generation") from exc
    except OSError as exc:
        raise ValueError("Web contract manifest cannot be written") from exc


def _parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--web-root", type=Path, default=checker.ROOT)
    parser.add_argument("--bot-repo", type=Path)
    parser.add_argument("--bot-commit")
    parser.add_argument("--check", action="store_true")
    return parser


def main(argv: list[str] | None = None) -> int:
    args = _parser().parse_args(argv)
    try:
        try:
            web_root = RootedDirectory(args.web_root)
        except OSError as exc:
            raise ValueError("Web root cannot be opened safely") from exc
        with web_root:
            initial = _load_manifest(web_root)
            manifest = initial.value
            current_binding = manifest.get("activation_source_binding")
            current_binding_commit = (
                current_binding.get("bot_commit")
                if isinstance(current_binding, dict)
                else None
            )
            bot_commit = (
                args.bot_commit or current_binding_commit or manifest.get("bot_commit")
            )
            if not isinstance(bot_commit, str):
                raise ValueError("Web contract manifest has no pinned Bot commit")
            bot_repository = (
                args.bot_repo.resolve()
                if args.bot_repo is not None
                else web_root.path.parent / "Phytomni-Bot"
            )
            binding = _generate_binding(web_root, bot_repository, bot_commit)

            expected = dict(manifest)
            expected["activation_source_binding"] = binding
            rendered = (
                json.dumps(expected, ensure_ascii=False, indent=2) + "\n"
            ).encode("utf-8")
            if len(rendered) > checker.MAX_BOT_CONTRACT_MANIFEST_BYTES:
                raise ValueError("generated Web contract manifest is oversized")
            final = _load_manifest(web_root)
            if final.identity != initial.identity or final.raw != initial.raw:
                raise ValueError("Web contract manifest changed during generation")
            if args.check:
                if final.raw != rendered:
                    raise ValueError("committed manifest is stale")
                print("Bot activation manifest: PASS")
                return 0
            _write_manifest(web_root, rendered, final.identity)
    except ValueError as exc:
        print(f"Bot activation manifest: FAIL - {exc}", file=sys.stderr)
        return 1
    print("Bot activation manifest: generated")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
