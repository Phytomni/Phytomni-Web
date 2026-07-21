#!/usr/bin/env python3
"""Validate tracked Markdown, YAML, and JSON repository surfaces.

The checker separates semantic parsing from formatter ownership. Generated,
biological, legal, and contract-fixture files remain parse-only; formatting is
delegated to the repository's pinned Web Prettier installation.
"""

from __future__ import annotations

import argparse
import json
import re
import subprocess
import sys
from dataclasses import dataclass
from pathlib import Path
from typing import Iterable, Sequence


REPO_ROOT = Path(__file__).resolve().parent.parent
FORMAT_SUFFIXES = frozenset({".json", ".markdown", ".md", ".yaml", ".yml"})
PARSE_ONLY_PREFIXES = (
    ".codex/",
    ".superpowers/",
    "apps/server/external/bot/testdata/",
    "apps/web/src/assets/agentExample/",
    "apps/web/src/assets/agentOut/",
    "apps/web/src/legal/",
    "apps/web/tests/fixtures/",
    "scripts/tests/static_analysis/fixtures/",
)
PARSE_ONLY_EXACT = frozenset(
    {
        "apps/web/package-lock.json",
        "docs/development/static-analysis-exemptions.md",
    }
)
PARSE_ONLY_RATIONALES = {
    "apps/web/package-lock.json": "dependency lockfile is parse-only to preserve byte identity",
    "docs/development/static-analysis-exemptions.md": "generated ledger is parse-only; its generator owns byte identity",
}
PRETTIER_IGNORE_PREFIXES = (
    "apps/web/public/static/downloads/",
    "apps/web/public/static/pdb/",
    "apps/web/public/static/js/3Dmol-min.js",
)
MAX_MESSAGE_LENGTH = 200


@dataclass(frozen=True)
class Finding:
    """One bounded repository-file diagnostic."""

    path: str
    rule: str
    message: str
    line: int | None = None


class _DuplicateKey(ValueError):
    pass


def _display_path(path: Path, root: Path | None = None) -> str:
    if root is not None:
        try:
            return path.resolve().relative_to(root.resolve()).as_posix()
        except ValueError:
            pass
    return path.as_posix()


def _finding(path: str, rule: str, message: str, line: int | None = None) -> Finding:
    return Finding(path, rule, message[:MAX_MESSAGE_LENGTH], line)


def read_nul_paths(raw: bytes) -> tuple[str, ...]:
    """Decode a NUL-delimited Git path stream without losing spaces/newlines."""

    return tuple(item.decode("utf-8") for item in raw.split(b"\0") if item)


def parse_only_reason(path: Path) -> str | None:
    """Return the exact parse-only rationale for a repository-relative path."""

    name = path.as_posix()
    if name.startswith("./"):
        name = name[2:]
    if name in PARSE_ONLY_EXACT:
        return PARSE_ONLY_RATIONALES[name]
    for prefix in PARSE_ONLY_PREFIXES:
        if name.startswith(prefix):
            return f"{prefix} is a generated, legal, biological, or contract-fixture surface"
    for prefix in PRETTIER_IGNORE_PREFIXES:
        if name.startswith(prefix):
            return f"{prefix} is an explicit Prettier data/binary exclusion"
    return None


def formatting_paths(paths: Iterable[Path]) -> tuple[Path, ...]:
    """Select eligible formatter-owned paths while preserving input order."""

    selected: list[Path] = []
    seen: set[Path] = set()
    for path in paths:
        if path in seen or path.suffix.lower() not in FORMAT_SUFFIXES:
            continue
        seen.add(path)
        if parse_only_reason(path) is None:
            selected.append(path)
    return tuple(selected)


def _json_object(pairs: list[tuple[str, object]]) -> dict[str, object]:
    result: dict[str, object] = {}
    for key, value in pairs:
        if key in result:
            raise _DuplicateKey
        result[key] = value
    return result


def check_json_text(path: str, text: str) -> list[Finding]:
    """Parse JSON and reject duplicate object keys without echoing content."""

    try:
        json.loads(text, object_pairs_hook=_json_object)
    except _DuplicateKey:
        return [_finding(path, "duplicate-json-key", "duplicate JSON object key")]
    except json.JSONDecodeError as exc:
        return [_finding(path, "json-parse", "malformed JSON", exc.lineno)]
    return []


_FENCE_RE = re.compile(r"^\s*(`{3,}|~{3,})")
_HEADING_RE = re.compile(r"^\s{0,3}(#{1,6})(?:\s|$)")
_LINK_RE = re.compile(r"\[[^\]]*\]\(([^)]*)\)")


def check_markdown_text(path: str, text: str) -> list[Finding]:
    """Check Markdown fences, heading progression, and unsafe links."""

    findings: list[Finding] = []
    fence_char: str | None = None
    fence_length = 0
    previous_heading = 0
    for line_number, line in enumerate(text.splitlines(), start=1):
        fence = _FENCE_RE.match(line)
        if fence is not None:
            marker = fence.group(1)
            if fence_char is None:
                fence_char, fence_length = marker[0], len(marker)
            elif marker[0] == fence_char and len(marker) >= fence_length:
                fence_char = None
                fence_length = 0
            continue
        if fence_char is not None:
            continue

        heading = _HEADING_RE.match(line)
        if heading is not None:
            level = len(heading.group(1))
            if previous_heading and level > previous_heading + 1:
                findings.append(
                    _finding(path, "heading-jump", "Markdown heading level jumps", line_number)
                )
            previous_heading = level

        for link in _LINK_RE.finditer(line):
            destination = link.group(1).strip()
            if destination.startswith("<") and destination.endswith(">"):
                destination = destination[1:-1].strip()
            if not destination:
                findings.append(
                    _finding(path, "empty-link", "Markdown link has an empty destination", line_number)
                )
            elif destination.lower().startswith("file://"):
                findings.append(
                    _finding(path, "unsafe-link", "Markdown file:// links are not allowed", line_number)
                )

    if fence_char is not None:
        findings.append(_finding(path, "unclosed-fence", "Markdown code fence is not closed"))
    return findings


def _prettier_check(path: Path, prettier_bin: Path) -> tuple[int, str]:
    result = subprocess.run(
        [str(prettier_bin), "--check", str(path)],
        cwd=prettier_bin.parent.parent,
        check=False,
        capture_output=True,
        text=True,
    )
    output = (result.stdout or result.stderr or "").strip().splitlines()
    return result.returncode, (output[-1] if output else "Prettier failed")[:MAX_MESSAGE_LENGTH]


def check_file(
    path: Path,
    *,
    root: Path = REPO_ROOT,
    prettier_bin: Path | None = None,
) -> list[Finding]:
    """Check one structured file, parsing all JSON/YAML and formatting owned files."""

    suffix = path.suffix.lower()
    if suffix not in FORMAT_SUFFIXES or not path.is_file():
        return []
    display = _display_path(path, root)
    try:
        text = path.read_text(encoding="utf-8")
    except UnicodeDecodeError:
        return [_finding(display, "utf8", "file is not valid UTF-8")]

    parse_only = parse_only_reason(Path(display)) is not None
    findings: list[Finding] = []
    if suffix == ".json":
        findings.extend(check_json_text(display, text))
    elif suffix in {".md", ".markdown"}:
        if not parse_only:
            findings.extend(check_markdown_text(display, text))

    if suffix in {".json", ".md", ".markdown"} and (parse_only or findings):
        return findings
    if not parse_only and not text.endswith("\n"):
        findings.append(_finding(display, "final-newline", "formatter-owned file must end with one newline"))

    prettier = prettier_bin or root / "apps" / "web" / "node_modules" / ".bin" / "prettier"
    if not prettier.is_file():
        return findings + [_finding(display, "prettier-missing", "pinned Prettier binary is unavailable")]
    returncode, message = _prettier_check(path, prettier)
    if parse_only:
        if returncode > 1:
            findings.append(_finding(display, "yaml-parse", message))
        return findings
    if returncode == 1:
        findings.append(_finding(display, "prettier-format", message))
    elif returncode > 1:
        rule = "yaml-parse" if suffix in {".yaml", ".yml"} else "markdown-parse" if suffix in {".md", ".markdown"} else "json-parse"
        findings.append(_finding(display, rule, message))
    return findings


def _git_paths(root: Path, args: Sequence[str]) -> tuple[Path, ...]:
    result = subprocess.run(
        ["git", *args], cwd=root, check=True, capture_output=True
    )
    return tuple(root / name for name in read_nul_paths(result.stdout))


def scope_paths(
    root: Path,
    *,
    scope: str = "full",
    files_from0: Path | None = None,
    range_ref: str | None = None,
) -> tuple[Path, ...]:
    """Resolve full, staged, range, or explicit NUL-delimited scopes."""

    if files_from0 is not None:
        return tuple(root / name for name in read_nul_paths(files_from0.read_bytes()))
    if scope == "full":
        return _git_paths(root, ["ls-files", "-z"])
    if scope == "staged":
        return _git_paths(root, ["diff", "--cached", "--name-only", "-z"])
    if scope == "range" and range_ref:
        return _git_paths(root, ["diff", "--name-only", "-z", range_ref])
    raise ValueError("range scope requires --range REF")


def check_paths(root: Path, paths: Iterable[Path]) -> list[Finding]:
    findings: list[Finding] = []
    for path in paths:
        findings.extend(check_file(path, root=root))
    return findings


def _parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--check", action="store_true", help="fail when findings exist")
    parser.add_argument("--scope", choices=("full", "staged", "range"), default="full")
    parser.add_argument("--range", dest="range_ref")
    parser.add_argument("--files-from0", type=Path)
    return parser


def main(argv: Sequence[str] | None = None) -> int:
    args = _parser().parse_args(argv)
    try:
        paths = scope_paths(
            REPO_ROOT,
            scope=args.scope,
            files_from0=args.files_from0,
            range_ref=args.range_ref,
        )
        findings = check_paths(REPO_ROOT, paths)
    except (OSError, ValueError, subprocess.CalledProcessError) as exc:
        print(f"repository file check failed: {str(exc)[:MAX_MESSAGE_LENGTH]}", file=sys.stderr)
        return 2
    for finding in findings:
        location = f"{finding.path}:{finding.line}" if finding.line else finding.path
        print(f"{location} [{finding.rule}] {finding.message}", file=sys.stderr)
    return 1 if findings else 0


if __name__ == "__main__":
    raise SystemExit(main())
