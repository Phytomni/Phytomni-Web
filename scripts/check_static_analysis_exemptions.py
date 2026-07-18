#!/usr/bin/env python3
"""Observe or exactly reconcile static-analysis findings.

The command is intentionally not wired into the repository's final gate yet.
Observation output is bounded and explicitly labelled ``NOT ENFORCED``.
"""

from __future__ import annotations

import argparse
import subprocess
import sys
from datetime import date
from pathlib import Path
from typing import Sequence

if __package__ in {None, ""}:  # pragma: no cover - direct script execution
    from static_analysis.collectors.ci import collect_ci_suppressions
    from static_analysis.collectors.config import collect_config_suppressions
    from static_analysis.collectors.errors import CollectionError
    from static_analysis.collectors.eslint import collect_eslint
    from static_analysis.collectors.go import collect_go_directives
    from static_analysis.collectors.helpers import tracked_files
    from static_analysis.collectors.repository_tools import (
        collect_repository_tool_exceptions,
    )
    from static_analysis.collectors.source import collect_source_suppressions
    from static_analysis.collectors.typescript import collect_typescript
    from static_analysis.inventory import Inventory, reconcile
    from static_analysis.model import RegistryError, load_registry
    from static_analysis.report import render_json, render_markdown
else:
    from scripts.static_analysis.collectors.ci import collect_ci_suppressions
    from scripts.static_analysis.collectors.config import collect_config_suppressions
    from scripts.static_analysis.collectors.errors import CollectionError
    from scripts.static_analysis.collectors.eslint import collect_eslint
    from scripts.static_analysis.collectors.go import collect_go_directives
    from scripts.static_analysis.collectors.helpers import tracked_files
    from scripts.static_analysis.collectors.repository_tools import (
        collect_repository_tool_exceptions,
    )
    from scripts.static_analysis.collectors.source import collect_source_suppressions
    from scripts.static_analysis.collectors.typescript import collect_typescript
    from scripts.static_analysis.inventory import Inventory, reconcile
    from scripts.static_analysis.model import RegistryError, load_registry
    from scripts.static_analysis.report import render_json, render_markdown


REPO_ROOT = Path(__file__).resolve().parent.parent
DEFAULT_COLLECTORS = ("source", "config", "ci")
COLLECTOR_NAMES = (
    "eslint",
    "typescript",
    "go",
    "repository_tools",
    "source",
    "config",
    "ci",
)
_FRONTEND_SUFFIXES = frozenset(
    {".cjs", ".js", ".jsx", ".mjs", ".mts", ".ts", ".tsx", ".vue", ".cts"}
)


def _git_paths(root: Path, command: Sequence[str]) -> tuple[Path, ...]:
    try:
        result = subprocess.run(
            list(command),
            cwd=root,
            capture_output=True,
            check=True,
        )
    except (OSError, subprocess.CalledProcessError) as exc:
        raise CollectionError(f"git scope query failed: {exc}") from exc
    names = result.stdout.decode("utf-8").split("\0")
    return tuple(
        sorted(
            (root / name for name in names if name and (root / name).is_file()),
            key=lambda path: path.as_posix(),
        )
    )


def _scope_files(root: Path, scope: str, range_ref: str | None) -> tuple[Path, ...]:
    if scope == "full":
        return tracked_files(root)
    if scope == "staged":
        return _git_paths(root, ("git", "diff", "--cached", "--name-only", "-z"))
    if not range_ref:
        raise CollectionError("range scope requires --range REF")
    return _git_paths(root, ("git", "diff", "--name-only", "-z", range_ref))


def _frontend_files(files: Sequence[Path]) -> tuple[Path, ...]:
    return tuple(
        path for path in files if path.suffix.lower() in _FRONTEND_SUFFIXES
    )


def collect_findings(
    root: Path,
    *,
    collectors: Sequence[str],
    scope: str = "full",
    range_ref: str | None = None,
) -> tuple:
    """Collect exact findings for the requested bounded surfaces."""

    files = _scope_files(root, scope, range_ref)
    frontend_files = _frontend_files(files)
    findings = []
    for name in collectors:
        if name == "source":
            findings.extend(collect_source_suppressions(root, files))
        elif name == "config":
            findings.extend(collect_config_suppressions(root))
        elif name == "ci":
            findings.extend(collect_ci_suppressions(root))
        elif name == "eslint":
            findings.extend(collect_eslint(root, frontend_files))
        elif name == "typescript":
            project = root / "apps" / "web" / "tsconfig.json"
            if project.is_file():
                findings.extend(
                    collect_typescript(
                        root,
                        project=project,
                        files=None if scope == "full" else frontend_files,
                    )
                )
        elif name == "go":
            findings.extend(
                collect_go_directives(
                    root, tuple(path for path in files if path.suffix == ".go")
                )
            )
        elif name == "repository_tools":
            findings.extend(collect_repository_tool_exceptions(root))
        else:  # pragma: no cover - argparse choices guard this branch
            raise CollectionError(f"unknown collector {name!r}")
    return tuple(
        sorted(
            findings,
            key=lambda item: (
                item.tool,
                item.rule,
                item.path,
                item.target,
                item.fingerprint,
            ),
        )
    )


def _parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description=__doc__)
    mode = parser.add_mutually_exclusive_group()
    mode.add_argument("--inventory", action="store_true", help="observe without failing mismatches")
    mode.add_argument("--check", action="store_true", help="fail on exact reconciliation mismatches")
    parser.add_argument("--json", action="store_true", help="render bounded JSON")
    parser.add_argument("--registry", type=Path, default=REPO_ROOT / "static-analysis-exemptions.toml")
    parser.add_argument("--scope", choices=("full", "staged", "range"), default="full")
    parser.add_argument("--range", dest="range_ref", help="git range for --scope range")
    parser.add_argument("--today", help="override reconciliation date (YYYY-MM-DD)")
    parser.add_argument("--collector", action="append", choices=COLLECTOR_NAMES)
    parser.add_argument("--write-ledger", type=Path)
    parser.add_argument("--check-ledger", type=Path)
    return parser


def _today(raw: str | None) -> date:
    if raw is None:
        return date.today()
    try:
        return date.fromisoformat(raw)
    except ValueError as exc:
        raise CollectionError(f"invalid --today value {raw!r}") from exc


def main(argv: Sequence[str] | None = None) -> int:
    args = _parser().parse_args(argv)
    root = REPO_ROOT.resolve()
    collector_names = tuple(dict.fromkeys(args.collector or DEFAULT_COLLECTORS))
    try:
        today = _today(args.today)
        registry_path = args.registry if args.registry.is_absolute() else root / args.registry
        registry = load_registry(registry_path.resolve(), today=today)
        findings = collect_findings(
            root,
            collectors=collector_names,
            scope=args.scope,
            range_ref=args.range_ref,
        )
        reconciliation = reconcile(findings, registry, today=today)
        inventory = Inventory(
            findings=findings,
            registry=registry,
            reconciliation=reconciliation,
            scope=args.scope,
            collectors=collector_names,
        )
        markdown = render_markdown(inventory)
        if args.write_ledger is not None:
            args.write_ledger.write_text(markdown, encoding="utf-8")
        if args.check_ledger is not None:
            expected = args.check_ledger.read_text(encoding="utf-8")
            if expected != markdown:
                print("static-analysis: ledger differs", file=sys.stderr)
                return 1
        print(render_json(inventory) if args.json else markdown, end="")
        if args.check and (
            reconciliation.unregistered
            or reconciliation.stale
            or reconciliation.duplicates
            or reconciliation.expired
        ):
            return 1
        return 0
    except (CollectionError, RegistryError, OSError, UnicodeError) as exc:
        # Do not echo tool stderr, source bodies, or fixture values into CLI logs.
        print(f"static-analysis: failed closed ({type(exc).__name__})", file=sys.stderr)
        return 2


if __name__ == "__main__":
    raise SystemExit(main())
