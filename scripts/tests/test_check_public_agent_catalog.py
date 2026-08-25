"""Tests for the Bot-owned public-agent catalog drift gate."""

from __future__ import annotations

import json
from pathlib import Path

import check_public_agent_catalog as checker


def test_current_web_maps_match_pinned_catalog() -> None:
    assert checker.check(checker.ROOT, checker.DEFAULT_CATALOG) == []


def test_missing_agent_is_reported(tmp_path: Path) -> None:
    payload = json.loads(checker.DEFAULT_CATALOG.read_text(encoding="utf-8"))
    payload["agents"] = payload["agents"][:-1]
    catalog = tmp_path / "catalog.json"
    catalog.write_text(json.dumps(payload), encoding="utf-8")

    violations = checker.check(checker.ROOT, catalog)

    assert "catalog must define exactly 10 agents" in violations


def test_catalog_never_contains_endpoint_or_secret_fields(tmp_path: Path) -> None:
    payload = json.loads(checker.DEFAULT_CATALOG.read_text(encoding="utf-8"))
    payload["agents"][0]["endpoint"] = "https://private.invalid"
    catalog = tmp_path / "catalog.json"
    catalog.write_text(json.dumps(payload), encoding="utf-8")

    assert any(
        "forbidden field" in item for item in checker.check(checker.ROOT, catalog)
    )


def test_catalog_requires_the_execution_event_replay_capability(
    tmp_path: Path,
) -> None:
    payload = json.loads(checker.DEFAULT_CATALOG.read_text(encoding="utf-8"))
    payload.pop("capabilities")
    catalog = tmp_path / "catalog.json"
    catalog.write_text(json.dumps(payload), encoding="utf-8")

    assert "execution-event capability is missing or unsupported" in checker.check(
        checker.ROOT, catalog
    )


def test_catalog_requires_v2_runtime_driver_metadata(tmp_path: Path) -> None:
    payload = json.loads(checker.DEFAULT_CATALOG.read_text(encoding="utf-8"))
    payload["capabilities"].pop("execution_runtime")
    payload["agents"][0].pop("driver")
    catalog = tmp_path / "catalog.json"
    catalog.write_text(json.dumps(payload), encoding="utf-8")

    violations = checker.check(checker.ROOT, catalog)
    assert "execution-runtime capability is missing or unsupported" in violations
    assert "Bot agent driver missing: chat" in violations


def test_catalog_requires_finite_user_facing_trace_metadata(
    tmp_path: Path,
) -> None:
    payload = json.loads(checker.DEFAULT_CATALOG.read_text(encoding="utf-8"))
    payload["agents"][0]["trace_producer"] = ""
    payload["agents"][0]["trace_operations"] = []
    payload["agents"][0]["trace_target_operations"] = ["private.dynamic"]
    catalog = tmp_path / "catalog.json"
    catalog.write_text(json.dumps(payload), encoding="utf-8")

    violations = checker.check(checker.ROOT, catalog)

    assert "Bot agent trace producer missing: chat" in violations
    assert "Bot agent trace operations missing: chat" in violations
    assert "Bot agent trace target drift: chat" in violations
