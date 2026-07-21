#!/usr/bin/env bash

set -euo pipefail

ROOT="$(git rev-parse --show-toplevel)"
GROUP="${1:-}"

case "$GROUP" in
hygiene | frontend-static | frontend-runtime | server-static | server-runtime | contracts)
    script="$ROOT/scripts/gates/$GROUP.sh"
    ;;
*)
    printf 'unknown gate group: %s\n' "$GROUP" >&2
    exit 2
    ;;
esac

if [ ! -x "$script" ]; then
    printf 'gate group is missing or not executable: %s\n' "$script" >&2
    exit 1
fi

exec "$script"
