"""Keep the third-party declaration reverse probe tied to the toolchain.

The application intentionally runs with ``skipLibCheck`` enabled while the
installed declaration files are incompatible with the supported isolated-module
toolchain.  This test does not authorize that choice; it makes the evidence
fail closed when dependency versions, diagnostic families, or diagnostic
ownership change.
"""

from __future__ import annotations

import json
import re
import subprocess
from pathlib import Path

import pytest

pytestmark = pytest.mark.unit

ROOT = Path(__file__).resolve().parents[2]
WEB_ROOT = ROOT / "apps" / "web"
VUE_TSC = WEB_ROOT / "node_modules" / ".bin" / "vue-tsc"

EXPECTED_PACKAGES = {
    "typescript": "4.7.4",
    "vue-tsc": "0.39.5",
}
EXPECTED_DIAGNOSTIC_CODES = frozenset(
    {
        "TS1039",
        "TS1169",
        "TS1383",
        "TS2304",
        "TS2305",
        "TS2307",
        "TS2339",
        "TS2344",
        "TS2380",
        "TS2411",
        "TS2502",
        "TS2536",
        "TS2691",
        "TS2694",
        "TS2748",
        "TS2749",
        "TS7010",
    }
)
DIAGNOSTIC = re.compile(
    r"^(?P<path>.+?)(?:\(\d+,\d+\))?: error (?P<code>TS\d+):"
)


def _package_version(name: str) -> str:
    package_json = WEB_ROOT / "node_modules" / name / "package.json"
    assert package_json.is_file(), f"missing installed package metadata: {package_json}"
    document = json.loads(package_json.read_text(encoding="utf-8"))
    version = document.get("version")
    assert isinstance(version, str) and version, f"invalid version in {package_json}"
    return version


def _relative_path(raw_path: str) -> str:
    path = raw_path.replace("\\", "/")
    web_root = WEB_ROOT.as_posix().rstrip("/") + "/"
    if path.startswith(web_root):
        path = path.removeprefix(web_root)
    return path


def test_skip_lib_check_probe_is_dependency_only_and_version_bound() -> None:
    """The reverse probe must keep failing only in installed declarations."""

    if not VUE_TSC.is_file():
        pytest.fail(f"missing vue-tsc executable: {VUE_TSC}")

    for package, expected in EXPECTED_PACKAGES.items():
        assert _package_version(package) == expected

    result = subprocess.run(
        [
            str(VUE_TSC),
            "--noEmit",
            "--skipLibCheck",
            "false",
            "--pretty",
            "false",
        ],
        cwd=WEB_ROOT,
        check=False,
        capture_output=True,
        text=True,
    )
    output = result.stdout + result.stderr
    diagnostics = [
        (match.group("path"), match.group("code"))
        for line in output.splitlines()
        if (match := DIAGNOSTIC.match(line))
    ]

    assert result.returncode != 0, (
        "skipLibCheck=false became clean; re-adjudicate the structural decision "
        "and remove the temporary record if no longer necessary"
    )
    assert diagnostics, "the reverse probe failed without parseable diagnostics"
    assert {
        code for _, code in diagnostics
    } == EXPECTED_DIAGNOSTIC_CODES, (
        "the third-party declaration diagnostic family changed; re-adjudicate "
        "the structural decision before changing skipLibCheck"
    )
    assert all(
        _relative_path(path).startswith("node_modules/") for path, _ in diagnostics
    ), "skipLibCheck=false must not hide first-party diagnostics"
