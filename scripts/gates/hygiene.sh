#!/usr/bin/env bash

set -euo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=scripts/gates/common.sh
source "$SCRIPT_DIR/common.sh"

step "G-1 secret scan (changed + untracked files)"
changed="$(mktemp)"
hits_file="$(mktemp)"
shell_inventory="$(mktemp)"
trap 'rm -f "$changed" "$hits_file" "$shell_inventory"' EXIT
# Scan staged + unstaged tracked changes AND new untracked files (a brand-new
# file carrying a secret is invisible to `git diff` until it is added).
# --exclude-standard honors .gitignore, so node_modules/dist/.codex stay out.
{
    git diff --name-only -z --diff-filter=ACMR
    git diff --cached --name-only -z --diff-filter=ACMR
    git ls-files --others --exclude-standard -z
} | sort -zu >"$changed"

if [ -s "$changed" ]; then
    # Real-secret patterns — literal value forms, not field names.
    mapfile -d '' -t changed_paths <"$changed"
    : >"$hits_file"
    for path in "${changed_paths[@]}"; do
        if rg -nP \
            -e '[A-Z0-9]{20}\.[A-Za-z0-9/+]{40}' \
            -e 'AKIA[0-9A-Z]{16}' \
            -e 'AKLT[A-Za-z0-9]{20,}' \
            -e '(mysql|postgres(?:ql)?)://[^[:space:]\"]+:[^[:space:]\"@]+@' \
            -e 'Bearer\s+[A-Za-z0-9._\-]{30,}' \
            -e 'eyJ[A-Za-z0-9_\-]{20,}\.[A-Za-z0-9_\-]{20,}\.[A-Za-z0-9_\-]{20,}' \
            -- "$path" >>"$hits_file"; then
            scan_rc=0
        else
            scan_rc=$?
        fi
        check_match_status "$scan_rc" "G-1 secret scan command for '$path'"
    done
    if [ -s "$hits_file" ]; then
        cat "$hits_file"
        fail "G-1 secret scan: literal credential-shaped strings detected above; redact before commit."
    fi
    note "no real-secret patterns in changed files"
else
    note "no staged/unstaged changes — skip"
fi

step "G0 git diff --check"
git diff --check
git diff --cached --check
note "no whitespace errors"

if [ "${PHYTOMNI_HYGIENE_SCOPE:-full}" = "full" ]; then
    # Full gates own every tracked shell/hook file. Scoped gates set the
    # changed-scope marker and run the same pinned tools over their partition.
    git ls-files -z '*.sh' '.githooks/*' >"$shell_inventory"
    if [ -s "$shell_inventory" ]; then
        mapfile -d '' -t shell_paths <"$shell_inventory"
        scripts/shellcheck_runner.sh "${shell_paths[@]}"
        scripts/shfmt_runner.sh -d -i 4 "${shell_paths[@]}"
    else
        note "no tracked shell files; skip ShellCheck and shfmt"
    fi

    python3 scripts/check_repository_files.py --check --scope full
    python3 scripts/scan_secrets.py --all
    main_ref="$(resolve_main_ref)" ||
        fail "cannot resolve main or origin/main for the range secret scan"
    range_base="$(git merge-base HEAD "$main_ref" 2>/dev/null)" ||
        fail "cannot resolve merge-base HEAD $main_ref for the range secret scan"
    python3 scripts/scan_secrets.py --range "$range_base..HEAD"
else
    note "scoped hygiene: full-tree repository tools deferred to changed-file scope"
fi

step "G-0 static-analysis exact registry and ledger"
run_static_analysis_check docs/development/static-analysis-exemptions.md \
    --collector eslint \
    --collector typescript \
    --collector source \
    --collector config \
    --collector ci \
    --collector go
