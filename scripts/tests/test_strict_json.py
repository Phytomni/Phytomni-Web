"""Tests for bounded fail-closed JSON decoding."""

from __future__ import annotations

import pytest

from scripts.strict_json import StrictJsonError, loads_strict_json


def test_strict_json_rejects_duplicate_keys() -> None:
    with pytest.raises(StrictJsonError, match="duplicate"):
        loads_strict_json(b'{"outer":{"value":1,"value":2}}')


def test_strict_json_rejects_excessive_nesting() -> None:
    raw = ("[" * 65 + "0" + "]" * 65).encode()

    with pytest.raises(StrictJsonError, match="depth"):
        loads_strict_json(raw, max_depth=64)


def test_strict_json_normalizes_decoder_recursion_failure() -> None:
    raw = ("[" * 10_000 + "0" + "]" * 10_000).encode()

    with pytest.raises(StrictJsonError, match="malformed"):
        loads_strict_json(raw, max_depth=64)
