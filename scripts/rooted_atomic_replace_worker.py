"""Perform one bounded rooted replacement inside the private bubblewrap mount."""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from bounded_input import FileIdentity, InputTooLargeError, RootedDirectory


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--relative", type=Path, required=True)
    parser.add_argument("--identity", required=True)
    parser.add_argument("--max-bytes", type=int, required=True)
    args = parser.parse_args(argv)
    value = sys.stdin.buffer.read(args.max_bytes + 1)
    if len(value) > args.max_bytes:
        raise InputTooLargeError
    identity = FileIdentity(*json.loads(args.identity))
    with RootedDirectory(Path("/workspace")) as root:
        root.write_bytes(args.relative, value, identity)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
