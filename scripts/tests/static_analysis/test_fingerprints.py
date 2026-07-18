"""Contract tests for stable static-analysis target fingerprints."""

from __future__ import annotations

from dataclasses import replace
from pathlib import Path

import pytest

from scripts.static_analysis.fingerprints import (
    Endpoint,
    FingerprintInput,
    canonical_pair,
    fingerprint,
    normalize_source,
)
from scripts.static_analysis.model import TargetKind

pytestmark = pytest.mark.unit

FIXTURE_DIR = Path(__file__).parent / "fixtures" / "fingerprints"


def _base_input() -> FingerprintInput:
    source = (FIXTURE_DIR / "typescript.ts").read_text(encoding="utf-8")
    return FingerprintInput(
        tool="eslint",
        rule="@typescript-eslint/no-explicit-any",
        mechanism="inline",
        target_kind=TargetKind.SYMBOL,
        path="apps/web/src/example.ts",
        target="buildPayload",
        normalized_source=source,
    )


def test_normalization_ignores_line_endings_indentation_comments_and_blanks() -> None:
    original = "  const value = 'a  b';\n"
    reformatted = "\r\n\n\tconst value = 'a  b'; // display-only note\r\n"

    assert normalize_source(original) == normalize_source(reformatted)


def test_normalization_preserves_literal_content_and_operators() -> None:
    assert normalize_source("value = 'a  b'\n") != normalize_source(
        "value = 'a b'\n"
    )
    assert normalize_source("value = 1 + 2\n") != normalize_source(
        "value = 1 - 2\n"
    )


def test_unrelated_line_shift_does_not_change_fingerprint() -> None:
    base = _base_input()
    shifted = replace(
        base,
        normalized_source="\n\n// context moved\n  " + base.normalized_source,
    )

    assert fingerprint(base) == fingerprint(shifted)


@pytest.mark.parametrize(
    "field, value",
    [
        ("tool", "typescript"),
        ("rule", "@typescript-eslint/no-unused-vars"),
        ("mechanism", "diagnostic"),
        ("target_kind", TargetKind.SPAN),
        ("path", "apps/web/src/other.ts"),
        ("target", "otherTarget"),
        ("normalized_source", "const value = 'changed';"),
    ],
)
def test_finding_identity_changes_when_any_authority_input_changes(
    field: str, value: object
) -> None:
    base = _base_input()

    assert fingerprint(base) != fingerprint(replace(base, **{field: value}))


def test_pair_order_is_canonical_and_endpoint_changes_invalidate() -> None:
    left = Endpoint("apps/web/src/a.ts", "first")
    right = Endpoint("apps/web/src/b.ts", "second")

    assert canonical_pair(left, right) == canonical_pair(right, left)

    base = replace(
        _base_input(),
        target_kind=TargetKind.PAIR,
        path=left.path,
        target=left.target,
        peer_path=right.path,
        peer_target=right.target,
    )
    reversed_pair = replace(
        base,
        path=right.path,
        target=right.target,
        peer_path=left.path,
        peer_target=left.target,
    )
    changed_endpoint = replace(base, peer_target="changed")

    assert fingerprint(base) == fingerprint(reversed_pair)
    assert fingerprint(base) != fingerprint(changed_endpoint)


def test_vue_script_and_template_nodes_have_distinct_identity() -> None:
    script = (FIXTURE_DIR / "vue-script.vue").read_text(encoding="utf-8")
    template = (FIXTURE_DIR / "vue-template.vue").read_text(encoding="utf-8")
    base = _base_input()

    assert fingerprint(replace(base, normalized_source=script)) != fingerprint(
        replace(base, normalized_source=template)
    )


def test_configuration_and_command_option_changes_invalidate_identity() -> None:
    base = _base_input()
    config = (FIXTURE_DIR / "config.json").read_text(encoding="utf-8")
    workflow = (FIXTURE_DIR / "workflow.yml").read_text(encoding="utf-8")

    config_input = replace(
        base,
        tool="prettier",
        rule="format",
        mechanism="config",
        target_kind=TargetKind.CONFIG,
        path="apps/web/.prettierrc.json",
        target="singleQuote",
        normalized_source=config,
    )
    command_input = replace(
        base,
        tool="github-actions",
        rule="continue-on-error",
        mechanism="command",
        target_kind=TargetKind.COMMAND,
        path=".github/workflows/ci.yml",
        target="run: npm run lint --if-present",
        normalized_source=workflow,
    )

    assert fingerprint(config_input) != fingerprint(
        replace(config_input, normalized_source=config.replace("false", "true"))
    )
    assert fingerprint(command_input) != fingerprint(
        replace(command_input, target="run: npm run lint")
    )


def test_fingerprint_is_sha256_and_canonical_json_is_unambiguous() -> None:
    base = _base_input()
    digest = fingerprint(base)

    assert digest.startswith("sha256:")
    assert len(digest) == len("sha256:") + 64
    assert digest == fingerprint(replace(base))
    assert fingerprint(replace(base, target="ab", path="c")) != fingerprint(
        replace(base, target="a", path="bc")
    )
