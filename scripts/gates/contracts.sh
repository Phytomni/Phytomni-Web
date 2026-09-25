#!/usr/bin/env bash

set -euo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=scripts/gates/common.sh
source "$SCRIPT_DIR/common.sh"

step "G11 apps/web: SET_LOGIN_STATUS invariant (definition + sole-caller + no-stray)"
if def_count="$(grep -c 'SET_LOGIN_STATUS(' apps/web/src/stores/user.ts)"; then
    :
else
    def_rc=$?
    check_match_status "$def_rc" "G11.1 SET_LOGIN_STATUS definition scan"
    def_count=0
fi
[ "$def_count" = "1" ] || fail "G11.1 SET_LOGIN_STATUS definition: expected 1 hit in apps/web/src/stores/user.ts, got $def_count"
if call_count="$(grep -c 'SET_LOGIN_STATUS(' apps/web/src/views/login/LoginView.vue)"; then
    :
else
    call_rc=$?
    check_match_status "$call_rc" "G11.2 SET_LOGIN_STATUS call scan"
    call_count=0
fi
[ "$call_count" = "1" ] || fail "G11.2 SET_LOGIN_STATUS sole legal call: expected 1 hit in apps/web/src/views/login/LoginView.vue, got $call_count"

candidate_files="$(mktemp)"
stray_files="$(mktemp)"
trap 'rm -f "$candidate_files" "$stray_files"' EXIT
if grep -rl 'SET_LOGIN_STATUS' apps/web/src/ \
    --include='*.ts' --include='*.vue' >"$candidate_files"; then
    :
else
    candidate_rc=$?
    check_match_status "$candidate_rc" "G11.3 SET_LOGIN_STATUS scan"
fi
awk '
  $0 != "apps/web/src/stores/user.ts" &&
  $0 != "apps/web/src/views/login/LoginView.vue" { print }
' "$candidate_files" >"$stray_files" || fail "G11.3 SET_LOGIN_STATUS filtering failed."
[ ! -s "$stray_files" ] || {
    cat "$stray_files" >&2
    fail "G11.3 SET_LOGIN_STATUS stray caller: files above must not reference SET_LOGIN_STATUS — only stores/user.ts (definition) and views/login/LoginView.vue (sole call) are allowed."
}

step "G-0 contracts: exact static-analysis surface"
run_static_analysis_check - \
    --collector source \
    --collector config \
    --collector ci

mapfile -d '' -t workflow_paths < <(git ls-files -z '.github/workflows/*')
if [ "${#workflow_paths[@]}" -gt 0 ]; then
    scripts/actionlint_runner.sh -no-color "${workflow_paths[@]}"
else
    note "no tracked GitHub Actions workflows; skip actionlint"
fi

step "G13 i18n: hardcoded-copy scanner (ratchet against allowlist)"
python3 scripts/check_i18n.py --check

step "G14 frontend visual design contract"
python3 scripts/check_brand_colors.py

step "G15 A2UI activation contract"
python3 scripts/check_a2ui_activation_contract.py

step "G16 offline Bot HEAD/Web compatibility contract"
python3 scripts/check_bot_web_compatibility.py

step "G17 offline Bot/Web activation evidence matrix"
python3 scripts/check_bot_web_activation.py
