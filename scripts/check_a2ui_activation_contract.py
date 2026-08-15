#!/usr/bin/env python3
"""Gate the narrow, repository-owned A2UI activation contract.

This is deliberately a small static checker.  It reads the versioned fixture
manifest plus the exact Web/Go files that own the activation boundary; it does
not walk the repository or inspect deployment, Bot, evidence, or handoff
trees.
"""

from __future__ import annotations

import argparse
import hashlib
import re
import sys
from pathlib import Path
from typing import Any

if __package__ in {None, ""}:
    sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from scripts.strict_json import StrictJsonError, loads_strict_json


ROOT = Path(__file__).resolve().parents[1]
FIXTURE_ROOT_REL = Path("apps/web/tests/fixtures/a2ui")
SCOPED_FILES = {
    "action_transport": Path("apps/web/src/views/chat/streaming/a2uiAction.ts"),
    "api_router": Path("apps/server/http/router/api.go"),
    "operation_log": Path("apps/server/middleware/operation_log.go"),
    "bot_action_client": Path("apps/server/external/bot/a2ui_action.go"),
    "bot_example_config": Path("apps/server/config/app.yml.example"),
    "bot_config": Path("apps/server/external/bot/config.go"),
    "design_system_doc": Path("docs/frontend-design-system.md"),
}
ALLOWED_FIXTURE_CLASSES = {"upstream-projection", "web-http-synthetic"}
ALLOWED_CONTRACT_KINDS = {
    "open_surface",
    "terminal_projection",
    "action_response",
    "error_response",
}
FORBIDDEN_PATH_PARTS = {"evidence", "handoff", "bot", "ops", "operations"}
PASS_LINE = "A2UI activation contract: PASS"

ACTION_ROUTE_RE = re.compile(
    r"(?m)^\s*(?P<receiver>[A-Za-z_][A-Za-z0-9_]*)\s*\.\s*POST\s*"
    r"\(\s*[\"'](?P<path>[^\"']*/a2ui-actions)[\"']"
)
FLAG_RE_TEMPLATE = r"(?m)^\s*{key}\s*:\s*(?P<value>true|false)\b"
REQUIRED_DESIGN_MARKERS = (
    "A2UI interaction lifecycle",
    "three supported widgets",
    "message-owned state",
    "messageKey + run_id + surface_id",
    "terminal",
    "input_required",
    "N=2",
    "no automatic retry",
    "no-blind-replay",
    "unknown lock",
    "Form/Choice cancellation",
    "history/reload read-only degradation",
    "reload fail-safe",
    "lifecycle status",
    "visible focus",
    "touch controls",
    ".codex/evidence/a2ui-activation/",
    "A1 activation-ready is not production activation",
)
STALE_CONFIG_MARKERS = (
    "until Bot P0 ships",
    "until Bot accept ships",
    "Bot-shaped 403 stub",
)
UNBACKED_ENVIRONMENT_CLAIM_RE = re.compile(
    r"\b(?:staging|ci|production)\b[^\.\n]{0,80}"
    r"\b(?:proof|evidence|validation|verification|verified|validated|"
    r"passed|pass|sign[- ]?off|complete)\b",
    re.IGNORECASE,
)


def _within(path: Path, parent: Path) -> bool:
    try:
        path.resolve().relative_to(parent.resolve())
    except ValueError:
        return False
    return True


def _has_forbidden_part(path: Path, root: Path) -> bool:
    try:
        relative = path.resolve().relative_to(root.resolve())
    except ValueError:
        return True
    parts = relative.parts
    # ``apps/server/external/bot`` is the Web-owned HTTP client that this gate
    # must inspect.  The sibling Phytomni-Bot checkout is outside ``root`` and
    # is still rejected by ``_within``; only that explicitly scoped client
    # subtree is exempt from the generic ``bot`` path guard.
    if parts[:4] == ("apps", "server", "external", "bot"):
        parts = parts[:3] + parts[4:]
    for part in parts:
        lowered = part.lower()
        if lowered in FORBIDDEN_PATH_PARTS or lowered.startswith(".env"):
            return True
    return False


def _safe_bytes(path: Path, root: Path, violations: list[str]) -> bytes | None:
    if not _within(path, root) or _has_forbidden_part(path, root):
        violations.append(f"refusing to read out-of-scope path: {path}")
        return None
    try:
        return path.read_bytes()
    except FileNotFoundError:
        violations.append(f"missing file: {path}")
    except OSError as exc:
        violations.append(f"cannot read file {path}: {exc}")
    return None


def _safe_text(path: Path, root: Path, violations: list[str]) -> str | None:
    raw = _safe_bytes(path, root, violations)
    if raw is None:
        return None
    try:
        return raw.decode("utf-8")
    except UnicodeDecodeError as exc:
        violations.append(f"file is not UTF-8 text: {path}: {exc}")
        return None


def _load_manifest(
    root: Path, fixture_root: Path, violations: list[str]
) -> tuple[dict[str, Any] | None, bytes | None]:
    manifest_path = fixture_root / "manifest.json"
    raw = _safe_bytes(manifest_path, root, violations)
    if raw is None:
        return None, None
    try:
        value = loads_strict_json(raw)
    except StrictJsonError:
        violations.append("invalid manifest JSON")
        return None, raw
    if not isinstance(value, dict):
        violations.append("manifest root must be an object")
        return None, raw
    if value.get("schema_version") != 1:
        violations.append("manifest schema_version must be 1")
    if value.get("catalog_version") != "v1.0":
        violations.append('manifest catalog_version must be "v1.0"')
    if not isinstance(value.get("fixtures"), list):
        violations.append("manifest fixtures must be a list")
    return value, raw


def _resolve_fixture_path(
    fixture_root: Path,
    raw_file: Any,
    violations: list[str],
) -> Path | None:
    if not isinstance(raw_file, str) or not raw_file.strip():
        violations.append("fixture entry has no file path")
        return None
    relative = Path(raw_file)
    if relative.is_absolute() or "\\" in raw_file or ".." in relative.parts:
        violations.append(f"fixture path escapes fixture root: {raw_file}")
        return None
    candidate = fixture_root / relative
    if not _within(candidate, fixture_root):
        violations.append(f"fixture path escapes fixture root: {raw_file}")
        return None
    return candidate


def _check_manifest(
    root: Path, fixture_root: Path, manifest: dict[str, Any] | None, violations: list[str]
) -> None:
    if manifest is None:
        return
    entries = manifest.get("fixtures")
    if not isinstance(entries, list):
        return

    listed_files: set[str] = set()
    seen_ids: set[str] = set()
    seen_files: set[str] = set()
    for index, entry in enumerate(entries):
        label = f"fixture entry {index}"
        if not isinstance(entry, dict):
            violations.append(f"{label} must be an object")
            continue

        fixture_id = entry.get("id")
        if not isinstance(fixture_id, str) or not fixture_id.strip():
            violations.append(f"{label} is unclassified: missing id")
        elif fixture_id in seen_ids:
            violations.append(f"duplicate fixture id: {fixture_id}")
        else:
            seen_ids.add(fixture_id)

        fixture_class = entry.get("class")
        if fixture_class == "staging-capture":
            violations.append(f"staging-capture fixture is not allowed: {fixture_id}")
        elif fixture_class not in ALLOWED_FIXTURE_CLASSES:
            violations.append(f"unclassified fixture: {fixture_id}")
        if entry.get("contract_kind") not in ALLOWED_CONTRACT_KINDS:
            violations.append(f"unclassified fixture: {fixture_id}")

        resolved = _resolve_fixture_path(fixture_root, entry.get("file"), violations)
        if resolved is None:
            continue
        relative = resolved.relative_to(fixture_root).as_posix()
        listed_files.add(relative)
        if relative in seen_files:
            violations.append(f"duplicate fixture file: {relative}")
        else:
            seen_files.add(relative)

        if not resolved.is_file():
            violations.append(f"missing fixture: {relative}")
            continue
        raw = _safe_bytes(resolved, root, violations)
        if raw is None:
            continue
        expected_hash = entry.get("sha256")
        actual_hash = hashlib.sha256(raw).hexdigest()
        if not isinstance(expected_hash, str) or not re.fullmatch(r"[0-9a-fA-F]{64}", expected_hash):
            violations.append(f"invalid sha256 digest for fixture: {fixture_id}")
        elif actual_hash.lower() != expected_hash.lower():
            violations.append(
                f"sha256 mismatch for fixture {fixture_id}: "
                f"expected {expected_hash}, got {actual_hash}"
            )

    if not fixture_root.exists():
        return
    for candidate in fixture_root.rglob("*.json"):
        if candidate.name == "manifest.json":
            continue
        if not _within(candidate, fixture_root) or _has_forbidden_part(candidate, root):
            violations.append(f"refusing to inspect out-of-scope fixture: {candidate}")
            continue
        relative = candidate.relative_to(fixture_root).as_posix()
        if relative not in listed_files:
            violations.append(f"orphan fixture: {relative}")


def _check_action_transport(text: str, violations: list[str]) -> None:
    for marker in (
        "sentIds",
        "_resetA2uiActionIdempotencyForTests",
        "Promise<void>",
    ):
        if marker in text:
            violations.append(f"a2uiAction.ts contains forbidden marker: {marker}")


def _check_api_router(text: str, violations: list[str]) -> None:
    routes = list(ACTION_ROUTE_RE.finditer(text))
    if len(routes) != 1:
        violations.append(f"action route count must be exactly one; found {len(routes)}")
        return

    route_start = routes[0].start()
    prefix = text[:route_start]
    receiver = routes[0].group("receiver")
    declaration_re = re.compile(
        rf"(?m)\b{re.escape(receiver)}\s*:?=\s*[^\n]*\bGroup\s*\("
    )
    declarations = list(declaration_re.finditer(prefix))
    group_start = declarations[-1].start() if declarations else -1
    region = text[group_start:route_start] if group_start >= 0 else prefix
    guard_index = region.find("A2uiJSONGuard(")
    operation_index = region.find("OperationLog(")
    if guard_index < 0 or operation_index < 0 or guard_index > operation_index:
        violations.append("A2uiJSONGuard must precede OperationLog on the action route")


def _check_operation_log(text: str, violations: list[str]) -> None:
    mask = re.search(r'a2uiActionAuditMask\s*=\s*["\']\[REDACTED\]["\']', text)
    payload = re.search(r"\bPayload\s*:\s*a2uiActionAuditMask\b", text)
    if mask is None or payload is None:
        violations.append("operation_log.go lacks whole-payload [REDACTED] handling")


def _check_bot_client(text: str, violations: list[str]) -> None:
    if not re.search(r"A2uiActionMaxResponseBytes\s+int64\s*=\s*1\s*<<\s*20", text):
        violations.append("Bot action response limit must be 1 MiB")
    if not re.search(
        r"io\.LimitReader\(\s*resp\.Body\s*,\s*A2uiActionMaxResponseBytes\s*\+\s*1\s*\)",
        text,
    ):
        violations.append("Bot action client lacks 1 MiB LimitReader pattern")


def _check_flags(text: str, violations: list[str]) -> None:
    for key in ("stream_enabled", "a2ui_actions_enabled"):
        matches = re.findall(FLAG_RE_TEMPLATE.format(key=re.escape(key)), text)
        if len(matches) != 1 or matches[0].lower() != "false":
            violations.append(f"{key} default must be false")


def _check_config_governance(text: str, violations: list[str]) -> None:
    lowered = text.casefold()
    for marker in STALE_CONFIG_MARKERS:
        if marker.casefold() in lowered:
            violations.append(f"stale config launch promise: {marker}")
    endpoint_claim_re = re.compile(
        r"(?i)\bendpoint\b[^\n]{0,120}\b(?:alone|by itself|enough|"
        r"authori[sz]e|suffice)"
    )
    for line in text.splitlines():
        if endpoint_claim_re.search(line):
            violations.append(
                "config comments cannot treat Bot endpoint existence alone as "
                f"activation evidence: {line.strip()}"
            )


def _check_design_system(text: str, violations: list[str]) -> None:
    lowered = re.sub(r"\s+", " ", text.casefold())
    for marker in REQUIRED_DESIGN_MARKERS:
        normalized_marker = re.sub(r"\s+", " ", marker.casefold())
        if normalized_marker not in lowered:
            violations.append(f"frontend-design-system.md missing lifecycle marker: {marker}")

    normalized = re.sub(r"\s+", " ", text)
    for match in UNBACKED_ENVIRONMENT_CLAIM_RE.finditer(normalized):
        context = match.group(0).strip()
        lowered_context = context.casefold()
        if not (
            "external evidence" in lowered_context
            or "external verification" in lowered_context
        ):
            violations.append(f"unbacked environment proof claim: {context}")


def check(root: Path) -> list[str]:
    """Return deterministic violations for the activation contract."""
    root = root.resolve()
    violations: list[str] = []
    fixture_root = root / FIXTURE_ROOT_REL
    manifest, _ = _load_manifest(root, fixture_root, violations)
    _check_manifest(root, fixture_root, manifest, violations)

    source_text: dict[str, str] = {}
    for name, relative in SCOPED_FILES.items():
        text = _safe_text(root / relative, root, violations)
        if text is not None:
            source_text[name] = text

    if "action_transport" in source_text:
        _check_action_transport(source_text["action_transport"], violations)
    if "api_router" in source_text:
        _check_api_router(source_text["api_router"], violations)
    if "operation_log" in source_text:
        _check_operation_log(source_text["operation_log"], violations)
    if "bot_action_client" in source_text:
        _check_bot_client(source_text["bot_action_client"], violations)
    if "bot_example_config" in source_text:
        _check_flags(source_text["bot_example_config"], violations)
        _check_config_governance(source_text["bot_example_config"], violations)
    if "bot_config" in source_text:
        _check_config_governance(source_text["bot_config"], violations)
    if "design_system_doc" in source_text:
        _check_design_system(source_text["design_system_doc"], violations)
    return violations


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--root",
        type=Path,
        default=ROOT,
        help="repository root (defaults to the checkout containing this script)",
    )
    args = parser.parse_args(argv)
    violations = check(args.root)
    if violations:
        print("A2UI activation contract: FAIL")
        for violation in violations:
            print(f"- {violation}")
        return 1
    print(PASS_LINE)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
