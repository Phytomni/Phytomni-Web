"""Parity contracts for the composable full quality gate."""

from __future__ import annotations

import json
import re
import subprocess
from pathlib import Path

import pytest

pytestmark = pytest.mark.unit

ROOT = Path(__file__).resolve().parents[2]
GATES = ROOT / "scripts" / "gates"
DISPATCHER = ROOT / "scripts" / "run_gate_group.sh"
FULL_GATE = ROOT / "scripts" / "validate_web_local.sh"
WORKFLOW = ROOT / ".github" / "workflows" / "ci.yml"
RUNBOOK = ROOT / "docs" / "deployment" / "upgrading.md"
UPGRADE_014_ADDENDUM = (
    ROOT / "docs" / "deployment" / "history" / "upgrade-0.1.3-to-0.1.4.md"
)
CONFIGURATION = ROOT / "docs" / "deployment" / "configuration.md"
OPERATIONS = ROOT / "docs" / "deployment" / "operations.md"
FRONTEND_DESIGN_SYSTEM = ROOT / "docs" / "frontend-design-system.md"
PUBLIC_GATE_DOCS = (ROOT / "README.md", ROOT / "CONTRIBUTING.md")

GROUP_ORDER = (
    "hygiene",
    "frontend-static",
    "frontend-runtime",
    "server-static",
    "server-runtime",
    "contracts",
)
GROUP_MARKERS = {
    "hygiene": ("G-1", "G0"),
    "frontend-static": ("G1", "G2.1", "G2"),
    "frontend-runtime": ("G3", "G12"),
    "server-static": ("G4", "G5", "G6", "G7"),
    "server-runtime": ("G7.5",),
    "contracts": ("G11", "G13", "G14", "G15", "G16", "G17"),
}


def _step_count(text: str, marker: str) -> int:
    return len(re.findall(rf'step "{re.escape(marker)}(?: | apps/| i18n:)', text))


def test_every_existing_gate_marker_has_one_group_owner() -> None:
    all_markers: list[str] = []
    for group, markers in GROUP_MARKERS.items():
        text = (GATES / f"{group}.sh").read_text(encoding="utf-8")
        assert "set -euo pipefail" in text
        for marker in markers:
            assert _step_count(text, marker) == 1, (group, marker)
            all_markers.append(marker)

    assert len(all_markers) == len(set(all_markers))
    assert set(all_markers) == {
        "G-1",
        "G0",
        "G1",
        "G2.1",
        "G2",
        "G3",
        "G4",
        "G5",
        "G6",
        "G7",
        "G7.5",
        "G11",
        "G12",
        "G13",
        "G14",
        "G15",
        "G16",
        "G17",
    }


def test_full_gate_dispatches_groups_once_in_order() -> None:
    text = FULL_GATE.read_text(encoding="utf-8")
    assert "GATE_GROUPS=(hygiene frontend-static frontend-runtime server-static server-runtime contracts)" in text
    assert re.search(r"(?m)^GROUPS=", text) is None
    positions = [text.index(group) for group in GROUP_ORDER]
    assert positions == sorted(positions)
    assert text.count('"$ROOT/scripts/run_gate_group.sh" "$group"') == 1
    assert "set -euo pipefail" in text


def test_dispatcher_rejects_unknown_or_missing_groups() -> None:
    dispatcher = DISPATCHER.read_text(encoding="utf-8")
    assert "unknown gate group" in dispatcher
    assert "gate group is missing or not executable" in dispatcher
    assert 'exec "$script"' in dispatcher
    assert "|| true" not in dispatcher

    unknown = subprocess.run(
        [str(DISPATCHER), "unknown"],
        cwd=ROOT,
        check=False,
        capture_output=True,
        text=True,
    )
    assert unknown.returncode == 2
    assert "unknown gate group" in unknown.stderr


def test_ci_targets_are_read_only_parallel_shared_groups() -> None:
    text = WORKFLOW.read_text(encoding="utf-8")

    assert "permissions:\n  contents: read" in text
    assert re.search(r"(?m)^  pull_request:\s*$", text)
    assert '  push:\n    branches:\n      - main\n      - "release/**"\n' in text
    assert (
        "group: ci-${{ github.workflow }}-${{ github.event.pull_request.number || github.ref }}"
        in text
    )
    assert "cancel-in-progress: true" in text
    assert "\t" not in text

    for group in GROUP_ORDER:
        assert re.search(rf"(?m)^  {re.escape(group)}:\s*$", text)
        assert re.search(rf"(?m)^    name: {re.escape(group)}\s*$", text)
        assert re.search(rf"(?m)^    timeout-minutes: 20\s*$", text)
        assert text.count(f"./scripts/run_gate_group.sh {group}") == 1

    assert text.count("./scripts/run_gate_group.sh ") == len(GROUP_ORDER)
    assert "./scripts/validate_web_local.sh" not in text


def test_ci_installs_only_group_owned_dependencies() -> None:
    text = WORKFLOW.read_text(encoding="utf-8")

    assert text.count("uses: actions/setup-python@v5") == len(GROUP_ORDER)
    assert text.count('python-version: "3.12"') == len(GROUP_ORDER)

    assert text.count("uses: actions/setup-node@v4") == 3
    assert text.count("node-version: \"26\"") == 3
    assert text.count("cache: npm") == 3
    assert text.count("cache-dependency-path: apps/web/package-lock.json") == 3
    assert text.count("run: npm ci") == 3

    assert text.count("uses: actions/setup-go@v5") == 2
    assert text.count("go-version: \"1.23\"") == 2
    assert text.count("cache-dependency-path: apps/server/go.sum") == 2

    assert text.count("python3 scripts/scan_secrets.py --all") == 1
    assert text.count("sudo apt-get install -y ripgrep") == 1


def test_ci_caches_pinned_quality_tools_and_requests_server_race() -> None:
    text = WORKFLOW.read_text(encoding="utf-8")

    assert text.count("uses: actions/cache@v4") == 3
    assert text.count("path: .cache/phytomni") == 3
    assert "hashFiles('scripts/*_runner.sh', 'scripts/quality_runner_common.sh')" in text
    server_runtime = text.split("\n  server-runtime:\n", 1)[1].split(
        "\n  contracts:\n", 1
    )[0]
    assert 'PHYTOMNI_RUN_RACE: "1"' in server_runtime


def test_public_docs_match_quality_gate_entrypoints() -> None:
    required_targets = (
        "make precommit",
        "make scoped",
        "make prepush",
        "make full",
        "make push",
    )
    for path in PUBLIC_GATE_DOCS:
        text = path.read_text(encoding="utf-8")
        for target in required_targets:
            assert target in text, (path, target)

    readme = (ROOT / "README.md").read_text(encoding="utf-8")
    contributing = (ROOT / "CONTRIBUTING.md").read_text(encoding="utf-8")
    assert "PHYTOMNI_SCOPED_GATE=1" in readme
    assert "PHYTOMNI_SCOPED_GATE=1" in contributing
    assert "branch-protection" in readme
    assert "branch-protection" in contributing
    assert "pre-commit hook runs the same script" not in contributing
    assert "full G-1 / G0 / G1..G17 gates" not in readme


def test_public_docs_name_ci_jobs_without_claiming_remote_activation() -> None:
    contributing = (ROOT / "CONTRIBUTING.md").read_text(encoding="utf-8")

    for job in GROUP_ORDER:
        assert f"`{job}`" in contributing
    assert "recommended required checks" in contributing
    assert "branch protection" in contributing
    assert "does not assert that GitHub branch" in contributing
    assert "CODEOWNERS rules" in contributing


def test_public_docs_bind_tool_versions_cache_and_rollback() -> None:
    contributing = (ROOT / "CONTRIBUTING.md").read_text(encoding="utf-8")

    for version in (
        "Node 26",
        "Go 1.23",
        "0.10.0",
        "v3.10.0",
        "v1.7.4",
        "2025.1.1",
    ):
        assert version in contributing
    assert ".cache/phytomni/<tool>-<version>/<platform>" in contributing
    assert "QUALITY_RUNNER_CACHE_ROOT" in contributing
    assert "QUALITY_RUNNER_OFFLINE=1" in contributing
    assert "fails closed" in contributing
    assert "unpinned binary" in contributing
    assert "restore the prior pinned" in contributing


def test_quality_policy_docs_preserve_scope_and_no_degradation_contract() -> None:
    style = (ROOT / "STYLE.md").read_text(encoding="utf-8")
    docs_index = (ROOT / "docs" / "README.md").read_text(encoding="utf-8")
    changelog = (ROOT / "CHANGELOG.md").read_text(encoding="utf-8")

    assert "native mechanism" in style
    assert "non-degrading" in style
    assert "Coverage is the independent G12 threshold" in style
    assert "Bot, operations, and deployment code are outside this scope" in style
    assert "Understand repository quality gates" in docs_index
    assert "do not add local governance notes under `docs/development/`" in docs_index
    assert "## [Unreleased]" in changelog
    assert "coverage G12 is unchanged" in changelog
    assert "Bot, operations, and deployment" in changelog


def test_gate_groups_own_enhanced_repository_tools() -> None:
    hygiene = (GATES / "hygiene.sh").read_text(encoding="utf-8")
    common = (GATES / "common.sh").read_text(encoding="utf-8")
    server_static = (GATES / "server-static.sh").read_text(encoding="utf-8")
    server_runtime = (GATES / "server-runtime.sh").read_text(encoding="utf-8")
    contracts = (GATES / "contracts.sh").read_text(encoding="utf-8")

    assert "scripts/shellcheck_runner.sh" in hygiene
    assert "scripts/shfmt_runner.sh" in hygiene
    assert "python3 scripts/check_repository_files.py --check --scope full" in hygiene
    assert "python3 scripts/scan_secrets.py --all" in hygiene
    assert "python3 scripts/scan_secrets.py --range" in hygiene
    assert "resolve_main_ref" in hygiene
    assert "refs/remotes/origin/main" in common
    assert "go mod verify" in server_static
    assert "scripts/staticcheck_runner.sh" in server_static
    assert "-f json ./..." in server_static
    assert "go test ./..." in server_runtime
    assert "go test -race ./..." in server_runtime
    assert "scripts/actionlint_runner.sh" in contracts


def test_frontend_runtime_uses_guarded_test_and_coverage_scripts() -> None:
    package = json.loads(
        (ROOT / "apps" / "web" / "package.json").read_text(encoding="utf-8")
    )
    scripts = package["scripts"]
    assert scripts["test:run:raw"] == "vitest run"
    assert (
        scripts["test:run"]
        == "npm run test:warning-oracle && node scripts/quality/run-with-warning-oracle.mjs test"
    )
    assert scripts["coverage:raw"] == "vitest run --coverage"
    assert (
        scripts["coverage"]
        == "npm run test:warning-oracle && node scripts/quality/run-with-warning-oracle.mjs coverage"
    )

    runtime = (GATES / "frontend-runtime.sh").read_text(encoding="utf-8")
    assert "npm run coverage" in runtime
    assert "coverage:raw" not in runtime
    assert "test:run:raw" not in runtime


def test_frontend_runtime_entrypoints_do_not_call_raw_commands() -> None:
    package = json.loads(
        (ROOT / "apps" / "web" / "package.json").read_text(encoding="utf-8")
    )
    scripts = package["scripts"]
    assert scripts["build-only"] == (
        "node scripts/quality/run-with-warning-oracle.mjs build"
    )
    assert scripts["build"] == "run-p type-check build-only"

    active_entrypoints = [
        *(GATES / f"{group}.sh" for group in GROUP_ORDER),
        ROOT / "scripts" / "validate_web_local.sh",
        WORKFLOW,
    ]
    text = "\n".join(path.read_text(encoding="utf-8") for path in active_entrypoints)
    for raw_script in ("build-only:raw", "test:run:raw", "coverage:raw"):
        assert raw_script not in text

    assert "npm run build-only:raw" not in text
    assert "npm run test:run:raw" not in text
    assert "npm run coverage:raw" not in text


def test_every_gate_reaches_the_fail_closed_checker_through_one_helper() -> None:
    gate_text = {
        group: (GATES / f"{group}.sh").read_text(encoding="utf-8")
        for group in GROUP_ORDER
    }
    for group, text in gate_text.items():
        assert "run_static_analysis_check" in text, group
        assert "--inventory" not in text, group

    assert (
        "run_static_analysis_check docs/development/static-analysis-exemptions.md"
        in gate_text["hygiene"]
    )
    assert "--collector eslint" in gate_text["frontend-static"]
    assert "--collector typescript" in gate_text["frontend-static"]
    assert "npx --no-install eslint" not in gate_text["frontend-static"]
    assert "--collector go" in gate_text["server-static"]
    assert "--collector config" in gate_text["server-static"]

    scoped = (ROOT / "scripts" / "scoped_gate.sh").read_text(encoding="utf-8")
    assert "run_static_analysis_check" in scoped
    hooks = "\n".join(
        (ROOT / ".githooks" / name).read_text(encoding="utf-8")
        for name in ("pre-commit", "pre-push")
    )
    assert "check_static_analysis_exemptions.py" not in hooks


def test_gate_scripts_do_not_mask_suppression_or_command_failures() -> None:
    texts = [
        (GATES / f"{group}.sh").read_text(encoding="utf-8")
        for group in GROUP_ORDER
    ]
    texts.append((ROOT / "scripts" / "scoped_gate.sh").read_text(encoding="utf-8"))
    assert all("|| true" not in text for text in texts)
    assert all("|| echo 0" not in text for text in texts)
    assert "xargs" not in (GATES / "hygiene.sh").read_text(encoding="utf-8")
    assert all("--quiet" not in text for text in texts)
    assert all("--ignore-path" not in text for text in texts)


def test_active_entrypoints_reject_warning_tolerant_and_observation_paths() -> None:
    paths = [
        *(GATES / f"{group}.sh" for group in GROUP_ORDER),
        ROOT / "scripts" / "scoped_gate.sh",
        ROOT / "scripts" / "validate_web_local.sh",
        ROOT / ".githooks" / "pre-commit",
        ROOT / ".githooks" / "pre-push",
        WORKFLOW,
    ]
    texts = [path.read_text(encoding="utf-8") for path in paths]
    for text in texts:
        assert "--inventory" not in text
        assert "NOT ENFORCED" not in text
        assert "observation" not in text.lower()
        assert "|| true" not in text
        assert "--quiet" not in text
        assert "--max-warnings" not in text
        assert "--ignore-path" not in text
        assert not re.search(r"\beslint\b[^\n]*--fix", text)
        assert "npm run lint" not in text


def test_rg_exit_codes_distinguish_findings_no_match_and_failure(tmp_path: Path) -> None:
    fixture = tmp_path / "fixture.txt"
    fixture.write_text("needle\n", encoding="utf-8")

    matched = subprocess.run(
        ["rg", "-n", "needle", str(fixture)],
        check=False,
        capture_output=True,
        text=True,
    )
    no_match = subprocess.run(
        ["rg", "-n", "absent", str(fixture)],
        check=False,
        capture_output=True,
        text=True,
    )
    invalid = subprocess.run(
        ["rg", "-n", "[", str(fixture)],
        check=False,
        capture_output=True,
        text=True,
    )

    assert matched.returncode == 0
    assert matched.stdout
    assert no_match.returncode == 1
    assert no_match.stdout == ""
    assert invalid.returncode > 1


def test_match_status_helper_allows_only_match_and_no_match() -> None:
    probe = subprocess.run(
        [
            "bash",
            "-c",
            "source scripts/gates/common.sh; "
            "check_match_status 0 probe; "
            "check_match_status 1 probe; "
            "check_match_status 2 probe",
        ],
        cwd=ROOT,
        check=False,
        capture_output=True,
        text=True,
    )

    assert probe.returncode == 1
    assert "probe failed with status 2" in probe.stderr


def test_deployment_version_probe_classifies_unavailable_flag() -> None:
    text = RUNBOOK.read_text(encoding="utf-8")

    assert "./phytomni-server --version 2>/dev/null || true" not in text
    assert "if ./phytomni-server --version >/dev/null 2>&1; then" in text
    assert "./phytomni-server --version" in text
    assert (
        'printf \'%s\\n\' "Version flag unavailable; verify the artifact checksum instead."'
        in text
    )


def test_research_input_rollout_docs_define_limits_schema_and_ux() -> None:
    configuration = CONFIGURATION.read_text(encoding="utf-8")
    upgrading = RUNBOOK.read_text(encoding="utf-8")
    operations = OPERATIONS.read_text(encoding="utf-8")
    frontend = FRONTEND_DESIGN_SYSTEM.read_text(encoding="utf-8")

    assert "max_query_chars: 131072" in configuration
    assert "default is `131072`; the hard maximum is `1048576`" in configuration
    assert re.search(
        r"attachment\s+default is `64`; the hard maximum is `256`", configuration
    )
    assert re.search(
        r"dataset-path default is `64`; the hard maximum is\s+`256`", configuration
    )
    assert re.search(
        r"combined-reference default is `128`; the hard maximum is\s+`256`",
        configuration,
    )
    assert "`research_input_resolution_v1` version `1`" in configuration

    assert "`query` and `answer` columns must both be `MEDIUMTEXT`" in upgrading
    assert "Rollback keeps `query` and `answer` widened as `MEDIUMTEXT`" in upgrading

    assert re.search(
        r"Bot deployment must\s+complete before Web deployment", operations
    )
    assert "separately transferred operator handoff" in operations

    assert "must never silently truncate" in frontend
    assert "does not add a new input control" in frontend


def test_routed_014_upgrade_addendum_requires_research_preconditions() -> None:
    addendum = UPGRADE_014_ADDENDUM.read_text(encoding="utf-8")

    assert (
        "It adds no production database migration or configuration key"
        not in addendum
    )
    assert re.search(
        r"`query` and `answer` columns must both be\s+`MEDIUMTEXT`", addendum
    )
    assert "reverse-proxy request-body allowance" in addendum
    assert re.search(
        r"Bot deployment must\s+complete before Web\s+deployment", addendum
    )
    assert "does not add a new input flag or cohort" in addendum
    assert "research_input_enabled:" not in addendum
    assert re.search(
        r"Rollback keeps `query` and `answer` widened as\s+`MEDIUMTEXT`", addendum
    )
    assert "External Pending" in addendum
    assert "frontend test files" not in addendum
