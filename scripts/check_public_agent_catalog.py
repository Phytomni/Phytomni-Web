#!/usr/bin/env python3
"""Validate Web's finite agent maps against a pinned Bot catalog export."""

from __future__ import annotations

import argparse
import json
import re
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parents[1]
DEFAULT_CATALOG = ROOT / "docs/reference/bot-public-agent-catalog.v1.json"
AGENT_MAP = ROOT / "apps/server/external/bot/agent_map.go"
_DEFINITION = re.compile(r'\{Tool:\s*"([^"]+)",\s*Slug:\s*"([^"]+)",\s*Execution:')
_FORBIDDEN_KEYS = {"secret", "credential", "endpoint", "base_url", "path"}
_EXECUTION_EVENT_TARGETS = [
    "event",
    "artifact",
    "report",
    "todo",
    "preview",
    "download",
    "trace",
]
_EXECUTION_DRIVERS = {
    "local_graph",
    "remote_task",
    "remote_fanout",
    "resumable_graph",
    "hybrid",
}
_TRACE_PRODUCERS = {
    "local_semantic",
    "structured_provider",
    "hybrid",
}


def _forbidden_fields(value: Any) -> set[str]:
    found: set[str] = set()
    if isinstance(value, dict):
        for key, child in value.items():
            if str(key).lower() in _FORBIDDEN_KEYS:
                found.add(str(key))
            found.update(_forbidden_fields(child))
    elif isinstance(value, list):
        for child in value:
            found.update(_forbidden_fields(child))
    return found


def check(root: Path, catalog_path: Path) -> list[str]:
    violations: list[str] = []
    try:
        payload = json.loads(catalog_path.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return ["public agent catalog is missing or malformed"]
    agents = payload.get("agents")
    if payload.get("schema_version") != 1 or not isinstance(agents, list):
        return ["public agent catalog schema is unsupported"]
    if len(agents) != 10:
        violations.append("catalog must define exactly 10 agents")
    capabilities = payload.get("capabilities")
    execution_events = (
        capabilities.get("execution_events")
        if isinstance(capabilities, dict)
        else None
    )
    if not (
        isinstance(execution_events, dict)
        and execution_events.get("major_version") == 1
        and execution_events.get("resumable_history") is True
        and execution_events.get("custom_event") == "phyto.run_event"
        and execution_events.get("target_kinds") == _EXECUTION_EVENT_TARGETS
    ):
        violations.append(
            "execution-event capability is missing or unsupported"
        )
    execution_runtime = (
        capabilities.get("execution_runtime")
        if isinstance(capabilities, dict)
        else None
    )
    if not (
        isinstance(execution_runtime, dict)
        and execution_runtime.get("major_version") == 1
        and execution_runtime.get("journal_major_version") == 2
        and set(execution_runtime.get("drivers", [])) == _EXECUTION_DRIVERS
    ):
        violations.append("execution-runtime capability is missing or unsupported")
    forbidden = _forbidden_fields(payload)
    if forbidden:
        violations.append(
            "catalog contains forbidden field: " + ", ".join(sorted(forbidden))
        )
    source_path = root / AGENT_MAP.relative_to(ROOT)
    try:
        source = source_path.read_text(encoding="utf-8")
    except OSError:
        return violations + ["Web agent map is missing"]
    web_pairs = set(_DEFINITION.findall(source))
    catalog_pairs = {
        (item.get("tool"), item.get("slug"))
        for item in agents
        if isinstance(item, dict)
    }
    if web_pairs != catalog_pairs:
        violations.append("Web agent definitions drift from Bot catalog")
    for item in agents:
        if not isinstance(item, dict):
            continue
        if item.get("driver") not in _EXECUTION_DRIVERS:
            violations.append(f"Bot agent driver missing: {item.get('slug')}")
        for required in (
            "topology",
            "checkpoint",
            "resume",
            "cancellation",
            "deadline_seconds",
            "retry",
            "join",
            "result_mapper",
            "event_contract",
            "transport_views",
            "dispatch_adapter",
        ):
            if item.get(required) in (None, "", []):
                violations.append(
                    f"Bot agent runtime metadata missing: {item.get('slug')}:{required}"
                )
        slug = item.get("slug")
        trace_producer = item.get("trace_producer")
        trace_operations = item.get("trace_operations")
        trace_targets = item.get("trace_target_operations")
        if trace_producer not in _TRACE_PRODUCERS:
            violations.append(f"Bot agent trace producer missing: {slug}")
        if not (
            isinstance(trace_operations, list)
            and trace_operations
            and all(
                isinstance(operation, str) and operation
                for operation in trace_operations
            )
            and len(set(trace_operations)) == len(trace_operations)
        ):
            violations.append(f"Bot agent trace operations missing: {slug}")
        if not (
            isinstance(trace_targets, list)
            and isinstance(trace_operations, list)
            and len(set(trace_targets)) == len(trace_targets)
            and set(trace_targets) <= set(trace_operations)
        ):
            violations.append(f"Bot agent trace target drift: {slug}")
        model = item.get("model")
        if model and f'"{item.get("slug")}":' not in source:
            violations.append(f"Web chat model slug missing: {item.get('slug')}")
        if model and f'"{model}"' not in source:
            violations.append(f"Web chat model missing: {model}")
    return violations


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--root", type=Path, default=ROOT)
    parser.add_argument("--catalog", type=Path, default=DEFAULT_CATALOG)
    args = parser.parse_args(argv)
    violations = check(args.root.resolve(), args.catalog.resolve())
    if violations:
        print("Public agent catalog: FAIL")
        for violation in violations:
            print(f"- {violation}")
        return 1
    print("Public agent catalog: PASS")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
