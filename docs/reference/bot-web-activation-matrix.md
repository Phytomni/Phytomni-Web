# Bot/Web activation evidence matrix

Status: local Web evidence gate only. This document does not accept Bot,
operations, deployment, production, browser-live, or other external evidence.
Local unit tests and synthetic fixtures prove Web-owned behavior; they are not
external acceptance and must not move an acceptance row to `Passed`.

The machine-readable block below is the only part consumed by the offline
checker. Its schema is versioned and deliberately contains metadata only:
fixture identifiers and checksums identify evidence without embedding fixture
payloads, user data, queries, answers, URLs, request ids, or upstream errors.

<!-- BOT_WEB_ACTIVATION_MATRIX_JSON_START -->
```json
{
  "schema_version": 1,
  "feature_flags": {
    "expert": false,
    "stream": false,
    "a2ui": false,
    "history_dual_read": false
  },
  "rows": [
    {
      "id": "RC-WEB-001",
      "status": "External Pending",
      "fixture_id": "",
      "fixture_sha256": ""
    },
    {
      "id": "RC-WEB-002",
      "status": "External Pending",
      "fixture_id": "",
      "fixture_sha256": ""
    },
    {
      "id": "RC-WEB-003",
      "status": "External Pending",
      "fixture_id": "",
      "fixture_sha256": ""
    },
    {
      "id": "RC-WEB-004",
      "status": "External Pending",
      "fixture_id": "",
      "fixture_sha256": ""
    },
    {
      "id": "RC-WEB-005",
      "status": "External Pending",
      "fixture_id": "",
      "fixture_sha256": ""
    },
    {
      "id": "RC-WEB-006",
      "status": "External Pending",
      "fixture_id": "",
      "fixture_sha256": ""
    },
    {
      "id": "RC-WEB-007",
      "status": "External Pending",
      "fixture_id": "",
      "fixture_sha256": ""
    },
    {
      "id": "RC-LIVE-001",
      "status": "External Pending",
      "fixture_id": "",
      "fixture_sha256": ""
    }
  ],
  "local_readiness": {
    "rc_web_004": {
      "fixture_ids": [
        "rc-web-004-research-terminal",
        "rc-web-004-design-terminal",
        "rc-web-004-network-terminal"
      ],
      "shared_report_surface_test": "apps/web/tests/component/BotRemoteAgentSurfaces.spec.ts"
    }
  },
  "rollback": [
    "disable_web_flag",
    "retain_legacy_history",
    "restore_previous_web_release"
  ]
}
```
<!-- BOT_WEB_ACTIVATION_MATRIX_JSON_END -->

## Acceptance rows

| Row | Scope | Status |
| --- | --- | --- |
| RC-WEB-001 | Umbrella submission and run identity | External Pending |
| RC-WEB-002 | Monotonic intermediate/final report revisions | External Pending |
| RC-WEB-003 | DeepGenome partial, degraded, and failure behavior | External Pending |
| RC-WEB-004 | Analyst, Design, and Network reports and artifacts | External Pending |
| RC-WEB-005 | Timeout and request-id behavior | External Pending |
| RC-WEB-006 | A2UI and AG-UI pass-through | External Pending |
| RC-WEB-007 | Expert/history dual-read and rollback | External Pending |
| RC-LIVE-001 | Authorized live end-to-end run | External Pending |

All four capability switches are dark by default. `expert` maps to the Web
Expert permission and `expert_enabled`; `stream` maps to the AG-UI stream
switch; `a2ui` maps to `a2ui_actions_enabled`; and `history_dual_read` maps to
the Web-owned reversible history reader. A switch may only leave dark launch
after its exact required row set is reviewed by an authorized owner. A local
test pass, a commit, or a fixture checksum is not by itself external evidence.

## Required evidence sets

- `stream`: RC-WEB-001 through RC-WEB-006.
- `expert`: RC-WEB-001, RC-WEB-004, RC-WEB-005, and RC-WEB-007.
- `a2ui`: RC-WEB-001, RC-WEB-005, and RC-WEB-006.
- `history_dual_read`: RC-WEB-001, RC-WEB-002, RC-WEB-003, and RC-WEB-007.

## Rollback notes

1. Disable the corresponding Web feature flag immediately.
2. Retain the legacy `answer`, `status`, and history columns and keep the
   sanitized projection data additive; do not delete rows during rollback.
3. Restore the previous Web release if persistence, replay, or history
   rendering is unsafe.
4. This Web checker does not ask Bot or operations to change code, runtime
   configuration, schema, or deployment state.

The checker is local and non-mutating. It never reads a sibling Bot checkout,
handoff/operations evidence, or live endpoint, and it never declares any row
above passed from local evidence alone.

## Historical synthetic verification record (2026-07-17; superseded)

- Commit under test: `51be5a3` (Task 27 synthetic compatibility closure).
- Sanitized fixture ids: `web-task27-stream`, `web-task27-run-error`,
  `web-task27-expert-research`, and `web-task27-history`. Fixtures contain only
  bounded synthetic identities; no query, answer, report, error payload, URL,
  credential, or user data is recorded here.
- Focused Go command: `GOCACHE=/tmp/phytomni-go-cache
  GOTMPDIR=/tmp/phytomni-go-tmp go test ./external/bot ./service/api_service
  -run 'Test(AGUICompatibilityFixture|QueryStream_Combined|CompatibilityFixture_)'
  -count=1` — PASS (`external/bot`, `service/api_service`).
- Focused Web command: `npx --no-install vitest run
  tests/unit/views/chat/streaming/aguiEvents.spec.ts
  tests/unit/views/chat/streaming/useStreamMessage.spec.ts` — PASS (2 files,
  33 tests).
- Repository gate: `./scripts/validate_web_local.sh` — G1/G2/G3/G4/G5/G6 PASS;
  G7.5 is blocked by the pre-existing
  `TestQueryRemoteMissingRunIDDoesNotPersistPollableRow` assertion in
  `apps/server/service/api_service/query_compat_test.go:87` (got the existing
  `unknown tool: invalid expert response`, expected `ErrMissingBotRunID`).
  This unrelated failure is recorded verbatim and is not reclassified as a
  Task 27 failure.
- Observed Web-owned defaults: `expert=false`, `stream=false`, `a2ui=false`,
  `history_dual_read=false`.
- These are synthetic Web-owned unit checks only. Bot, operations,
  deployment, production, browser-live, and external rollout acceptance were
  not performed. `RC-WEB-001` through `RC-WEB-007` and `RC-LIVE-001` remain
  `External Pending`.

## Local RC-WEB-004 product fixture record (2026-07-18)

- Product fixture ids: `rc-web-004-research-terminal`,
  `rc-web-004-design-terminal`, and `rc-web-004-network-terminal`. Each fixture
  is sanitized, uses a canonical agent slug, and carries an explicit artifact
  list; the Design fixture is empty and the Network fixture has an empty path
  list to exercise warning behavior.
- Shared report-surface test: `apps/web/tests/component/BotRemoteAgentSurfaces.spec.ts`.
  The offline checker requires all three distinct fixture ids and this shared
  test before local RC-WEB-004 readiness is accepted.
- This is Web-owned synthetic evidence only. The RC-WEB-004 acceptance row
  remains `External Pending` until an authorized Bot/operations acceptance
  packet is reviewed.

## Current Web closure record (2026-07-18)

- Commit under test: `b6975f9` (`release/0.1.3`), including the final
  compatibility gate repairs.
- Full repository gate:
  `GOCACHE=/tmp/phytomni-web-task38-gocache
  GOTMPDIR=/tmp/phytomni-web-task38-gotmp ./scripts/validate_web_local.sh` —
  PASS; 184 frontend test files / 2329 tests; G13, G14, G15, G16, and G17
  PASS.
- Fresh uncached Go verification:
  `GOCACHE=/tmp/phytomni-web-task38-gocache
  GOTMPDIR=/tmp/phytomni-web-task38-gotmp go test ./... -count=1` — PASS.
- The local closure supersedes the historical Task 27 gate snapshot above;
  it does not change the matrix JSON, external acceptance rows, or
  dark-launch defaults.
