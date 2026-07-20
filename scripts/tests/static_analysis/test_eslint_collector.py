"""Contract tests for the Node-native ESLint inventory bridge."""

from __future__ import annotations

import json
import subprocess
from pathlib import Path

import pytest

from scripts.static_analysis.collectors.errors import CollectionError
from scripts.static_analysis.collectors.eslint import (
    collect_eslint,
    parse_eslint_inventory,
    validate_eslint_result,
)
from scripts.static_analysis.model import TargetKind

pytestmark = pytest.mark.unit

REPO_ROOT = Path(__file__).resolve().parents[3]
BRIDGE = REPO_ROOT / "apps" / "web" / "scripts" / "quality" / "eslint-inventory.mjs"
FIXTURE_ROOT = Path(__file__).parent / "fixtures" / "eslint" / "project"


def _run_bridge(*args: str) -> subprocess.CompletedProcess[str]:
    return subprocess.run(
        ["node", str(BRIDGE), *args],
        cwd=REPO_ROOT,
        text=True,
        capture_output=True,
        check=False,
    )


def test_bridge_help_exits_zero() -> None:
    result = _run_bridge("--help")

    assert result.returncode == 0
    assert "--root" in result.stdout
    assert result.stderr == ""


def test_bridge_emits_deterministic_ast_bound_findings() -> None:
    result = _run_bridge(
        "--root",
        str(FIXTURE_ROOT),
        "--file",
        "sample.ts",
        "--file",
        "Sample.vue",
    )

    assert result.returncode == 0, result.stderr
    document = json.loads(result.stdout)
    assert document["schemaVersion"] == 1
    assert document["toolVersion"] == "8.22.0"
    assert document["filesScanned"] == 2
    assert document["findings"] == sorted(
        document["findings"],
        key=lambda item: (item["path"], item["display"]["line"], item["rule"]),
    )
    assert any(
        finding["target"]["kind"] in {"symbol", "span"}
        for finding in document["findings"]
    )
    assert any(finding["path"] == "Sample.vue" for finding in document["findings"])
    assert any(
        finding["rule"] == "eslint-internal"
        and "Unused eslint-disable" in finding["message"]
        for finding in document["findings"]
    )


def test_bridge_rejects_unknown_rules_and_parser_crashes(tmp_path: Path) -> None:
    unknown_root = tmp_path / "unknown-rule"
    unknown_root.mkdir()
    (unknown_root / ".eslintrc.cjs").write_text(
        "module.exports = { root: true, rules: { 'unknown-rule-id': 'error' } };\n",
        encoding="utf-8",
    )
    (unknown_root / "sample.js").write_text("var value = 1;\n", encoding="utf-8")
    unknown = _run_bridge("--root", str(unknown_root), "--file", "sample.js")
    assert unknown.returncode == 0, unknown.stderr
    unknown_document = json.loads(unknown.stdout)
    assert unknown_document["findings"][0]["rule"] == "unknown-rule-id"
    assert "Definition for rule" in unknown_document["findings"][0]["message"]

    broken_root = tmp_path / "parser-crash"
    broken_root.mkdir()
    (broken_root / "broken.js").write_text("const = ;\n", encoding="utf-8")
    broken = _run_bridge("--root", str(broken_root), "--file", "broken.js")
    assert broken.returncode != 0
    assert "fatal" in broken.stderr.lower() or "parser" in broken.stderr.lower()


def test_parser_converts_target_identity_and_sorts_findings() -> None:
    text = json.dumps(
        {
            "schemaVersion": 1,
            "toolVersion": "8.22.0",
            "filesScanned": 1,
            "findings": [
                {
                    "tool": "eslint",
                    "toolVersion": "8.22.0",
                    "rule": "z/rule",
                    "path": "src/z.ts",
                    "message": "z",
                    "severity": 1,
                    "display": {"line": 4, "column": 2},
                    "target": {
                        "kind": "span",
                        "identity": "span:z",
                        "normalizedSource": "z",
                    },
                },
                {
                    "tool": "eslint",
                    "toolVersion": "8.22.0",
                    "rule": "a/rule",
                    "path": "src/a.ts",
                    "message": "a",
                    "severity": 2,
                    "display": {"line": 1, "column": 1, "endLine": 1, "endColumn": 4},
                    "target": {
                        "kind": "symbol",
                        "identity": "symbol:a",
                        "normalizedSource": "const a = 1",
                    },
                },
            ],
        }
    )

    findings = parse_eslint_inventory(REPO_ROOT, text)

    assert [finding.path for finding in findings] == ["src/a.ts", "src/z.ts"]
    assert findings[0].target_kind is TargetKind.SYMBOL
    assert findings[0].fingerprint.startswith("sha256:")
    assert findings[0].display_line == 1


@pytest.mark.parametrize(
    "returncode, stdout, stderr",
    [
        (1, "", "ESLint crashed"),
        (0, "", ""),
        (0, "not-json", ""),
        (0, '{"schemaVersion": 1}', ""),
        (0, '{"schemaVersion": 1}\nwarning', ""),
    ],
)
def test_validation_rejects_failed_empty_or_malformed_invocations(
    returncode: int, stdout: str, stderr: str
) -> None:
    with pytest.raises(CollectionError):
        validate_eslint_result(returncode, stdout, stderr)


def test_parser_rejects_version_mismatch_and_unknown_schema() -> None:
    base = {
        "schemaVersion": 1,
        "toolVersion": "8.22.0",
        "filesScanned": 0,
        "findings": [],
    }

    wrong_version = dict(base, toolVersion="9.0.0")
    with pytest.raises(CollectionError, match="version"):
        parse_eslint_inventory(REPO_ROOT, json.dumps(wrong_version))

    unknown_key = dict(base, unexpected=True)
    with pytest.raises(CollectionError, match="key"):
        parse_eslint_inventory(REPO_ROOT, json.dumps(unknown_key))


def test_zero_tracked_inputs_are_a_valid_empty_inventory() -> None:
    text = json.dumps(
        {
            "schemaVersion": 1,
            "toolVersion": "8.22.0",
            "filesScanned": 0,
            "findings": [],
        }
    )

    assert parse_eslint_inventory(REPO_ROOT, text) == ()


def test_collect_eslint_invokes_the_installed_bridge() -> None:
    findings = collect_eslint(REPO_ROOT, (REPO_ROOT / "apps" / "web" / "src" / "main.ts",))

    assert findings == ()


def test_bridge_accepts_repeatable_rule_overlays() -> None:
    result = _run_bridge(
        "--root",
        str(FIXTURE_ROOT),
        "--file",
        "sample.ts",
        "--rule",
        "no-console=error",
        "--rule",
        "no-unused-vars=off",
    )

    assert result.returncode == 0, result.stderr
    document = json.loads(result.stdout)
    findings = document["findings"]
    assert not any(finding["rule"] == "no-unused-vars" for finding in findings)
    console = next(finding for finding in findings if finding["rule"] == "no-console")
    assert console["severity"] == 2
