#!/usr/bin/env bash

set -euo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=scripts/gates/common.sh
source "$SCRIPT_DIR/common.sh"

step "G11 apps/web: SET_LOGIN_STATUS invariant (definition + sole-caller + no-stray)"
def_count="$( grep -c 'SET_LOGIN_STATUS(' apps/web/src/stores/user.ts 2>/dev/null || echo 0 )"
[ "$def_count" = "1" ] || fail "G11.1 SET_LOGIN_STATUS definition: expected 1 hit in apps/web/src/stores/user.ts, got $def_count"
call_count="$( grep -c 'SET_LOGIN_STATUS(' apps/web/src/views/login/index.vue 2>/dev/null || echo 0 )"
[ "$call_count" = "1" ] || fail "G11.2 SET_LOGIN_STATUS sole legal call: expected 1 hit in apps/web/src/views/login/index.vue, got $call_count"
stray="$( grep -rl 'SET_LOGIN_STATUS' apps/web/src/ \
  --include='*.ts' --include='*.vue' 2>/dev/null \
  | grep -v -E '^apps/web/src/stores/user\.ts$|^apps/web/src/views/login/index\.vue$' \
  || true )"
[ -z "$stray" ] || { printf '%s\n' "$stray" >&2; fail "G11.3 SET_LOGIN_STATUS stray caller: files above must not reference SET_LOGIN_STATUS — only stores/user.ts (definition) and views/login/index.vue (sole call) are allowed."; }

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
