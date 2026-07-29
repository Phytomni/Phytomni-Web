#!/usr/bin/env bash
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
WEB_ROOT="$(cd "${SCRIPT_DIR}/../../.." && pwd)"
REPO_ROOT="$(cd "${WEB_ROOT}/../.." && pwd)"
EVIDENCE_DIR="${REPO_ROOT}/.codex/evidence/frontend-v2/ui-remediation"
SESSION="phy-ui-remediation"
BASE_URL="http://127.0.0.1:5174/tests/visual/ui-remediation/"
captures=(
    "change-password|1190|903|en-US" "change-password|1190|903|zh-CN" "change-password|390|844|en-US" "change-password|390|844|zh-CN" "markdown|1190|903|zh-CN" "review|1190|903|en-US" "review|390|844|en-US" "brief-gene|1190|903|en-US" "brief-gene|390|844|en-US" "cases|1440|900|en-US" "cases|768|1024|en-US" "cases|390|844|en-US" "review-preview|1440|900|en-US" "review-preview|390|844|en-US" "brief-gene-preview|1440|900|en-US" "brief-gene-preview|390|844|en-US"
)
mkdir -p "${EVIDENCE_DIR}"
test -d "${EVIDENCE_DIR}"
for row in "${captures[@]}"; do
    IFS='|' read -r state width height locale <<<"${row}"
    stem="ui__${state}__${width}x${height}__${locale}"
    agent-browser --session "${SESSION}" set viewport "${width}" "${height}"
    agent-browser --session "${SESSION}" open "${BASE_URL}?state=${state}&locale=${locale}"
    agent-browser --session "${SESSION}" wait --fn "document.querySelector('[data-testid=ui-remediation-visual-root]')?.dataset.fixtureReady === 'true'"
    if [[ "${state}" == *-preview ]]; then
        agent-browser --session "${SESSION}" click '[data-testid="ui-remediation-preview-trigger"]'
        agent-browser --session "${SESSION}" wait '[role="dialog"]'
    fi
    agent-browser --session "${SESSION}" eval --stdin <"${SCRIPT_DIR}/assert-contracts.js" >"${EVIDENCE_DIR}/${stem}.contract.json"
    agent-browser --session "${SESSION}" errors >"${EVIDENCE_DIR}/${stem}.errors.txt"
    agent-browser --session "${SESSION}" console >"${EVIDENCE_DIR}/${stem}.console.txt"
    agent-browser --session "${SESSION}" screenshot "${EVIDENCE_DIR}/${stem}.png"
done
