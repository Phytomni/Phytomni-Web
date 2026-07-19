#!/usr/bin/env python3
"""Collect and exactly reconcile static-analysis findings.

Inventory mode remains available for diagnostics; final gates use ``--check``
and never treat an observation report as authorization.
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
    from static_analysis.inventory import (
        Inventory,
        reconcile,
        select_registry_for_collectors,
    )
    from static_analysis.model import RegistryError, load_registry
    from static_analysis.report import (
        render_json,
        render_ledger,
        render_markdown,
        render_temporary_candidates,
    )
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
    from scripts.static_analysis.inventory import (
        Inventory,
        reconcile,
        select_registry_for_collectors,
    )
    from scripts.static_analysis.model import RegistryError, load_registry
    from scripts.static_analysis.report import (
        render_json,
        render_ledger,
        render_markdown,
        render_temporary_candidates,
    )


REPO_ROOT = Path(__file__).resolve().parent.parent
DEFAULT_COLLECTORS = ("source", "config", "ci")
CANDIDATE_COLLECTORS = ("eslint", "typescript", "source", "config", "ci", "go")
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
    mode.add_argument(
        "--emit-temporary-candidates",
        action="store_true",
        help="render exact temporary records without approving them",
    )
    parser.add_argument("--json", action="store_true", help="render bounded JSON")
    parser.add_argument("--registry", type=Path, default=REPO_ROOT / "static-analysis-exemptions.toml")
    parser.add_argument("--scope", choices=("full", "staged", "range"), default="full")
    parser.add_argument("--range", dest="range_ref", help="git range for --scope range")
    parser.add_argument("--today", help="override reconciliation date (YYYY-MM-DD)")
    parser.add_argument("--collector", action="append", choices=COLLECTOR_NAMES)
    parser.add_argument("--write-ledger", type=Path)
    parser.add_argument("--check-ledger", type=Path)
    parser.add_argument("--owner")
    parser.add_argument("--expires-on")
    parser.add_argument("--remediation-prefix")
    parser.add_argument("--output", type=Path)
    parser.add_argument(
        "--merge",
        action="store_true",
        help="preserve existing registry records while adding candidates",
    )
    return parser


def _today(raw: str | None) -> date:
    if raw is None:
        return date.today()
    try:
        return date.fromisoformat(raw)
    except ValueError as exc:
        raise CollectionError(f"invalid --today value {raw!r}") from exc


def _required_option(value: str | None, name: str) -> str:
    if value is None or not value.strip() or "\n" in value or "\r" in value:
        raise CollectionError(f"{name} is required and must be a single-line value")
    return value.strip()


def _expires_on(raw: str | None) -> date:
    value = _required_option(raw, "--expires-on")
    try:
        return date.fromisoformat(value)
    except ValueError as exc:
        raise CollectionError(f"invalid --expires-on value {value!r}") from exc


def main(argv: Sequence[str] | None = None) -> int:
    args = _parser().parse_args(argv)
    root = REPO_ROOT.resolve()
    collector_names = tuple(
        dict.fromkeys(
            args.collector
            or (CANDIDATE_COLLECTORS if args.emit_temporary_candidates else DEFAULT_COLLECTORS)
        )
    )
    try:
        today = _today(args.today)
        registry_path = args.registry if args.registry.is_absolute() else root / args.registry
        registry = load_registry(registry_path.resolve(), today=today)
        if args.emit_temporary_candidates:
            if args.output is None:
                raise CollectionError("--output is required with --emit-temporary-candidates")
            owner = _required_option(args.owner, "--owner")
            remediation_prefix = _required_option(
                args.remediation_prefix, "--remediation-prefix"
            )
            expires_on = _expires_on(args.expires_on)
            if expires_on < today:
                raise CollectionError("--expires-on may not precede --today")
            if registry.exemptions and not args.merge:
                raise CollectionError(
                    "non-empty registry requires explicit --merge for candidate generation"
                )
            findings = collect_findings(
                root,
                collectors=collector_names,
                scope=args.scope,
                range_ref=args.range_ref,
            )
            rendered = render_temporary_candidates(
                findings,
                registry,
                owner=owner,
                introduced_on=today,
                review_on=today,
                expires_on=expires_on,
                remediation_prefix=remediation_prefix,
            )
            output_path = args.output if args.output.is_absolute() else root / args.output
            output_path.write_text(rendered, encoding="utf-8")
            # Validate the generated document before reporting success. This
            # keeps candidate generation fail-closed under the same schema as
            # the committed registry.
            load_registry(output_path, today=today)
            return 0
        findings = collect_findings(
            root,
            collectors=collector_names,
            scope=args.scope,
            range_ref=args.range_ref,
        )
        scoped_registry = select_registry_for_collectors(registry, collector_names)
        reconciliation = reconcile(findings, scoped_registry, today=today)
        inventory = Inventory(
            findings=findings,
            registry=scoped_registry,
            reconciliation=reconciliation,
            scope=args.scope,
            collectors=collector_names,
        )
        markdown = render_ledger(inventory)
        if args.write_ledger is not None:
            args.write_ledger.write_text(markdown, encoding="utf-8")
        if args.check_ledger is not None:
            expected = args.check_ledger.read_text(encoding="utf-8")
            if expected != markdown:
                print("static-analysis: ledger differs", file=sys.stderr)
                return 1
        rendered = (
            render_json(inventory, enforced=args.check)
            if args.json
            else render_markdown(inventory, enforced=args.check)
        )
        print(rendered, end="")
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
