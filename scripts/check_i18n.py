#!/usr/bin/env python3
# Copyright (c) Biotechnology Research Institute,
# Chinese Academy of Agricultural Sciences. 2024-2026. All rights reserved.
# Author: xieshang (xieshang0608@gmail.com)
#         guxiaofeng (guxiaofeng@caas.cn)
"""Scan the tree for hardcoded user-facing copy that should route through i18n.

Three rules:
  - cjk  : CJK characters in apps/web/src *.vue/*.ts (excluding *.spec.ts /
           *.test.ts) — should be a t()/$t() key.
  - toast: ElMessage/ElMessageBox called with a string literal first arg —
           should be t(...).
  - ginh : gin.H{"message": "<literal>"} in apps/server — should be
           i18n.T(ctx, key).

A two-layer allowlist gates results: a hardcoded PERMANENT layer (the
single-language policy allow-list + the ICP filing number + the locale
bundle dirs) and a burnable markdown layer (scripts/i18n_allowlist.md,
the migration worklist). The scanner ratchets: any violation outside the
allowlist fails, and any allowlist entry that no longer matches code
fails (migrate one, delete one). When the markdown file is absent, the
scanner is in STRICT mode (zero tolerance).

Modes:
  --check     (default) compare against the allowlist and ratchet.
  --generate  rewrite scripts/i18n_allowlist.md from current violations
              (the scanner emits the literals itself, so entries always
              round-trip — engineers never hand-write literals).
"""

from __future__ import annotations

import argparse
import re
import sys
from dataclasses import dataclass
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent
ALLOWLIST_PATH = REPO_ROOT / "scripts" / "i18n_allowlist.md"

CJK_RE = re.compile(r"[一-鿿　-〿＀-￯]+")
# ElMessage.<method>("literal"  — captures the first string literal arg.
TOAST_RE = re.compile(
    r"""ElMessage(?:Box)?\.\w+\(\s*(['"`])(?P<lit>(?:(?!\1).)*)\1"""
)
# gin.H{... "message": "literal" ...} — an alphabetic-leading literal only
# (err.Error(), i18n.T(...), variables are not string literals so they're
# structurally skipped).
GINH_RE = re.compile(r'"message":\s*"(?P<lit>[A-Za-z][^"]*)"')

# ICP filing number is a legal identifier, not translatable copy.
ICP_RE = re.compile(r"京ICP备\d+号(?:-\d+)?")

# Permanent single-language-policy allow-list (design §2.4 / Global Constraints).
PERMANENT_PATH_PREFIXES = (
    "apps/web/src/locales/langs/",
    "apps/server/common/i18n/locales/",
)
PERMANENT_EXACT_LITERALS = {
    "apps/web/src/components/LangSwitch.vue": {"中文"},
    "apps/web/src/views/chat/utils/message-parse.ts": {"附件"},
    # CJK fragments of 京ICP备07026971号-9 (legal filing identifier, permanent
    # exemption). The CJK regex splits the mixed-ASCII/CJK run into these
    # individual fragments, which don't individually match ICP_RE.
    "apps/web/src/components/AppFooter.vue": {"京", "备", "号"},
    "apps/web/src/views/chat/ChatView.vue": {"京", "备", "号", "："},
    # Full-width colon (U+FF1A) appended after a $t() label in display
    # contexts. The label keys are reused in :label props (no colon) and in
    # {{ $t("...") }}： (with colon); baking the colon into the bundle value
    # would break the colon-less :label usages, and introducing separate
    # colon-suffixed keys is a larger refactor outside this task's scope.
    # The colon is a punctuation convention, not translatable copy.
    "apps/web/src/components/CitedAnswer.vue": {"："},
    "apps/web/src/views/admin-management/AdminManagementView.vue": {"："},
    "apps/web/src/views/user-list/UserListView.vue": {"："},
    # /ping health-check response: "pong" is a machine-consumed convention,
    # not user-facing copy, and the route is not behind i18n.Localize().
    "apps/server/server/http.go": {"pong"},
}


@dataclass(frozen=True)
class Violation:
    path: str
    literal: str
    rule: str  # "cjk" | "toast" | "ginh"


def _is_scannable(path: str) -> str | None:
    """Return the rule-family for a path, or None if it should be skipped."""
    if path.endswith((".spec.ts", ".test.ts")):
        return None
    if path.startswith("apps/web/src/") and path.endswith((".vue", ".ts")):
        return "web"
    if path.startswith("apps/server/") and path.endswith(".go") and not path.endswith("_test.go"):
        return "server"
    return None


def is_permanently_allowed(path: str, literal: str) -> bool:
    if any(path.startswith(p) for p in PERMANENT_PATH_PREFIXES):
        return True
    if ICP_RE.fullmatch(literal) or ICP_RE.search(literal):
        return True
    if literal in PERMANENT_EXACT_LITERALS.get(path, set()):
        return True
    # constants/agents.ts holds agent Chinese display names (policy allow-list).
    if path == "apps/web/src/constants/agents.ts":
        return True
    return False


def scan_text_for_violations(path: str, text: str) -> list[Violation]:
    family = _is_scannable(path)
    if family is None:
        return []
    out: list[Violation] = []
    seen: set[tuple[str, str]] = set()

    def add(literal: str, rule: str) -> None:
        literal = literal.strip()
        if not literal or is_permanently_allowed(path, literal):
            return
        key = (literal, rule)
        if key in seen:
            return
        seen.add(key)
        out.append(Violation(path=path, literal=literal, rule=rule))

    if family == "web":
        for m in CJK_RE.finditer(text):
            add(m.group(0), "cjk")
        for m in TOAST_RE.finditer(text):
            add(m.group("lit"), "toast")
    elif family == "server":
        for m in GINH_RE.finditer(text):
            add(m.group("lit"), "ginh")
    return out


ENTRY_RE = re.compile(r"^- \[[ xX]\] `(?P<path>[^`]+)` \| `(?P<lit>.+)`\s*$")


def parse_allowlist(md_text: str) -> set[tuple[str, str]]:
    entries: set[tuple[str, str]] = set()
    for line in md_text.splitlines():
        m = ENTRY_RE.match(line.strip())
        if m:
            entries.add((m.group("path"), m.group("lit")))
    return entries


def ratchet_diff(
    found: set[tuple[str, str]], allowed: set[tuple[str, str]]
) -> tuple[set[tuple[str, str]], set[tuple[str, str]]]:
    """Return (new_violations, stale_entries)."""
    new = found - allowed
    stale = allowed - found
    return new, stale


RULE_SECTIONS = [
    ("cjk", "A: Vue template Chinese"),
    ("toast", "B: Frontend ElMessage/ElMessageBox literals"),
    ("ginh", "C: Go gin.H message literals"),
]


def _walk_tracked() -> list[str]:
    import subprocess

    out = subprocess.run(
        ["git", "ls-files", "apps/web/src", "apps/server"],
        cwd=REPO_ROOT,
        capture_output=True,
        text=True,
        check=True,
    )
    return out.stdout.splitlines()


def collect_violations() -> list[Violation]:
    violations: list[Violation] = []
    for rel in _walk_tracked():
        if _is_scannable(rel) is None:
            continue
        try:
            text = (REPO_ROOT / rel).read_text(encoding="utf-8")
        except (OSError, UnicodeDecodeError):
            continue
        violations.extend(scan_text_for_violations(rel, text))
    return violations


def render_allowlist(violations: list[Violation]) -> str:
    lines = [
        "# i18n hardcoded-copy allowlist (burnable)",
        "",
        "Auto-generated by `scripts/check_i18n.py --generate`. Each entry is a",
        "known hardcoded literal pending migration to i18n. Migrate one, then",
        "re-run --generate to drop it. When this file is empty of entries (or",
        "deleted), the scanner enters STRICT mode.",
        "",
    ]
    by_rule: dict[str, list[Violation]] = {r: [] for r, _ in RULE_SECTIONS}
    for v in violations:
        by_rule[v.rule].append(v)
    for rule, title in RULE_SECTIONS:
        items = sorted(by_rule[rule], key=lambda v: (v.path, v.literal))
        if not items:
            continue
        lines.append(f"## {title}")
        for v in items:
            lines.append(f"- [ ] `{v.path}` | `{v.literal}`")
        lines.append("")
    return "\n".join(lines) + "\n"


def print_report(new: set, stale: set) -> None:
    if new:
        print("i18n: NEW hardcoded copy outside the allowlist:", file=sys.stderr)
        for path, lit in sorted(new):
            print(f"  {path} | {lit}", file=sys.stderr)
    if stale:
        print("i18n: STALE allowlist entries (migrated — delete them):", file=sys.stderr)
        for path, lit in sorted(stale):
            print(f"  {path} | {lit}", file=sys.stderr)


def parse_args(argv: list[str]) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    mode = parser.add_mutually_exclusive_group()
    # --check is the default mode; accepting it explicitly makes the
    # documented interface honest and lets the gate invoke `--check`.
    mode.add_argument("--check", action="store_true", help="compare against the allowlist")
    mode.add_argument("--generate", action="store_true", help="rewrite the allowlist")
    return parser.parse_args(argv)


def main(argv: list[str] | None = None) -> int:
    args = parse_args(argv if argv is not None else sys.argv[1:])
    violations = collect_violations()
    found = {(v.path, v.literal) for v in violations}

    if args.generate:
        ALLOWLIST_PATH.write_text(render_allowlist(violations), encoding="utf-8")
        print(f"i18n: wrote {len(found)} entries to {ALLOWLIST_PATH.name}")
        return 0

    allowed = (
        parse_allowlist(ALLOWLIST_PATH.read_text(encoding="utf-8"))
        if ALLOWLIST_PATH.exists()
        else set()
    )
    new, stale = ratchet_diff(found, allowed)
    if new or stale:
        print_report(new, stale)
        return 1
    mode = "strict" if not ALLOWLIST_PATH.exists() else f"{len(allowed)} allowed"
    print(f"i18n: clean ({mode})")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
