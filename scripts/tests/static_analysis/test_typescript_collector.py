"""Contract tests for vue-tsc diagnostics and TypeScript directives."""

from __future__ import annotations

import json
import subprocess
from pathlib import Path

import pytest

from scripts.static_analysis.collectors.errors import CollectionError
from scripts.static_analysis.collectors.config import collect_config_suppressions
from scripts.static_analysis.collectors.typescript import (
    audit_typescript_directives,
    collect_typescript,
    parse_vue_tsc_output,
    validate_vue_tsc_result,
)
from scripts.static_analysis.model import Mechanism, TargetKind

pytestmark = pytest.mark.unit

REPO_ROOT = Path(__file__).resolve().parents[3]
FIXTURE_ROOT = Path(__file__).parent / "fixtures" / "typescript" / "project"
WEB_ROOT = REPO_ROOT / "apps" / "web"


def test_parser_handles_multiline_paths_spaces_and_vue_locations() -> None:
    text = "\n".join(
        [
            "src/with spaces.ts(3,7): error TS2322: Type 'number' is not assignable to type 'string'.",
            "  The assignment must remain a string.",
            "src/App.vue:8:4 - error TS2339: Property 'missing' does not exist on type '{}'.",
        ]
    )

    findings = parse_vue_tsc_output(FIXTURE_ROOT, text, "0.39.5")

    assert [finding.path for finding in findings] == [
        "src/App.vue",
        "src/with spaces.ts",
    ]
    assert findings[0].rule == "TS2339"
    assert findings[0].target_kind is TargetKind.SPAN
    assert findings[1].display_line == 3
    assert "assignment must remain" in findings[1].message
    assert findings[1].tool == "typescript"
    assert findings[1].mechanism is Mechanism.DIAGNOSTIC
    assert findings[1].fingerprint.startswith("sha256:")


@pytest.mark.parametrize(
    "returncode, stdout, stderr, expected",
    [
        (0, "", "", ""),
        (0, "src/a.ts(1,1): error TS1005: ';' expected.\n", "", "output"),
        (2, "src/a.ts(1,1): error TS1005: ';' expected.\n", "", "output"),
    ],
)
def test_status_validation_accepts_clean_or_compiler_diagnostic_output(
    returncode: int, stdout: str, stderr: str, expected: str
) -> None:
    assert validate_vue_tsc_result(returncode, stdout, stderr) == (
        stdout if expected == "output" else ""
    )


def test_status_validation_rejects_failed_empty_invocations() -> None:
    with pytest.raises(CollectionError):
        validate_vue_tsc_result(2, "", "vue-tsc crashed")


@pytest.mark.parametrize(
    "text",
    [
        "not a TypeScript diagnostic",
        "src/a.ts(1,1): error TS2322: first\ntruncated continuation without indentation",
        "src/a.ts(1,1): error TS: unknown code",
    ],
)
def test_parser_rejects_unknown_or_truncated_output(text: str) -> None:
    with pytest.raises(CollectionError):
        parse_vue_tsc_output(FIXTURE_ROOT, text, "0.39.5")


def test_parser_rejects_stale_tool_versions_and_accepts_empty_output() -> None:
    assert parse_vue_tsc_output(FIXTURE_ROOT, "", "0.39.5") == ()
    with pytest.raises(CollectionError, match="version"):
        parse_vue_tsc_output(FIXTURE_ROOT, "", "5.0.0")


def test_parser_binds_global_diagnostics_to_project_configuration() -> None:
    findings = parse_vue_tsc_output(
        FIXTURE_ROOT,
        "error TS2468: Cannot find global value 'Promise'.",
        "0.39.5",
    )

    assert findings[0].path == "tsconfig.json"
    assert findings[0].display_line is None
    assert findings[0].target.startswith("global:TS2468:")


def test_directive_audit_keeps_used_unused_and_broad_markers_exact(
    tmp_path: Path,
) -> None:
    root = tmp_path / "typescript"
    root.mkdir()
    (root / "directives.ts").write_text(
        "// @ts-expect-error used: the assignment below is intentionally invalid\n"
        "const invalidValue: string = 1;\n"
        "\n"
        "// @ts-expect-error unused: this line is already valid\n"
        "const validValue = 1;\n"
        "\n"
        "// @ts-ignore broad escape retained only as an inventory fixture\n"
        "const ignoredValue: string = 1;\n",
        encoding="utf-8",
    )
    (root / "nocheck.ts").write_text(
        "// @ts-nocheck file-level escape retained only as an inventory fixture\n"
        "export const uncheckedValue = \"fixture\";\n",
        encoding="utf-8",
    )
    paths = (root / "directives.ts", root / "nocheck.ts")

    findings = audit_typescript_directives(root, paths)

    assert [finding.rule for finding in findings] == [
        "@ts-expect-error",
        "@ts-expect-error",
        "@ts-ignore",
        "@ts-nocheck",
    ]
    assert all(finding.target_kind is TargetKind.SPAN for finding in findings)
    assert findings[0].target != findings[1].target
    assert any("@ts-ignore" in finding.message for finding in findings)


def test_zero_inputs_do_not_invoke_compiler() -> None:
    assert collect_typescript(REPO_ROOT, project=REPO_ROOT / "apps/web/tsconfig.json", files=()) == ()


def test_bounded_collection_checks_versions_project_and_selected_files(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    calls: list[tuple[str, ...]] = []

    def fake_run(command: tuple[str, ...], *, cwd: Path) -> subprocess.CompletedProcess[str]:
        del cwd
        calls.append(command)
        if command[:4] == ("npx", "--no-install", "vue-tsc", "--version"):
            return subprocess.CompletedProcess(command, 0, "Version 4.7.4\n", "")
        if command[:2] == ("node", "-p"):
            return subprocess.CompletedProcess(command, 0, "0.39.5\n", "")
        return subprocess.CompletedProcess(
            command,
            2,
            "src/with spaces.ts(1,7): error TS2322: invalid fixture\n",
            "",
        )

    monkeypatch.setattr(
        "scripts.static_analysis.collectors.typescript._run", fake_run
    )
    path = FIXTURE_ROOT / "src" / "with spaces.ts"

    findings = collect_typescript(
        FIXTURE_ROOT,
        project=FIXTURE_ROOT / "tsconfig.json",
        files=(path,),
    )

    assert [finding.path for finding in findings] == ["src/with spaces.ts"]
    assert calls[0][:4] == ("npx", "--no-install", "vue-tsc", "--version")
    assert calls[1][:2] == ("node", "-p")
    assert "--project" in calls[2]


def test_config_fixture_ownership_is_explicit(tmp_path: Path) -> None:
    assert "skipLibCheck" not in (
        FIXTURE_ROOT / "tsconfig.json"
    ).read_text(encoding="utf-8")
    config_path = tmp_path / "tsconfig.json"
    config_path.write_text(
        json.dumps({"compilerOptions": {"skipLibCheck": True}}),
        encoding="utf-8",
    )
    config = json.loads(config_path.read_text(encoding="utf-8"))
    assert config["compilerOptions"]["skipLibCheck"] is True
    findings = collect_config_suppressions(tmp_path)
    skip_lib_check = [
        finding
        for finding in findings
        if finding.tool == "typescript" and finding.rule == "skipLibCheck"
    ]
    assert len(skip_lib_check) == 1
    assert skip_lib_check[0].path == "tsconfig.json"
    assert skip_lib_check[0].target == "compilerOptions.skipLibCheck"


def test_web_config_project_explicitly_includes_typed_vite_plugins() -> None:
    config = json.loads(
        (WEB_ROOT / "tsconfig.config.json").read_text(encoding="utf-8")
    )

    assert "vite/**/*.ts" in config["include"]
