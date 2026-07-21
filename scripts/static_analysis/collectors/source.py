"""Collect exact inline suppression directives from tracked source files."""

from __future__ import annotations

import re
from collections.abc import Iterable, Sequence
from pathlib import Path

from ..model import Finding, Mechanism, TargetKind
from .helpers import make_finding, relative_path


_ESLINT_RE = re.compile(
    r"^(?P<directive>eslint-(?:disable|enable)(?:-(?:next-line|line))?)"
    r"(?:\s+(?P<rules>.*?))?$",
    re.IGNORECASE,
)
_TS_RE = re.compile(r"^(?P<directive>@ts-(?:expect-error|ignore|nocheck))\b")
_NOLINT_RE = re.compile(r"^nolint(?::(?P<rules>[^\s]+))?\b", re.IGNORECASE)
_TYPE_IGNORE_RE = re.compile(
    r"^(?P<tool>type|mypy|pyright)\s*:\s*ignore"
    r"(?:\[(?P<rules>[^]]*)\])?(?:\s+.*)?$",
    re.IGNORECASE,
)
_NOQA_RE = re.compile(r"^(?:noqa|ruff:\s*noqa|flake8:\s*noqa)\b", re.IGNORECASE)
_NOSEC_RE = re.compile(r"^nosec(?:\s+(?P<rules>.*))?$", re.IGNORECASE)
_TEXT_SUFFIXES = frozenset(
    {
        ".cjs",
        ".go",
        ".ini",
        ".js",
        ".json",
        ".jsx",
        ".md",
        ".mjs",
        ".py",
        ".pyi",
        ".sh",
        ".toml",
        ".ts",
        ".tsx",
        ".vue",
        ".yaml",
        ".yml",
    }
)


def _rules(raw: str | None) -> tuple[str, ...]:
    if raw is None:
        return ("*",)
    values = tuple(item.strip() for item in re.split(r"[,\s]+", raw) if item.strip())
    return values or ("*",)


def _comment_bodies(lines: Sequence[str]) -> Iterable[tuple[int, str]]:
    """Yield comments while avoiding marker-looking strings."""

    block = False
    for line_number, line in enumerate(lines, start=1):
        i = 0
        quote: str | None = None
        while i < len(line):
            char = line[i]
            if quote is not None:
                if char == "\\":
                    i += 2
                    continue
                if char == quote:
                    quote = None
                i += 1
                continue
            if char in "'\"`":
                quote = char
                i += 1
                continue

            if block:
                end = line.find("*/", i)
                body = line[i:] if end == -1 else line[i:end]
                if body.strip():
                    yield line_number, body.strip().lstrip("*").strip()
                if end == -1:
                    break
                block = False
                i = end + 2
                continue
            if line.startswith("/*", i):
                block = True
                i += 2
                continue
            if line.startswith("//", i):
                yield line_number, line[i + 2 :].strip()
                break
            if line.startswith("<!--", i):
                end = line.find("-->", i + 4)
                body = line[i + 4 :] if end == -1 else line[i + 4 : end]
                if body.strip():
                    yield line_number, body.strip()
                break
            if char == "#":
                yield line_number, line[i + 1 :].strip()
                break
            i += 1


def _directive(body: str) -> tuple[str, str, str, tuple[str, ...]] | None:
    """Return ``tool, rule, mechanism, rules`` for a live comment marker."""

    eslint = _ESLINT_RE.fullmatch(body.split(" --", 1)[0].rstrip())
    if eslint is not None:
        directive = eslint.group("directive").lower()
        return "eslint", directive, "inline", _rules(eslint.group("rules"))

    ts = _TS_RE.match(body)
    if ts is not None:
        directive = ts.group("directive")
        return "typescript", directive, "inline", (directive,)

    if body.lower().startswith("prettier-ignore"):
        return "prettier", "prettier-ignore", "inline", ("prettier-ignore",)

    nolint = _NOLINT_RE.match(body)
    if nolint is not None:
        return "golangci-lint", "nolint", "inline", _rules(nolint.group("rules"))

    if body.startswith("go:build"):
        return "go", "go:build", "marker", ("go:build",)
    if body.startswith("go:generate"):
        return "go", "go:generate", "command", ("go:generate",)

    typing = _TYPE_IGNORE_RE.match(body)
    if typing is not None:
        tool = {"type": "mypy", "mypy": "mypy", "pyright": "pyright"}[
            typing.group("tool").lower()
        ]
        return tool, "type: ignore", "inline", _rules(typing.group("rules"))

    if _NOQA_RE.match(body) is not None:
        tool = "flake8" if body.lower().startswith("flake8") else "ruff"
        return tool, "noqa", "inline", _rules(body.split(":", 1)[-1])

    nosec = _NOSEC_RE.fullmatch(body)
    if nosec is not None:
        return "secret-scan", "nosec", "marker", _rules(nosec.group("rules"))
    if body.lower() == "pragma: allowlist secret":
        return "secret-scan", "pragma: allowlist secret", "marker", (
            "pragma: allowlist secret",
        )
    return None


def _source_call(line: str) -> tuple[str, str] | None:
    """Detect a source-level warning filter without matching prose/comments."""

    code = line.split("#", 1)[0].split("//", 1)[0]
    filterwarnings_call = "filter" + "warnings("
    if filterwarnings_call in code:
        return "python", "filterwarnings"
    return None


def _collect_file(root: Path, path: Path) -> Iterable[Finding]:
    if path.suffix.lower() not in _TEXT_SUFFIXES:
        return
    source = path.read_text(encoding="utf-8")
    lines = source.splitlines()
    for line_number, body in _comment_bodies(lines):
        parsed = _directive(body)
        if parsed is None:
            continue
        tool, rule_name, mechanism, rules = parsed
        for rule in rules:
            target = (
                f"line:{line_number}:{rule_name}:"
                f"{body.split(' --', 1)[0].strip()}"
            )
            yield make_finding(
                root=root,
                path=path,
                tool=tool,
                rule=rule,
                mechanism=mechanism,
                target_kind=TargetKind.SPAN,
                target=target,
                message=body,
                display_line=line_number,
                source=body,
                evidence=(lines[line_number - 1],),
            )
    for line_number, line in enumerate(lines, start=1):
        call = _source_call(line)
        if call is None:
            continue
        tool, rule = call
        yield make_finding(
            root=root,
            path=path,
            tool=tool,
            rule=rule,
            mechanism=Mechanism.DIAGNOSTIC,
            target_kind=TargetKind.SPAN,
            target="call:filterwarnings",
            message=line.strip(),
            display_line=line_number,
            source=line,
            evidence=(line,),
        )


def collect_source_suppressions(
    root: Path, files: Sequence[Path]
) -> tuple[Finding, ...]:
    """Collect supported source directives without granting authorization."""

    findings: list[Finding] = []
    for path in sorted(files, key=lambda item: relative_path(root, item)):
        if not path.is_file():
            continue
        findings.extend(_collect_file(root, path))
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
