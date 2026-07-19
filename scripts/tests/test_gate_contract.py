"""Parity contracts for the composable full quality gate."""

from __future__ import annotations

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

    assert text.count("uses: actions/setup-node@v4") == 3
    assert text.count("node-version: \"20\"") == 3
    assert text.count("cache: npm") == 3
    assert text.count("cache-dependency-path: apps/web/package-lock.json") == 3
    assert text.count("run: npm ci") == 3

    assert text.count("uses: actions/setup-go@v5") == 2
    assert text.count("go-version: \"1.23\"") == 2
    assert text.count("cache-dependency-path: apps/server/go.sum") == 2

    assert text.count("python3 scripts/scan_secrets.py --all") == 1
    assert text.count("sudo apt-get install -y ripgrep") == 1


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
