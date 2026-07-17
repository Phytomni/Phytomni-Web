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
