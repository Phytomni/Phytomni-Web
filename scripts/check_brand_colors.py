#!/usr/bin/env python3
"""Enforce the frontend's visual design contract.

The scanner is intentionally read-only.  It keeps the original competing-brand
hex guard and adds a small set of high-signal CSS checks that are unsafe for
agent-generated content or that create global layout/animation side effects:

* agent-influenced ``backdrop-filter`` declarations;
* universal-selector ``position: relative`` declarations; and
* universal-selector transition declarations.

Ordinary component ``transition: all`` declarations are deliberately outside
this gate.  They are migrated and guarded by the later CSS cleanup task.
"""
from __future__ import annotations

import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
WEB_SRC = ROOT / "apps" / "web" / "src"
INDEX = ROOT / "apps" / "web" / "index.html"

BANNED = [
    "409eff",
    "66b1ff",
    "1890ff",
    "626aef",
    "4b6bfb",
    "4f46e5",
    "7c3aed",
    "7171c6",
    "3aa3ed",
]
PATTERN = re.compile(
    r"#(?:" + "|".join(BANNED) + r")\b",
    re.IGNORECASE,
)
TEXT_SUFFIXES = {".vue", ".css", ".scss", ".ts", ".tsx", ".js", ".html"}
SKIP_BASENAMES = {"tokens.ts", "tokens.spec.ts"}
SKIP_PARTS = {"node_modules", ".git"}

# Keep this empty unless an unavoidable third-party/demo asset is reviewed and
# documented.  Active application files must never be added here as a shortcut.
# Values are repository-relative POSIX paths so the exception remains narrow.
VISUAL_CONTRACT_ALLOWLIST: dict[str, frozenset[str]] = {
    "backdrop-filter": frozenset(),
    "global-selector": frozenset(),
}

DECLARATION_RE = re.compile(
    r"(?P<property>-webkit-backdrop-filter|backdrop-filter|position|"
    r"-webkit-transition|transition)\s*:\s*(?P<value>[^;{}]+)",
    re.IGNORECASE,
)
BLOCK_RE = re.compile(r"(?P<selectors>[^{}]+)\{(?P<body>[^{}]*)\}", re.DOTALL)
UNIVERSAL_SELECTOR_RE = re.compile(r"^\*(?:(?:::|:)[a-z][a-z0-9_-]*)?$", re.IGNORECASE)


def _relative_path(path: Path) -> str:
    """Return a stable repository-relative path for allowlist comparisons."""
    try:
        return path.resolve().relative_to(ROOT.resolve()).as_posix()
    except ValueError:
        return path.as_posix()


def _is_allowlisted(rule: str, path: Path) -> bool:
    return _relative_path(path) in VISUAL_CONTRACT_ALLOWLIST.get(rule, frozenset())


def _is_universal_selector(selector: str) -> bool:
    """Whether a selector is the universal selector itself (including pseudo-elements)."""
    return bool(UNIVERSAL_SELECTOR_RE.fullmatch(selector.strip()))


def _iter_global_selector_violations(text: str) -> list[tuple[int, str, str]]:
    """Yield (line, source, rule) for unsafe declarations under ``*`` selectors."""
    violations: list[tuple[int, str, str]] = []
    for block in BLOCK_RE.finditer(text):
        selectors = block.group("selectors")
        if not any(_is_universal_selector(item) for item in selectors.split(",")):
            continue

        body = block.group("body")
        for declaration in DECLARATION_RE.finditer(body):
            prop = declaration.group("property").lower()
            value = declaration.group("value").strip().lower()
            rule: str | None = None
            if prop == "position" and re.match(r"relative\b", value):
                rule = "global wildcard position: relative"
            elif prop in {"transition", "-webkit-transition"}:
                rule = "global wildcard transition"
            if rule is not None:
                line = text.count("\n", 0, block.start() + declaration.start()) + 1
                source = text.splitlines()[line - 1].strip()
                violations.append((line, source, rule))
    return violations


def should_skip_file(path: Path) -> bool:
    if path.name in SKIP_BASENAMES:
        return True
    return any(part in SKIP_PARTS for part in path.parts)


def _append_declaration_violations(path: Path, text: str, hits: list[str]) -> None:
    """Append high-signal CSS contract failures to ``hits``."""
    lines = text.splitlines()

    for declaration in DECLARATION_RE.finditer(text):
        prop = declaration.group("property").lower()
        if prop in {"backdrop-filter", "-webkit-backdrop-filter"}:
            if not _is_allowlisted("backdrop-filter", path):
                line = text.count("\n", 0, declaration.start()) + 1
                source = lines[line - 1].strip()
                hits.append(f"{path}:{line}:{source} (agent-influenced backdrop-filter)")

    for line, source, rule in _iter_global_selector_violations(text):
        if not _is_allowlisted("global-selector", path):
            hits.append(f"{path}:{line}:{source} ({rule})")


def scan_paths(paths: list[Path]) -> list[str]:
    hits: list[str] = []
    for path in paths:
        if path.is_dir():
            files = [
                p
                for p in path.rglob("*")
                if p.suffix in TEXT_SUFFIXES and not should_skip_file(p)
            ]
        else:
            files = [] if should_skip_file(path) else [path]
        for file in files:
            try:
                text = file.read_text(encoding="utf-8")
            except (UnicodeDecodeError, OSError):
                continue
            for i, line in enumerate(text.splitlines(), 1):
                if PATTERN.search(line):
                    hits.append(f"{file}:{i}:{line.strip()}")
            _append_declaration_violations(file, text, hits)
    return hits


def main() -> int:
    targets = [WEB_SRC, INDEX]
    hits = scan_paths(targets)
    if hits:
        print("Banned brand color hardcodes found:")
        for h in hits:
            print(h)
        return 1
    print("OK: no banned brand color hardcodes")
    return 0


if __name__ == "__main__":
    sys.exit(main())
