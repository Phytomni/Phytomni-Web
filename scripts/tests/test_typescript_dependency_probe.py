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
from collections import Counter
from pathlib import Path
from tempfile import NamedTemporaryFile, TemporaryDirectory

import pytest

pytestmark = pytest.mark.unit

ROOT = Path(__file__).resolve().parents[2]
WEB_ROOT = ROOT / "apps" / "web"
VUE_TSC = WEB_ROOT / "node_modules" / ".bin" / "vue-tsc"

EXPECTED_PACKAGES = {
    "3dmol": "2.5.5",
    "typescript": "4.7.4",
    "vue-tsc": "0.39.5",
}
EXPECTED_APPLICATION_DIAGNOSTIC_CODES = frozenset(
    {
        "TS1039",
        "TS1169",
        "TS1383",
        "TS2304",
        "TS2305",
        "TS2307",
        "TS2315",
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
EXPECTED_CONFIG_DECLARATION_CODES = frozenset(
    {"TS1169", "TS2304", "TS2307", "TS2339", "TS7016"}
)
PROJECTS = {
    "application": WEB_ROOT / "tsconfig.json",
    "config": WEB_ROOT / "tsconfig.config.json",
}
PROBE_BUILD_INFO = Path("/tmp/phytomni-typescript-probe.tsbuildinfo")
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


def _resolved_output_path(raw_path: str) -> Path:
    value = _relative_path(raw_path)
    candidate = Path(value)
    return (
        candidate.resolve()
        if candidate.is_absolute()
        else (WEB_ROOT / candidate).resolve()
    )


def _run_probe(
    project: Path, *, skip_lib_check: bool
) -> subprocess.CompletedProcess[str]:
    return subprocess.run(
        [
            str(VUE_TSC),
            "--noEmit",
            "--skipLibCheck",
            str(skip_lib_check).lower(),
            "--tsBuildInfoFile",
            str(PROBE_BUILD_INFO),
            "--incremental",
            "true",
            "--pretty",
            "false",
            "--project",
            str(project),
        ],
        cwd=WEB_ROOT,
        check=False,
        capture_output=True,
        text=True,
    )


def _diagnostics(result: subprocess.CompletedProcess[str]) -> list[tuple[str, str]]:
    output = result.stdout + result.stderr
    return [
        (match.group("path"), match.group("code"))
        for line in output.splitlines()
        if (match := DIAGNOSTIC.match(line))
    ]


def test_skip_lib_check_probe_is_project_and_dependency_bound() -> None:
    """Both projects must expose dependency debt without hiding app errors."""

    if not VUE_TSC.is_file():
        pytest.fail(f"missing vue-tsc executable: {VUE_TSC}")

    for package, expected in EXPECTED_PACKAGES.items():
        assert _package_version(package) == expected

    application = _run_probe(PROJECTS["application"], skip_lib_check=False)
    application_diagnostics = _diagnostics(application)
    assert application.returncode != 0, (
        "application skipLibCheck=false became clean; re-adjudicate the structural "
        "decision and remove the temporary record if no longer necessary"
    )
    assert application_diagnostics, "the application probe returned no diagnostics"
    assert {
        code for _, code in application_diagnostics
    } == EXPECTED_APPLICATION_DIAGNOSTIC_CODES, (
        "the application declaration diagnostic family changed; re-adjudicate "
        "the structural decision before changing skipLibCheck"
    )
    assert all(
        _relative_path(path).startswith("node_modules/")
        for path, _ in application_diagnostics
    ), "application skipLibCheck=false must not hide first-party diagnostics"

    config = _run_probe(PROJECTS["config"], skip_lib_check=False)
    config_diagnostics = _diagnostics(config)
    assert config.returncode != 0, "config skipLibCheck=false unexpectedly became clean"
    assert config_diagnostics, "the config probe returned no diagnostics"
    declaration_diagnostics = [
        (path, code)
        for path, code in config_diagnostics
        if _relative_path(path).startswith("node_modules/")
    ]
    first_party_diagnostics = [
        (_relative_path(path), code)
        for path, code in config_diagnostics
        if not _relative_path(path).startswith("node_modules/")
    ]
    assert {
        code for _, code in declaration_diagnostics
    } == EXPECTED_CONFIG_DECLARATION_CODES, (
        "the config declaration diagnostic family changed; keep it separate from "
        "the application structural decision"
    )
    assert Counter(first_party_diagnostics) == Counter(
        {("vitest.config.ts", "TS2769"): 3}
    ), (
        "config-project first-party diagnostics changed; do not classify them as "
        "third-party declaration debt"
    )


def test_first_party_canary_is_visible_with_or_without_skip_lib_check() -> None:
    """The reverse probe must never let skipLibCheck hide a source error."""

    with TemporaryDirectory(prefix="phytomni-ts-canary-") as directory:
        root = Path(directory)
        source = root / "canary.ts"
        source.write_text("const invalidValue: string = 1;\n", encoding="utf-8")
        project = root / "tsconfig.json"
        project.write_text(
            json.dumps(
                {
                    "compilerOptions": {
                        "noEmit": True,
                        "strict": True,
                        "skipLibCheck": True,
                    },
                    "files": [str(source)],
                }
            ),
            encoding="utf-8",
        )

        for skip_lib_check in (True, False):
            result = _run_probe(project, skip_lib_check=skip_lib_check)
            diagnostics = _diagnostics(result)
            assert result.returncode != 0
            assert any(
                _resolved_output_path(path) == source.resolve() and code == "TS2322"
                for path, code in diagnostics
            ), (
                "a first-party canary diagnostic disappeared when toggling "
                f"skipLibCheck={skip_lib_check}"
            )


def test_application_exclude_keeps_markdown_data_out_of_program() -> None:
    """The application exclusion protects repository-owned Markdown payloads."""

    document = json.loads((WEB_ROOT / "tsconfig.json").read_text(encoding="utf-8"))
    assert document["exclude"] == ["src/assets/**/*.md"]
    document.pop("exclude")

    temporary_path: Path | None = None
    try:
        with NamedTemporaryFile(
            mode="w",
            encoding="utf-8",
            dir=WEB_ROOT,
            prefix=".tsconfig-no-markdown-exclude-",
            suffix=".json",
            delete=False,
        ) as handle:
            json.dump(document, handle)
            temporary_path = Path(handle.name)

        result = _run_probe(temporary_path, skip_lib_check=True)
        output = result.stdout + result.stderr
        assert result.returncode != 0
        assert "src/assets/agentExample" in output
        assert ".md(" in output
    finally:
        if temporary_path is not None:
            temporary_path.unlink(missing_ok=True)
