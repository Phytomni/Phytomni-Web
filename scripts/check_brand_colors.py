#!/usr/bin/env python3
"""Enforce the frontend's read-only visual design contract.

The scanner keeps the competing-brand hex guard and rejects a small set of
high-signal regressions: unsafe global CSS, glass bubbles, page-local theme
overrides, retired infrastructure, fixed Footer owners, and unapproved viewport
fallbacks.  It intentionally treats source text as flat CSS and does not try to
model nested-SCSS selector semantics.
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


# A narrow exception is represented as (exact repository-relative path, exact
# literal, reason).  The tuple shape keeps this script importable by the
# standard-library unittest loader as well as executable as a script.
ContractException = tuple[str, str, str]


# Exceptions are intentionally literal + exact file + reason.  In particular,
# the viewport entries allow one top-level scroll owner, not a whole file.
VISUAL_CONTRACT_EXCEPTIONS: dict[str, tuple[ContractException, ...]] = {
    "theme-selector": (
        (
            "apps/web/src/styles/tokens.css",
            ".theme-dark",
            "semantic dark-mode token block",
        ),
    ),
    "viewport-100vh": (
        (
            "apps/web/src/components/shell/PhyAuthLayout.vue",
            ".phy-auth-layout",
            "auth shell owns its viewport scroll root",
        ),
        (
            "apps/web/src/components/shell/PhyAdaptiveShell.vue",
            ".phy-adaptive-shell",
            "adaptive chat shell owns its viewport scroll root",
        ),
        (
            "apps/web/src/views/help/HelpView.vue",
            ".help-page",
            "help document owns its viewport scroll root",
        ),
        (
            "apps/web/src/views/legal/LegalView.vue",
            ".legal-page",
            "legal document owns its viewport scroll root",
        ),
        (
            "apps/web/src/components/demo/AgentDemoShell.vue",
            ".agent-demo-shell",
            "static demo owns its viewport scroll root",
        ),
    ),
}

LEGACY_MARKERS = (
    "PhyAppShell",
    "PhySidebarFrame",
    "PhyComposerFrame",
    "useAgentsPanel",
    "useSidebarAgents",
    "message-fotter",
    "log-view-left",
    "log-view-right",
    "input-container-warpper",
    "input-container-bottom",
    "app-footer",
)

DECLARATION_RE = re.compile(
    r"(?P<property>-webkit-backdrop-filter|backdrop-filter|position|"
    r"-webkit-transition|transition|outline|height|min-height|max-height)"
    r"\s*:\s*(?P<value>[^;{}]+)",
    re.IGNORECASE,
)
BLOCK_RE = re.compile(r"(?P<selectors>[^{}]+)\{(?P<body>[^{}]*)\}", re.DOTALL)
UNIVERSAL_SELECTOR_RE = re.compile(r"^\*(?:(?:::|:)[a-z][a-z0-9_-]*)?$", re.IGNORECASE)
THEME_SELECTOR_RE = re.compile(r"(?<![\w-])\.theme-dark\b[^{}\n]*\{", re.IGNORECASE)
GLASS_BUBBLE_RE = re.compile(
    r"(?P<selectors>[^{}]*\.phy-bubble-(?:user|assistant)\b[^{}]*)"
    r"\{(?P<body>[^{}]*)\}",
    re.IGNORECASE | re.DOTALL,
)
GLASS_BUBBLE_BODY_RE = re.compile(
    r"(?:backdrop-filter|-webkit-backdrop-filter|opacity\s*:|"
    r"background(?:-color)?\s*:[^;{}]*(?:transparent|rgba?\(|hsla?\(|color-mix\())",
    re.IGNORECASE,
)


def _relative_path(path: Path) -> str:
    """Return a stable repository-relative path for allowlist comparisons."""
    try:
        return path.resolve().relative_to(ROOT.resolve()).as_posix()
    except ValueError:
        return path.as_posix()


def _is_allowlisted(rule: str, path: Path) -> bool:
    return _relative_path(path) in VISUAL_CONTRACT_ALLOWLIST.get(rule, frozenset())


def _is_exact_exception(rule: str, path: Path, literal: str) -> bool:
    relative = _relative_path(path)
    return any(
        exception[0] == relative and exception[1] == literal
        for exception in VISUAL_CONTRACT_EXCEPTIONS.get(rule, ())
    )


def _last_selector_line(selector_text: str) -> str:
    """Return the final selector line after a Vue style/script preamble."""
    lines = [line.strip() for line in selector_text.splitlines() if line.strip()]
    return lines[-1] if lines else ""


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


def _iter_block_declarations(
    text: str,
) -> list[tuple[re.Match[str], re.Match[str], int]]:
    """Return flat CSS block/declaration pairs and absolute declaration offsets."""
    declarations: list[tuple[re.Match[str], re.Match[str], int]] = []
    for block in BLOCK_RE.finditer(text):
        body_start = block.start("body")
        for declaration in DECLARATION_RE.finditer(block.group("body")):
            declarations.append((block, declaration, body_start + declaration.start()))
    return declarations


def _line_for_offset(text: str, offset: int) -> tuple[int, str]:
    line = text.count("\n", 0, offset) + 1
    source = text.splitlines()[line - 1].strip()
    return line, source


def _iter_theme_selector_violations(path: Path, text: str) -> list[tuple[int, str]]:
    violations: list[tuple[int, str]] = []
    for match in THEME_SELECTOR_RE.finditer(text):
        if _is_exact_exception("theme-selector", path, ".theme-dark"):
            continue
        line, source = _line_for_offset(text, match.start())
        violations.append((line, source))
    return violations


def _iter_glass_bubble_violations(text: str) -> list[tuple[int, str]]:
    violations: list[tuple[int, str]] = []
    for block in GLASS_BUBBLE_RE.finditer(text):
        if not GLASS_BUBBLE_BODY_RE.search(block.group("body")):
            continue
        line, source = _line_for_offset(text, block.start())
        violations.append((line, source))
    return violations


def should_skip_file(path: Path) -> bool:
    if path.name in SKIP_BASENAMES:
        return True
    return any(part in SKIP_PARTS for part in path.parts)


def _append_declaration_violations(path: Path, text: str, hits: list[str]) -> None:
    """Append high-signal CSS contract failures to ``hits``."""
    for block, declaration, absolute_offset in _iter_block_declarations(text):
        prop = declaration.group("property").lower()
        value = declaration.group("value").strip().lower()
        selector = _last_selector_line(block.group("selectors"))
        line, source = _line_for_offset(text, absolute_offset)
        if prop in {"backdrop-filter", "-webkit-backdrop-filter"}:
            if not _is_allowlisted("backdrop-filter", path):
                hits.append(f"{path}:{line}:{source} (agent-influenced backdrop-filter)")

        if prop in {"transition", "-webkit-transition"} and re.match(
            r"all(?:\s|$)", value
        ):
            hits.append(f"{path}:{line}:{source} (transition: all)")

        if prop == "outline" and re.match(r"(?:none|0|unset)(?:\s*!important)?$", value):
            hits.append(f"{path}:{line}:{source} (outline suppression)")

        if prop in {"height", "min-height", "max-height"} and re.match(
            r"100vh(?:\s*!important)?$", value
        ):
            if not _is_exact_exception("viewport-100vh", path, selector):
                hits.append(f"{path}:{line}:{source} (unauthorized 100vh owner)")

        if prop == "position" and re.match(r"fixed(?:\s*!important)?$", value):
            if "footer" in selector.lower():
                hits.append(f"{path}:{line}:{source} (fixed Footer owner)")

    for line, source, rule in _iter_global_selector_violations(text):
        if not _is_allowlisted("global-selector", path):
            hits.append(f"{path}:{line}:{source} ({rule})")

    for line, source in _iter_theme_selector_violations(path, text):
        hits.append(f"{path}:{line}:{source} (page-local .theme-dark selector)")

    for line, source in _iter_glass_bubble_violations(text):
        hits.append(f"{path}:{line}:{source} (glass bubble surface)")


def _append_legacy_marker_violations(path: Path, text: str, hits: list[str]) -> None:
    for i, line in enumerate(text.splitlines(), 1):
        for marker in LEGACY_MARKERS:
            if marker in line:
                hits.append(f"{path}:{i}:{line.strip()} (retired visual marker: {marker})")


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
            _append_legacy_marker_violations(file, text, hits)
    return hits


def main() -> int:
    targets = [WEB_SRC, INDEX]
    hits = scan_paths(targets)
    if hits:
        print("Frontend visual contract violations found:")
        for h in hits:
            print(h)
        return 1
    print("OK: frontend visual contract passed")
    return 0


if __name__ == "__main__":
    sys.exit(main())
