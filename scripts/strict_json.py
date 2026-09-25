# Copyright (c) Biotechnology Research Institute,
# Chinese Academy of Agricultural Sciences. 2024-2026. All rights reserved.
# Author: xieshang (xieshang0608@gmail.com)
"""Strict, depth-bounded JSON decoding for local contract inputs."""

from __future__ import annotations

import json
from typing import Any


DEFAULT_MAX_JSON_DEPTH = 64


class StrictJsonError(ValueError):
    """Raised when JSON is malformed or exceeds the accepted structure."""


def loads_strict_json(
    raw: str | bytes | bytearray,
    *,
    max_depth: int = DEFAULT_MAX_JSON_DEPTH,
) -> Any:
    """Decode JSON while rejecting duplicates, constants, and deep trees."""

    if max_depth < 1:
        raise ValueError("JSON depth limit must be positive")

    def object_without_duplicates(
        pairs: list[tuple[str, Any]],
    ) -> dict[str, Any]:
        value: dict[str, Any] = {}
        for key, item in pairs:
            if key in value:
                raise StrictJsonError("duplicate JSON key")
            value[key] = item
        return value

    def reject_constant(_value: str) -> Any:
        raise StrictJsonError("malformed JSON constant")

    try:
        value = json.loads(
            raw,
            object_pairs_hook=object_without_duplicates,
            parse_constant=reject_constant,
        )
    except StrictJsonError:
        raise
    except (RecursionError, TypeError, UnicodeDecodeError, ValueError) as exc:
        raise StrictJsonError("malformed JSON") from exc

    stack: list[tuple[Any, int]] = [(value, 1)]
    while stack:
        current, depth = stack.pop()
        if isinstance(current, dict):
            if depth > max_depth:
                raise StrictJsonError("JSON nesting depth exceeded")
            stack.extend((child, depth + 1) for child in current.values())
        elif isinstance(current, list):
            if depth > max_depth:
                raise StrictJsonError("JSON nesting depth exceeded")
            stack.extend((child, depth + 1) for child in current)
    return value


__all__ = [
    "DEFAULT_MAX_JSON_DEPTH",
    "StrictJsonError",
    "loads_strict_json",
]
