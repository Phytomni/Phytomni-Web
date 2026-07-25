"""Collect exact suppressions encoded in project configuration files."""

from __future__ import annotations

import json
import re
from collections.abc import Iterable
from pathlib import Path
from typing import Any

from ..model import Finding, Mechanism, TargetKind
from .helpers import make_finding, relative_path, tracked_files


_QUOTED_RE = re.compile(r"[\"']([^\"']+)[\"']")
_ESLINT_IGNORE_RE = re.compile(
    r"ignorePatterns\s*:\s*(?:\[(?P<array>[^]]*)\]|(?P<single>[\"'][^\"']+[\"']))",
    re.DOTALL,
)
_ESLINT_FLAT_IGNORE_RE = re.compile(
    r"\bignores\s*:\s*(?:\[(?P<array>[^]]*)\]|(?P<single>[\"'][^\"']+[\"']))",
    re.DOTALL,
)
_ESLINT_OFF_RE = re.compile(
    r"[\"'](?P<rule>[^\"']+)[\"']\s*:\s*(?:[\"']off[\"']|0)"
)


def _finding(
    root: Path,
    path: Path,
    *,
    tool: str,
    rule: str,
    target: str,
    source: str,
) -> Finding:
    return make_finding(
        root=root,
        path=path,
        tool=tool,
        rule=rule,
        mechanism=Mechanism.CONFIG,
        target_kind=TargetKind.CONFIG,
        target=target,
        message=source,
        display_line=None,
        source=source,
        evidence=(source,),
    )


def _config_candidates(root: Path) -> tuple[Path, ...]:
    names = {
        ".eslintignore",
        ".eslintrc.cjs",
        ".eslintrc.js",
        ".eslintrc.json",
        "eslint.config.js",
        "eslint.config.mjs",
        "eslint.config.cjs",
        "eslint.config.ts",
        "eslint.config.mts",
        "eslint.config.cts",
        ".prettierignore",
    }
    candidates: list[Path] = []
    if (root / ".git").exists():
        paths = tracked_files(root)
    else:
        paths = tuple(root.rglob("*"))
    for path in paths:
        if not path.is_file() or path.name not in names:
            continue
        if any(
            part in {".git", "node_modules", "dist", "coverage"}
            for part in path.parts
        ):
            continue
        candidates.append(path)
    for path in paths:
        if path.is_file() and not any(
            part in {".git", "node_modules", "dist", "coverage"}
            for part in path.parts
        ):
            candidates.append(path)
    return tuple(sorted(set(candidates), key=lambda item: relative_path(root, item)))


def _collect_eslint(root: Path, path: Path) -> Iterable[Finding]:
    text = path.read_text(encoding="utf-8")
    ignore_matches = _ESLINT_IGNORE_RE.finditer(text)
    flat_ignore_matches = _ESLINT_FLAT_IGNORE_RE.finditer(text)
    for match in (*ignore_matches, *flat_ignore_matches):
        raw = match.group("array") or match.group("single") or ""
        for pattern in _QUOTED_RE.findall(raw):
            yield _finding(
                root,
                path,
                tool="eslint",
                rule="ignore-pattern",
                target=pattern,
                source=f"ignorePatterns={pattern!r}",
            )
    for match in _ESLINT_OFF_RE.finditer(text):
        rule = match.group("rule")
        yield _finding(
            root,
            path,
            tool="eslint",
            rule=rule,
            target=rule,
            source=f"rule={rule!r}:off",
        )


def _collect_json_config(root: Path, path: Path) -> Iterable[Finding]:
    try:
        document: Any = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return ()
    if not isinstance(document, dict):
        return ()

    findings: list[Finding] = []
    compiler_options = document.get("compilerOptions")
    if (
        isinstance(compiler_options, dict)
        and compiler_options.get("skipLibCheck") is True
    ):
        findings.append(
            _finding(
                root,
                path,
                tool="typescript",
                rule="skipLibCheck",
                target="compilerOptions.skipLibCheck",
                source='compilerOptions.skipLibCheck=true',
            )
        )
    excludes = document.get("exclude")
    if isinstance(excludes, list):
        for pattern in excludes:
            if isinstance(pattern, str) and pattern.strip():
                findings.append(
                    _finding(
                        root,
                        path,
                        tool="typescript",
                        rule="exclude",
                        target=pattern.strip(),
                        source=f"exclude={pattern!r}",
                    )
                )
    return findings


def _collect_ignore_file(root: Path, path: Path) -> Iterable[Finding]:
    tool = "prettier" if path.name == ".prettierignore" else "eslint"
    for line in path.read_text(encoding="utf-8").splitlines():
        pattern = line.strip()
        if not pattern or pattern.startswith("#"):
            continue
        yield _finding(
            root,
            path,
            tool=tool,
            rule="ignore",
            target=pattern,
            source=pattern,
        )


def collect_config_suppressions(root: Path) -> tuple[Finding, ...]:
    """Collect configuration suppressions without evaluating authorization."""

    findings: list[Finding] = []
    for path in _config_candidates(root):
        if path.name.startswith(".eslintrc") or path.name.startswith("eslint.config."):
            findings.extend(_collect_eslint(root, path))
        elif path.name in {".eslintignore", ".prettierignore"}:
            findings.extend(_collect_ignore_file(root, path))
        elif path.name.startswith("tsconfig"):
            findings.extend(_collect_json_config(root, path))
    return tuple(
        sorted(
            findings,
            key=lambda item: (item.path, item.target, item.rule, item.tool),
        )
    )
