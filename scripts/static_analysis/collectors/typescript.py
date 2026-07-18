"""Collect fail-closed vue-tsc diagnostics and TypeScript directives."""

from __future__ import annotations

import re
import subprocess
from collections.abc import Iterator, Sequence
from pathlib import Path, PurePosixPath

from ..fingerprints import normalize_source
from ..model import Finding, Mechanism, TargetKind
from .errors import CollectionError
from .helpers import make_finding


EXPECTED_VUE_TSC_VERSION = "0.39.5"
_ANSI_RE = re.compile(r"\x1b\[[0-?]*[ -/]*[@-~]")
_PAREN_DIAGNOSTIC_RE = re.compile(
    r"^(?P<path>.+)\((?P<line>\d+),(?P<column>\d+)\):\s*"
    r"(?P<level>error|warning)\s+(?P<rule>TS\d+):\s*(?P<message>.*)$"
)
_COLON_DIAGNOSTIC_RE = re.compile(
    r"^(?P<path>.+?):(?P<line>\d+):(?P<column>\d+)\s+-\s*"
    r"(?P<level>error|warning)\s+(?P<rule>TS\d+):\s*(?P<message>.*)$"
)
_GLOBAL_DIAGNOSTIC_RE = re.compile(
    r"^(?P<level>error|warning)\s+(?P<rule>TS\d+):\s*(?P<message>.*)$"
)
_SUMMARY_RE = re.compile(r"^Found \d+ errors?\.?$")
_VERSION_RE = re.compile(r"\b(?P<version>\d+\.\d+\.\d+)\b")
_DIRECTIVE_RE = re.compile(r"@ts-(?P<name>expect-error|ignore|nocheck)\b")
_SOURCE_SUFFIXES = frozenset({".ts", ".tsx", ".vue"})


def _fail(message: str) -> CollectionError:
    return CollectionError(f"typescript collector: {message}")


def _tool_version(version: str) -> str:
    match = _VERSION_RE.search(version.strip())
    if match is None or match.group("version") != EXPECTED_VUE_TSC_VERSION:
        raise _fail(
            f"vue-tsc version mismatch: expected {EXPECTED_VUE_TSC_VERSION}, "
            f"got {version!r}"
        )
    return EXPECTED_VUE_TSC_VERSION


def _canonical_path(root: Path, raw_path: str) -> str:
    value = raw_path.strip().replace("\\", "/")
    if not value or "\x00" in value:
        raise _fail("diagnostic path must be non-empty")
    if ".vue." in value:
        value = f"{value.split('.vue.', 1)[0]}.vue"

    candidate = Path(value)
    if candidate.is_absolute():
        try:
            value = candidate.resolve().relative_to(root.resolve()).as_posix()
        except ValueError as exc:
            raise _fail(f"diagnostic path escapes repository: {raw_path!r}") from exc
    else:
        pure = PurePosixPath(value)
        if ".." in pure.parts:
            raise _fail(f"diagnostic path escapes repository: {raw_path!r}")
        value = pure.as_posix()

        if not (root / value).exists() and (root / "apps" / "web" / value).exists():
            value = PurePosixPath("apps/web", value).as_posix()
    return value


def _source_path(root: Path, display_path: str) -> Path:
    direct = root / display_path
    if direct.is_file():
        return direct
    web_path = root / "apps" / "web" / display_path
    if web_path.is_file():
        return web_path
    if ".vue" in display_path:
        base = display_path.split(".vue", 1)[0] + ".vue"
        candidate = root / base
        if candidate.is_file():
            return candidate
        candidate = root / "apps" / "web" / base
        if candidate.is_file():
            return candidate
    return direct


def _global_path(root: Path) -> str:
    for candidate in ("apps/web/tsconfig.json", "tsconfig.json"):
        if (root / candidate).is_file():
            return candidate
    return "__typescript_global__"


def _line_context(root: Path, display_path: str, line_number: int) -> str:
    source_path = _source_path(root, display_path)
    try:
        lines = source_path.read_text(encoding="utf-8").splitlines()
    except (OSError, UnicodeDecodeError):
        return ""
    if 1 <= line_number <= len(lines):
        return normalize_source(lines[line_number - 1])
    return ""


def _diagnostic_finding(
    root: Path,
    *,
    path: str,
    line: int | None,
    column: int,
    rule: str,
    message: str,
    raw_line: str,
    version: str,
) -> Finding:
    context = _line_context(root, path, line) if line is not None else ""
    target = (
        f"span:{context}"
        if context
        else f"span:{path}:{line}:{column}"
        if line is not None
        else f"global:{rule}:{normalize_source(message)}"
    )
    source = context or message
    return make_finding(
        root=root,
        path=root / path,
        tool="typescript",
        rule=rule,
        mechanism=Mechanism.DIAGNOSTIC,
        target_kind=TargetKind.SPAN,
        target=target,
        message=message,
        display_line=line,
        source=source,
        tool_version=version,
        evidence=(raw_line, message),
    )


def _match_diagnostic(line: str) -> re.Match[str] | None:
    return _PAREN_DIAGNOSTIC_RE.match(line) or _COLON_DIAGNOSTIC_RE.match(line)


def parse_vue_tsc_output(
    root: Path, text: str, version: str
) -> tuple[Finding, ...]:
    """Parse TypeScript's stable non-pretty diagnostic format."""

    normalized_version = _tool_version(version)
    if not isinstance(text, str):
        raise _fail("compiler output must be text")
    findings: list[Finding] = []
    current: dict[str, object] | None = None

    def flush() -> None:
        if current is None:
            return
        findings.append(
            _diagnostic_finding(
                root,
                path=str(current["path"]),
                line=(
                    None
                    if current["line"] is None
                    else int(current["line"])
                ),
                column=int(current["column"]),
                rule=str(current["rule"]),
                message=str(current["message"]),
                raw_line=str(current["raw_line"]),
                version=normalized_version,
            )
        )

    for raw in _ANSI_RE.sub("", text).splitlines():
        line = raw.rstrip()
        if not line.strip():
            continue
        match = _match_diagnostic(line)
        if match is not None:
            flush()
            path = _canonical_path(root, match.group("path"))
            current = {
                "path": path,
                "line": int(match.group("line")),
                "column": int(match.group("column")),
                "rule": match.group("rule"),
                "message": match.group("message"),
                "raw_line": line,
            }
            continue
        global_match = _GLOBAL_DIAGNOSTIC_RE.match(line)
        if global_match is not None:
            flush()
            current = {
                "path": _global_path(root),
                "line": None,
                "column": 1,
                "rule": global_match.group("rule"),
                "message": global_match.group("message"),
                "raw_line": line,
            }
            continue
        if _SUMMARY_RE.fullmatch(line.strip()):
            flush()
            current = None
            continue
        if current is not None and (raw[:1].isspace() or line.startswith("|")):
            message = str(current["message"])
            current["message"] = f"{message}\n{line.strip()}"
            continue
        raise _fail(f"unrecognized compiler output: {line!r}")
    flush()
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


def validate_vue_tsc_result(returncode: int, stdout: str, stderr: str) -> str:
    """Accept clean success or real compiler diagnostics, never silent failure."""

    if not isinstance(stdout, str):
        raise _fail("compiler stdout must be text")
    if returncode != 0 and not stdout.strip():
        diagnostic = stderr.strip() or "no compiler diagnostics were written"
        raise _fail(f"vue-tsc exited with status {returncode}: {diagnostic}")
    return stdout


def _comment_bodies(lines: Sequence[str]) -> Iterator[tuple[int, str, str]]:
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
                    yield line_number, body.strip().lstrip("*").strip(), line
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
                yield line_number, line[i + 2 :].strip(), line
                break
            if line.startswith("<!--", i):
                end = line.find("-->", i + 4)
                body = line[i + 4 :] if end == -1 else line[i + 4 : end]
                if body.strip():
                    yield line_number, body.strip(), line
                break
            i += 1


def _next_code_line(lines: Sequence[str], line_number: int) -> str:
    for line in lines[line_number:]:
        stripped = line.strip()
        if not stripped or stripped.startswith(("//", "/*", "*", "<!--")):
            continue
        return normalize_source(stripped)
    return ""


def audit_typescript_directives(
    root: Path, files: Sequence[Path]
) -> tuple[Finding, ...]:
    """Inventory exact TypeScript directives without granting authorization."""

    findings: list[Finding] = []
    for path in sorted(files, key=lambda item: item.as_posix()):
        if path.suffix.lower() not in _SOURCE_SUFFIXES or not path.is_file():
            continue
        try:
            source = path.read_text(encoding="utf-8")
        except (OSError, UnicodeDecodeError) as exc:
            raise _fail(f"unable to read {path}: {exc}") from exc
        lines = source.splitlines()
        for line_number, body, original in _comment_bodies(lines):
            match = _DIRECTIVE_RE.search(body)
            if match is None:
                continue
            rule = f"@ts-{match.group('name')}"
            context = (
                path.name
                if match.group("name") == "nocheck"
                else _next_code_line(lines, line_number)
            )
            target = f"directive:{rule}:{context or 'file'}"
            findings.append(
                make_finding(
                    root=root,
                    path=path,
                    tool="typescript",
                    rule=rule,
                    mechanism=Mechanism.INLINE,
                    target_kind=TargetKind.SPAN,
                    target=target,
                    message=body,
                    display_line=line_number,
                    source=f"{original}\n{context}",
                    evidence=(original, context),
                )
            )
    return tuple(
        sorted(
            findings,
            key=lambda item: (item.path, item.display_line or 0, item.rule, item.target),
        )
    )


def _web_root(root: Path) -> Path:
    candidate = root / "apps" / "web"
    return candidate if candidate.is_dir() else root


def _run(command: Sequence[str], *, cwd: Path) -> subprocess.CompletedProcess[str]:
    try:
        return subprocess.run(
            list(command),
            cwd=cwd,
            capture_output=True,
            text=True,
            check=False,
        )
    except OSError as exc:
        raise _fail(f"unable to invoke {' '.join(command)}: {exc}") from exc


def collect_typescript(
    root: Path,
    *,
    project: Path,
    files: Sequence[Path] | None,
) -> tuple[Finding, ...]:
    """Run the pinned local vue-tsc project and optionally scope findings."""

    if files is not None and not files:
        return ()
    root = root.resolve()
    web_root = _web_root(root).resolve()
    project = project.resolve()
    if not project.is_file():
        raise _fail(f"project file does not exist: {project}")
    try:
        project_arg = project.relative_to(web_root).as_posix()
    except ValueError as exc:
        raise _fail(f"project escapes apps/web: {project}") from exc

    selected: set[str] | None = None
    if files is not None:
        selected = set()
        for path in files:
            resolved = path.resolve()
            try:
                resolved.relative_to(web_root)
            except ValueError as exc:
                raise _fail(f"input file escapes apps/web: {path}") from exc
            selected.add(_canonical_path(root, resolved.as_posix()))

    version_result = _run(
        ("npx", "--no-install", "vue-tsc", "--version"), cwd=web_root
    )
    if version_result.returncode != 0:
        raise _fail(
            "vue-tsc version command failed: "
            f"{version_result.stderr.strip() or version_result.stdout.strip()}"
        )
    package_result = _run(
        ("node", "-p", "require('vue-tsc/package.json').version"), cwd=web_root
    )
    if package_result.returncode != 0:
        raise _fail(
            "unable to resolve vue-tsc package version: "
            f"{package_result.stderr.strip() or package_result.stdout.strip()}"
        )
    version = _tool_version(package_result.stdout or package_result.stderr)
    result = _run(
        (
            "npx",
            "--no-install",
            "vue-tsc",
            "--noEmit",
            "--pretty",
            "false",
            "--project",
            project_arg,
        ),
        cwd=web_root,
    )
    output = validate_vue_tsc_result(result.returncode, result.stdout, result.stderr)
    findings = parse_vue_tsc_output(root, output, version)
    if selected is None:
        return findings
    return tuple(finding for finding in findings if finding.path in selected)


__all__ = [
    "EXPECTED_VUE_TSC_VERSION",
    "audit_typescript_directives",
    "collect_typescript",
    "parse_vue_tsc_output",
    "validate_vue_tsc_result",
]
