"""Collect suppressive flags and fallback-success commands from CI files."""

from __future__ import annotations

import re
from pathlib import Path

from ..model import Finding, Mechanism, TargetKind
from .helpers import make_finding, relative_path, tracked_files


_FLAG_RE = re.compile(
    r"(?P<flag>--(?:quiet|max-warnings|ignore-pattern|ignore-path|"
    r"no-error-on-unmatched-pattern|allow-empty|disable|ignore))"
    r"(?:=(?P<equals>[^\s]+)|\s+(?P<argument>\"[^\"]*\"|'[^']*'|(?!--)[^\s;&|]+))?"
)
_EMPTY_ARGUMENT_RE = re.compile(
    r"--(?:quiet|max-warnings|ignore-pattern|ignore-path|disable|ignore)"
    r"\s+(?:\"\"|'')"
)
_TOOL_NAMES = ("eslint", "prettier", "tsc", "typescript", "pylint", "ruff", "go")


def _candidate_paths(root: Path) -> tuple[Path, ...]:
    paths: list[Path] = []
    if (root / ".git").exists():
        candidates = tracked_files(root)
    else:
        candidates = tuple(root.rglob("*"))
    for path in candidates:
        if not path.is_file():
            continue
        if any(
            part in {".git", "node_modules", "dist", "coverage"}
            for part in path.parts
        ):
            continue
        if path.name in {"Makefile", "makefile"} or path.suffix in {
            ".sh",
            ".yml",
            ".yaml",
        }:
            if (
                ".github" in path.parts
                or path.suffix == ".sh"
                or path.name.lower() == "makefile"
            ):
                paths.append(path)
    return tuple(sorted(paths, key=lambda item: relative_path(root, item)))


def _shell_code(line: str) -> str:
    """Remove a shell comment without treating a quoted ``#`` as syntax."""

    quote: str | None = None
    for index, char in enumerate(line):
        if char in "'\"" and (index == 0 or line[index - 1] != "\\"):
            quote = None if quote == char else char if quote is None else quote
        elif char == "#" and quote is None:
            return line[:index]
    return line


def _tool_for_line(line: str) -> str:
    lowered = line.lower()
    for tool in _TOOL_NAMES:
        if tool in lowered:
            return tool
    return "github-actions" if "run:" in lowered else "shell"


def _finding(
    root: Path,
    path: Path,
    line_number: int,
    line: str,
    *,
    rule: str,
    target: str,
    tool: str,
) -> Finding:
    return make_finding(
        root=root,
        path=path,
        tool=tool,
        rule=rule,
        mechanism=Mechanism.COMMAND,
        target_kind=TargetKind.COMMAND,
        target=target,
        message=line.strip(),
        display_line=line_number,
        source=line,
        evidence=(line,),
    )


def _flag_findings(
    root: Path, path: Path, line_number: int, line: str
) -> list[Finding]:
    findings: list[Finding] = []
    tool = _tool_for_line(line)
    for match in _FLAG_RE.finditer(_shell_code(line)):
        flag = match.group("flag")
        argument = match.group("equals") or match.group("argument")
        argument_text = argument.strip("\"'") if argument is not None else None
        target = flag if argument is None else f"{flag}={argument_text}"
        findings.append(
            _finding(
                root,
                path,
                line_number,
                line,
                rule=flag.removeprefix("--"),
                target=target,
                tool=tool,
            )
        )
        if argument_text == "":
            findings.append(
                _finding(
                    root,
                    path,
                    line_number,
                    line,
                    rule="empty-argument",
                    target=flag,
                    tool=tool,
                )
            )
        if argument_text and any(char in argument_text for char in "*?["):
            findings.append(
                _finding(
                    root,
                    path,
                    line_number,
                    line,
                    rule="unbounded-path-pattern",
                    target=argument_text,
                    tool=tool,
                )
            )
    if _EMPTY_ARGUMENT_RE.search(_shell_code(line)) and not any(
        finding.rule == "empty-argument" and finding.display_line == line_number
        for finding in findings
    ):
        findings.append(
            _finding(
                root,
                path,
                line_number,
                line,
                rule="empty-argument",
                target="empty",
                tool=tool,
            )
        )
    return findings


def collect_ci_suppressions(root: Path) -> tuple[Finding, ...]:
    """Collect CI/workflow/shell mechanisms without deciding if they are valid."""

    findings: list[Finding] = []
    for path in _candidate_paths(root):
        for line_number, line in enumerate(
            path.read_text(encoding="utf-8").splitlines(), start=1
        ):
            code = _shell_code(line)
            if not code.strip():
                continue
            if re.search(r"^\s*continue-on-error\s*:\s*true\b", code):
                findings.append(
                    _finding(
                        root,
                        path,
                        line_number,
                        line,
                        rule="continue-on-error",
                        target="continue-on-error",
                        tool="github-actions",
                    )
                )
            if re.search(r"\|\|\s*true\b", code):
                findings.append(
                    _finding(
                        root,
                        path,
                        line_number,
                        line,
                        rule="shell-fallback-success",
                        target="|| true",
                        tool="shell",
                    )
                )
            findings.extend(_flag_findings(root, path, line_number, line))
    return tuple(
        sorted(
            findings,
            key=lambda item: (
                item.path,
                item.display_line or 0,
                item.rule,
                item.target,
            ),
        )
    )
