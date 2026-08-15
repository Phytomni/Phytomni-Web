#!/usr/bin/env python3
"""Generate the offline activation source binding from one Bot Git commit."""

from __future__ import annotations

import argparse
import base64
import hashlib
import json
import re
import subprocess
import sys
from pathlib import Path
from typing import Any

if __package__ in {None, ""}:
    sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from scripts import check_bot_web_activation as checker


def _git(repository: Path, *arguments: str) -> bytes:
    result = subprocess.run(
        ["git", "-C", str(repository), *arguments],
        check=False,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
    )
    if result.returncode != 0:
        raise ValueError("cannot read the requested Bot Git object")
    return result.stdout


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
                    "content_base64": base64.b64encode(commit_payload).decode(
                        "ascii"
                    ),
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


def _generate_binding(
    web_root: Path,
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

    fixture_path = web_root / checker.RESEARCH_INPUT_FIXTURE_REL
    try:
        fixture_raw = fixture_path.read_bytes()
        fixture_text = fixture_raw.decode("utf-8")
    except (OSError, UnicodeDecodeError) as exc:
        raise ValueError("Web Research fixture cannot be read") from exc
    fixture_authority, fixture_sources = _generate_source_authority(
        bot_repository,
        checker.RESEARCH_FIXTURE_BOT_COMMIT,
        checker.RESEARCH_FIXTURE_BOT_COMMIT,
        checker.RESEARCH_FIXTURE_SOURCE_PATHS,
    )
    expected_fixture_raw = checker._research_fixture_bytes(fixture_sources)
    if expected_fixture_raw is None:
        raise ValueError("Bot fixture authority cannot reproduce the Research fixture")
    if fixture_raw != expected_fixture_raw:
        raise ValueError("Web Research fixture differs from exact Bot-authoritative bytes")
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
            "authority": fixture_authority,
        },
        "resumable_upload_packet": packet,
    }


def _load_manifest(path: Path) -> dict[str, Any]:
    try:
        raw = path.read_bytes()
    except OSError as exc:
        raise ValueError("Web contract manifest cannot be read") from exc
    value = checker._json_object(raw)
    if value is None:
        raise ValueError("Web contract manifest is malformed")
    return value


def _parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--web-root", type=Path, default=checker.ROOT)
    parser.add_argument("--bot-repo", type=Path)
    parser.add_argument("--bot-commit")
    parser.add_argument("--check", action="store_true")
    return parser


def main(argv: list[str] | None = None) -> int:
    args = _parser().parse_args(argv)
    web_root = args.web_root.resolve()
    manifest_path = web_root / checker.BOT_CONTRACT_MANIFEST_REL
    try:
        manifest = _load_manifest(manifest_path)
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
            else web_root.parent / "Phytomni-Bot"
        )
        binding = _generate_binding(web_root, bot_repository, bot_commit)
    except ValueError as exc:
        print(f"Bot activation manifest: FAIL - {exc}", file=sys.stderr)
        return 1

    expected = dict(manifest)
    expected["activation_source_binding"] = binding
    rendered = json.dumps(expected, ensure_ascii=False, indent=2) + "\n"
    if args.check:
        try:
            current = manifest_path.read_text(encoding="utf-8")
        except OSError:
            current = ""
        if current != rendered:
            print("Bot activation manifest: FAIL - committed manifest is stale")
            return 1
        print("Bot activation manifest: PASS")
        return 0
    manifest_path.write_text(rendered, encoding="utf-8")
    print("Bot activation manifest: generated")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
