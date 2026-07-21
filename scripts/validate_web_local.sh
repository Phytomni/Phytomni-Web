#!/usr/bin/env bash

set -euo pipefail

ROOT="$(git rev-parse --show-toplevel)"
cd "$ROOT"

GATE_GROUPS=(hygiene frontend-static frontend-runtime server-static server-runtime contracts)
for group in "${GATE_GROUPS[@]}"; do
    if [ "$group" = "server-runtime" ]; then
        export PHYTOMNI_RUN_RACE=1
    else
        unset PHYTOMNI_RUN_RACE
    fi
    "$ROOT/scripts/run_gate_group.sh" "$group"
done

printf '\n\e[1;34m==> validate_web_local.sh: ALL GATES PASS\e[0m\n'
