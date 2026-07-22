"""Inventory tracked repository-tool exceptions without running new binaries."""

from __future__ import annotations

import json
import re
from collections.abc import Iterable
from pathlib import Path

from ..fingerprints import normalize_source
from ..model import Finding, Mechanism, TargetKind
from .errors import CollectionError
from .helpers import make_finding, relative_path, tracked_files


_EXCLUDED_PARTS = frozenset(
    {".git", "node_modules", "dist", "coverage", ".codegraph", "vendor"}
)
_TEXT_SUFFIXES = frozenset(
    {
        ".bash",
        ".cjs",
        ".go",
        ".json",
        ".js",
        ".md",
        ".mjs",
        ".py",
        ".sh",
        ".toml",
        ".ts",
        ".tsx",
        ".vue",
        ".yaml",
        ".yml",
    }
)
_SHELLCHECK_RE = re.compile(
    r"^\s*#\s*shellcheck\s+disable=(?P<rules>[^\s]+)", re.IGNORECASE
)
_SHFMT_RE = re.compile(r"^\s*#\s*shfmt:\s*(?P<rule>skip)\b", re.IGNORECASE)
_ACTIONLINT_RE = re.compile(
    r"^\s*#\s*actionlint-(?P<rule>ignore|disable)\b", re.IGNORECASE
)
_YAMLLINT_RE = re.compile(
    r"(?:^|\s)#\s*yamllint\s+(?P<rule>disable-line|disable|enable)\b",
    re.IGNORECASE,
)
_MARKDOWNLINT_RE = re.compile(
    r"<!--\s*markdownlint-(?P<action>disable|enable)\s*(?P<rules>[^-]*?)\s*-->",
    re.IGNORECASE,
)
_PRETTIER_RE = re.compile(
    r"(?:^|//|#|<!--)\s*prettier-ignore\b", re.IGNORECASE
)
_SECRET_RE = re.compile(
    r"(?://|#|<!--)\s*(?P<rule>pragma:\s*allowlist\s+secret|nosec)\b",
    re.IGNORECASE,
)


def _fixture_or_tracked(root: Path) -> tuple[Path, ...]:
    if (root / ".git").exists():
        return tracked_files(root)
    return tuple(sorted((path for path in root.rglob("*") if path.is_file())))


def _excluded(root: Path, path: Path) -> bool:
    try:
        relative = path.resolve().relative_to(root.resolve())
    except ValueError:
        return True
    parts = set(relative.parts)
    if parts & _EXCLUDED_PARTS:
        return True
    return "evidence" in parts and ".codex" in parts


def _candidate_files(root: Path) -> tuple[Path, ...]:
    return tuple(
        path
        for path in _fixture_or_tracked(root)
        if path.is_file()
        and (path.suffix.lower() in _TEXT_SUFFIXES or path.name == ".shfmtignore")
        and not _excluded(root, path)
    )


def _finding(
    root: Path,
    path: Path,
    *,
    tool: str,
    rule: str,
    target: str,
    message: str,
    mechanism: Mechanism,
    target_kind: TargetKind,
    line: int | None,
) -> Finding:
    return make_finding(
        root=root,
        path=path,
        tool=tool,
        rule=rule,
        mechanism=mechanism,
        target_kind=target_kind,
        target=target,
        message=message,
        display_line=line,
        source=message,
        evidence=(message,),
    )


def _inline_findings(root: Path, path: Path, text: str) -> Iterable[Finding]:
    is_shell = path.suffix.lower() in {".sh", ".bash"}
    is_yaml = path.suffix.lower() in {".yaml", ".yml"}
    is_markdown = path.suffix.lower() == ".md"
    is_workflow = ".github/workflows" in relative_path(root, path)
    for line_number, line in enumerate(text.splitlines(), start=1):
        if is_shell:
            shellcheck = _SHELLCHECK_RE.match(line)
            if shellcheck is not None:
                for rule in shellcheck.group("rules").split(","):
                    rule = rule.strip()
                    if rule:
                        yield _finding(
                            root,
                            path,
                            tool="shellcheck",
                            rule=rule,
                            target=f"shellcheck:disable={rule}",
                            message=line.strip(),
                            mechanism=Mechanism.INLINE,
                            target_kind=TargetKind.SPAN,
                            line=line_number,
                        )
            shfmt = _SHFMT_RE.match(line)
            if shfmt is not None:
                yield _finding(
                    root,
                    path,
                    tool="shfmt",
                    rule=shfmt.group("rule").lower(),
                    target=f"shfmt:{shfmt.group('rule').lower()}",
                    message=line.strip(),
                    mechanism=Mechanism.INLINE,
                    target_kind=TargetKind.SPAN,
                    line=line_number,
                )
        if is_workflow:
            actionlint = _ACTIONLINT_RE.match(line)
            if actionlint is not None:
                rule = actionlint.group("rule").lower()
                yield _finding(
                    root,
                    path,
                    tool="actionlint",
                    rule=rule,
                    target=f"actionlint:{rule}",
                    message=line.strip(),
                    mechanism=Mechanism.INLINE,
                    target_kind=TargetKind.SPAN,
                    line=line_number,
                )
        if is_yaml:
            yamllint = _YAMLLINT_RE.search(line)
            if yamllint is not None:
                rule = yamllint.group("rule").lower()
                yield _finding(
                    root,
                    path,
                    tool="yamllint",
                    rule=rule,
                    target=f"yamllint:{rule}",
                    message=line.strip(),
                    mechanism=Mechanism.INLINE,
                    target_kind=TargetKind.SPAN,
                    line=line_number,
                )
        if is_markdown:
            markdownlint = _MARKDOWNLINT_RE.search(line)
            if markdownlint is not None:
                rules = markdownlint.group("rules").strip() or "*"
                for rule in rules.split(","):
                    rule = rule.strip() or "*"
                    yield _finding(
                        root,
                        path,
                        tool="markdownlint",
                        rule=rule,
                        target=f"markdownlint:{markdownlint.group('action').lower()}:{rule}",
                        message=line.strip(),
                        mechanism=Mechanism.INLINE,
                        target_kind=TargetKind.SPAN,
                        line=line_number,
                    )
            if _PRETTIER_RE.search(line):
                yield _finding(
                    root,
                    path,
                    tool="prettier",
                    rule="ignore",
                    target="prettier:ignore",
                    message=line.strip(),
                    mechanism=Mechanism.INLINE,
                    target_kind=TargetKind.SPAN,
                    line=line_number,
                )
        if _SECRET_RE.search(line):
            match = _SECRET_RE.search(line)
            assert match is not None
            rule = normalize_source(match.group("rule")).lower()
            display_rule = (
                "pragma: allowlist secret"
                if rule.startswith("pragma:")
                else "nosec"
            )
            yield _finding(
                root,
                path,
                tool="secret-scan",
                rule=display_rule,
                target=f"secret:{display_rule}",
                message=line.strip(),
                mechanism=Mechanism.INLINE,
                target_kind=TargetKind.SPAN,
                line=line_number,
            )


def _config_findings(root: Path, path: Path, text: str) -> Iterable[Finding]:
    name = path.name
    if name == ".markdownlint.json":
        try:
            document = json.loads(text)
        except json.JSONDecodeError as exc:
            raise CollectionError(f"repository tools: malformed {path}: {exc}") from exc
        if isinstance(document, dict):
            rules = document.get("rules", document)
            if isinstance(rules, dict):
                for rule, value in rules.items():
                    if value is False:
                        yield _finding(
                            root,
                            path,
                            tool="markdownlint",
                            rule="rule-off",
                            target=str(rule),
                            message=f"{rule}=false",
                            mechanism=Mechanism.CONFIG,
                            target_kind=TargetKind.CONFIG,
                            line=None,
                        )
    if name == ".shfmtignore":
        for line in text.splitlines():
            pattern = line.strip()
            if not pattern or pattern.startswith("#"):
                continue
            yield _finding(
                root,
                path,
                tool="shfmt",
                rule="ignore",
                target=pattern,
                message=pattern,
                mechanism=Mechanism.CONFIG,
                target_kind=TargetKind.CONFIG,
                line=None,
            )
    if name in {".yamllint", ".yamllint.yml", ".yamllint.yaml"}:
        for line in text.splitlines():
            match = re.match(r"^\s*ignore\s*:\s*(\S+)", line)
            if match is None:
                continue
            yield _finding(
                root,
                path,
                tool="yamllint",
                rule="ignore",
                target=match.group(1),
                message=line.strip(),
                mechanism=Mechanism.CONFIG,
                target_kind=TargetKind.CONFIG,
                line=None,
            )


def collect_repository_tool_exceptions(root: Path) -> tuple[Finding, ...]:
    """Scan tracked first-party files and exact repository tool configurations."""

    findings: list[Finding] = []
    for path in _candidate_files(root):
        try:
            text = path.read_text(encoding="utf-8")
        except (OSError, UnicodeDecodeError) as exc:
            raise CollectionError(f"repository tools: unable to read {path}: {exc}") from exc
        findings.extend(_inline_findings(root, path, text))
        findings.extend(_config_findings(root, path, text))
    return tuple(
        sorted(
            findings,
            key=lambda item: (
                item.tool,
                item.rule,
                item.path,
                item.display_line or 0,
                item.target,
            ),
        )
    )


__all__ = ["collect_repository_tool_exceptions"]
