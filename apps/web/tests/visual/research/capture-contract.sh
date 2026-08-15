#!/usr/bin/env bash
set -euo pipefail

OUTPUT_DIR="${PHYTOMNI_VISUAL_OUTPUT_DIR:-/tmp/phytomni-research-visual}"
SESSION="phy-research-contract"
BASE_URL="${PHYTOMNI_VISUAL_BASE_URL:-http://127.0.0.1:5176/tests/visual/research/}"

cleanup() {
    if ! agent-browser --session "${SESSION}" close >/dev/null 2>&1; then
        printf 'Research contract capture cleanup: browser close failed\n' >&2
    fi
}
trap cleanup EXIT

mkdir -p "${OUTPUT_DIR}"

capture() {
    local width="$1"
    local height="$2"
    local theme="$3"
    local stem="research-contract__${width}x${height}__${theme}"

    agent-browser --session "${SESSION}" set viewport "${width}" "${height}"
    agent-browser --session "${SESSION}" set media "${theme}"
    agent-browser --session "${SESSION}" open \
        "${BASE_URL}?case=contract&locale=en-US&theme=${theme}"
    agent-browser --session "${SESSION}" wait --fn \
        "(() => { const root = document.querySelector('[data-testid=deep-genome-visual-root]'); return root?.dataset.fixtureReady === 'true' || Boolean(root?.dataset.fixtureError); })()"
    agent-browser --session "${SESSION}" eval \
        "(() => { const root = document.querySelector('[data-testid=deep-genome-visual-root]'); if (root?.dataset.fixtureError) throw new Error(root.dataset.fixtureError); if (typeof window.assertScientificMarkdownVisualContract !== 'function') throw new Error('scientific Markdown visual contract: oracle unavailable'); const result = window.assertScientificMarkdownVisualContract(); if (typeof result !== 'object' || result === null || result.pass !== true) throw new Error('scientific Markdown visual contract: oracle did not pass'); return result; })()" \
        >"${OUTPUT_DIR}/${stem}.contract.json"
    agent-browser --session "${SESSION}" screenshot "${OUTPUT_DIR}/${stem}.png"
}

for viewport in "1440 900" "390 844"; do
    read -r width height <<<"${viewport}"
    for theme in light dark; do
        capture "${width}" "${height}" "${theme}"
    done
done
