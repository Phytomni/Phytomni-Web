# UI remediation visual fixtures

This isolated harness serves `/tests/visual/ui-remediation/?state=<key>&locale=<locale>`. States are `change-password`, `markdown`, `review`, `brief-gene`, `cases`, `review-preview`, and `brief-gene-preview`; locales are `en-US` and `zh-CN`. Missing or invalid parameters render a visible error and never become ready.

The harness imports production components but has a sanitized, synthetic fixture boundary: it starts a fresh Pinia, uses `researcher@example.test`, has no production guards or runtime plugins, and is not imported by production source.

Run the fixture server with `npm run dev -- --host 127.0.0.1 --port 5175 --strictPort`, then run `./tests/visual/ui-remediation/capture-matrix.sh`. The closed matrix contains the 16 literal rows in that script. Each row saves a PNG, contract JSON, browser errors, and browser console output below the ignored `.codex/evidence/frontend-v2/ui-remediation/` directory.

Inspect every PNG personally and record `filename | result (PASS/FAIL/Needs Verification) | notes` in the ignored review ledger. Only images marked `PASS` in that ledger may be offered for human review. Capturing evidence does not itself record PASS. The BriefGene fixture is the admitted `Os01g0177400` result; visual acceptance still requires the browser capture and self-review steps.
