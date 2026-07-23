#!/usr/bin/env bash

set -euo pipefail

ROOT="$(git rev-parse --show-toplevel)"
cd "$ROOT"

step() { printf '\n\e[1;34m==> %s\e[0m\n' "$*"; }
note() { printf '    %s\n' "$*"; }
fail() {
    printf '\n\e[1;31mFAIL: %s\e[0m\n' "$*" >&2
    exit 1
}

# Treat ripgrep/grep status 0 (match) and 1 (no match) as expected. Any other
# status is an execution failure and must stop the owning gate.
check_match_status() {
    local status="$1"
    local label="${2:-match scan}"
    case "$status" in
    0 | 1) return 0 ;;
    *) fail "$label failed with status $status." ;;
    esac
}

resolve_main_ref() {
    if git show-ref --verify refs/heads/main >/dev/null 2>&1; then
        printf '%s\n' main
    elif git show-ref --verify refs/remotes/origin/main >/dev/null 2>&1; then
        printf '%s\n' origin/main
    else
        return 1
    fi
}

run_static_analysis_check() {
    local ledger_path="$1"
    shift
    local output
    local status
    local -a command=(
        python3
        scripts/check_static_analysis_exemptions.py
        --check
    )
    if [ "$ledger_path" != "-" ]; then
        command+=(--check-ledger "$ledger_path")
    fi
    command+=("$@")
    output="$(mktemp)"
    if "${command[@]}" >"$output"; then
        rm -f "$output"
        return 0
    else
        status=$?
    fi
    tail -40 "$output" >&2
    rm -f "$output"
    return "$status"
}
