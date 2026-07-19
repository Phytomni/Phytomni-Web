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
