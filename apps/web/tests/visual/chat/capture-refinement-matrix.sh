#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
WEB_ROOT="$(cd "${SCRIPT_DIR}/../../.." && pwd)"
REPO_ROOT="$(cd "${WEB_ROOT}/../.." && pwd)"
EVIDENCE_DIR="${REPO_ROOT}/.codex/evidence/frontend-v2/chat-home-visual-refinement/refinement"
SESSION="phy-chat-refinement"
BASE_URL="http://127.0.0.1:5174/tests/visual/chat/"

cleanup() {
    if ! agent-browser --session "${SESSION}" close >/dev/null 2>&1; then
        printf 'chat refinement cleanup: browser close failed\n' >&2
    fi
}
trap cleanup EXIT

mkdir -p "${EVIDENCE_DIR}"
test -d "${EVIDENCE_DIR}"
find "${EVIDENCE_DIR}" -mindepth 1 -maxdepth 1 -type f -delete

viewports=("390 844" "1440 900" "2560 1440")
themes=("light" "dark")

capture_current() {
    local stem="$1"
    agent-browser --session "${SESSION}" eval --stdin \
        <"${SCRIPT_DIR}/measure-geometry.js" |
        tee "${EVIDENCE_DIR}/${stem}.geometry.json"
    test -s "${EVIDENCE_DIR}/${stem}.geometry.json"
    agent-browser --session "${SESSION}" eval --stdin \
        <"${SCRIPT_DIR}/assert-geometry.js"
    agent-browser --session "${SESSION}" eval --stdin \
        <"${SCRIPT_DIR}/assert-refinement-styles.js" |
        tee "${EVIDENCE_DIR}/${stem}.refinement.json"
    test -s "${EVIDENCE_DIR}/${stem}.refinement.json"
    agent-browser --session "${SESSION}" screenshot \
        "${EVIDENCE_DIR}/${stem}.png"
}

open_fixture() {
    local state="$1"
    local theme="$2"
    agent-browser --session "${SESSION}" set media "${theme}"
    agent-browser --session "${SESSION}" open \
        "${BASE_URL}?state=${state}&locale=en-US&theme=${theme}"
    agent-browser --session "${SESSION}" wait --fn \
        "document.querySelector('[data-testid=chat-visual-root]')?.dataset.fixtureReady === 'true'"
    agent-browser --session "${SESSION}" wait --fn \
        "document.querySelectorAll('[data-testid=\"chat-case-link\"]').length === 8 && document.querySelectorAll('.chat-case-monogram').length === 1 && [...document.querySelectorAll('.chat-case-icon img')].length === 7 && [...document.querySelectorAll('.chat-case-icon img')].every((img) => img.complete && img.naturalWidth === 660)"
}

for viewport in "${viewports[@]}"; do
    read -r width height <<<"${viewport}"
    for theme in "${themes[@]}"; do
        agent-browser --session "${SESSION}" set viewport "${width}" "${height}"

        nav_state="empty"
        if [[ "${width}" == "390" ]]; then
            nav_state="sidebar-mobile-open"
        fi
        open_fixture "${nav_state}" "${theme}"
        capture_current "chat__new-chat-selected__${width}x${height}__en-US__${theme}"
        agent-browser --session "${SESSION}" click \
            '[data-test=sidebar-nav-explore-agent]'
        agent-browser --session "${SESSION}" wait --fn \
            "document.querySelector('[data-testid=chat-visual-root]')?.dataset.activeSidebarItem === 'explore-agent'"
        capture_current "chat__explore-selected__${width}x${height}__en-US__${theme}"

        open_fixture "empty" "${theme}"
        capture_current "chat__instant-selected__${width}x${height}__en-US__${theme}"
        agent-browser --session "${SESSION}" click '[data-test=chat-mode-expert]'
        agent-browser --session "${SESSION}" wait --fn \
            "document.querySelector('[data-testid=chat-visual-root]')?.dataset.chatMode === 'expert'"
        capture_current "chat__expert-selected__${width}x${height}__en-US__${theme}"
        open_fixture "expert-selected-empty" "${theme}"
        capture_current \
            "chat__expert-agent-selected__${width}x${height}__en-US__${theme}"
    done
done

png_count=$(find "${EVIDENCE_DIR}" -maxdepth 1 -type f -name '*.png' | wc -l | tr -d ' ')
geometry_count=$(find "${EVIDENCE_DIR}" -maxdepth 1 -type f -name '*.geometry.json' | wc -l | tr -d ' ')
refinement_count=$(find "${EVIDENCE_DIR}" -maxdepth 1 -type f -name '*.refinement.json' | wc -l | tr -d ' ')
test "${png_count}" -eq 30
test "${geometry_count}" -eq 30
test "${refinement_count}" -eq 30

agent-browser --session "${SESSION}" close
trap - EXIT
