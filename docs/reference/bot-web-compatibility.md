# Phytomni-Bot to Web compatibility reference

Status: local Web contract reference; live acceptance is not claimed.

The companion [Bot/Web activation evidence matrix](bot-web-activation-matrix.md)
is the local checker input for reviewed acceptance rows and dark-launch flags.
`scripts/check_bot_web_activation.py` is a deterministic, offline Web evidence
gate; it does not turn local tests into external acceptance.

This document records the boundary consumed by `release/0.1.3` Web Go. The
browser talks only to Web Go. Web Go owns user identity, row ownership, legacy
history compatibility, response shaping, and the sanitized projection stored
in MySQL. Bot remains the source of Bot-run content and lifecycle state.

## Identity and ownership

`run_id` is the umbrella Bot run identity. Web stores it as `bot_run_id` and
uses it for polling, history joins, projection reconciliation, and A2UI
authorization. `id` in an OpenAI-compatible completion is a completion id, not
a Bot run id. `task_ids` are child task ids retained for legacy task/log
surfaces; they are never substituted for `run_id` and are never used by
`GET /v1/runs/{id}` polling.

Every read and projection write is constrained by the authenticated Web
`user_name` plus the Web row id. A row from another user, even when it carries
the same `bot_run_id` or points at the same `f_id`, is excluded from history.
The Bot principal is not a browser identity; Bot memory remains unavailable
until a separate per-user identity contract is accepted.

## JSON field contract

The table separates Bot transport fields from the bounded public projection.
Unknown additive fields may be received, but private/raw payloads are not
persisted or returned to the browser.

| JSON field | Source / owner | Web meaning and rule |
| --- | --- | --- |
| `id` | Bot transport | OpenAI completion id. Diagnostic only; never a run join key. |
| `run_id` | Bot transport | Required umbrella identity for pollable runs; copied to `bot_run_id`. A null id is accepted only with `degraded_tracking=true` for a non-pollable successful answer. |
| `agent` | Bot transport | Canonical Bot slug (`deep_genome`, `analyst`, etc.); mapped to the Web tool name. |
| `status` | Bot transport / Web projection | Normalized lifecycle status. See [status values](#status-values). |
| `task_ids` | Bot transport | Child ids for legacy task/log compatibility only; not lifecycle identity. |
| `result.report_stage` | Bot result | `waiting_for_brief_gene`, `intermediate`, or `final`. |
| `result.report_completeness` | Bot result | `none`, `partial`, or `complete`. |
| `result.report_revision` | Bot result | Non-negative monotonic revision. Legacy rows use `-1`. |
| `result.report_updated_at` | Bot result | RFC3339 timestamp normalized to UTC. |
| `result.intermediate_report` | Bot result | Bounded, sanitized Markdown used when no non-empty final report exists. |
| `result.final_report` | Bot result | Bounded, sanitized Markdown and the preferred visible report when non-empty. |
| `result.formatted` | Bot result | Compact answer/references or tabular data for cited/data agents; shaped before reaching Web UI. |
| `result.progress` | Bot result | Bounded counters (`completed`, `total`, `failed`, `pending`) and brief-gene status only. |
| `result.degraded` / `degraded_reason` | Bot result | Safe partial-result marker and bounded reason; optional failure does not erase an intermediate report. |
| `result.failures` | Bot result | Bounded safe failure messages; provider traces, SQL, credentials, and raw state are excluded. |
| `result.artifacts` | Bot result | Validated output directories and OBS paths. Empty paths do not invent download URLs. |
| `degraded_tracking` | Bot transport | Explicitly records that tracking is unavailable. Web never fabricates a run id. |
| `request_id` | Web context | Web correlation id in response/error envelopes. Bot's response header id is diagnostic server metadata only. |

The persisted `bot_projection_json` contains only the sanitized public
projection fields. It does not contain `id`, `request_id`, raw Bot envelopes,
provider diagnostics, child payloads, SQL, credentials, or private paths.

## Old and new column mapping

Projection persistence is additive and reversible. Existing Web fields remain
readable while the new projection is observed.

| Web column | Role during compatibility cutover | Ownership / precedence |
| --- | --- | --- |
| `bot_run_id` | New canonical umbrella run join key. | Web-owned association; must match the projection `run_id`. |
| `bot_projection_json` | New sanitized versioned Bot snapshot. | Bot content snapshot persisted by Web with owner-scoped CAS. |
| `bot_report_revision` | New indexed CAS revision; default `-1` means no projection/legacy row. | Bot report ordering; older/equal blank snapshots cannot erase visible text. |
| `task_id` | Legacy child-task id used by old async/update-log surfaces. | Compatibility only; never a Bot polling id. |
| `server_id` | Legacy DeepGenome server/task alias. | Compatibility only; not the umbrella identity. |
| `answer` | Legacy Web answer column and shaped history value. | Web fallback when no valid projection/Bot run is available; otherwise mirrors the projection's visible report. |
| `status` | Legacy row status. | Mirrors the normalized projection when a status is present; blank upstream status leaves it unchanged. |
| `tool_name` | Web canonical tool display branch. | Derived from the canonical Bot slug; not taken from an arbitrary child payload. |
| `download_path`, `image_paths` | Legacy artifact columns. | Updated only from validated non-empty projection artifacts; existing values survive empty artifact responses. |
| `id`, `user_name`, `dialogue_id`, `f_id`, `reaction_type`, `collect_type`, `upload_path` | Web row identity and user-owned fields. | Never replaced by Bot content reconciliation; all reads remain owner-scoped. |

The exact additive production migration is operator-controlled. From the
repository root, run:

```bash
cd apps/server
go run main.go migrate add-bot-projection
```

The command is idempotent and applies the equivalent statements in order:

```sql
ALTER TABLE question_agent_logs
  ADD COLUMN bot_projection_json LONGTEXT NULL
  COMMENT 'sanitized Bot run projection' AFTER bot_run_id;
ALTER TABLE question_agent_logs
  ADD COLUMN bot_report_revision BIGINT NOT NULL DEFAULT -1
  COMMENT 'last Bot report revision' AFTER bot_projection_json;
CREATE INDEX idx_question_agent_logs_bot_report_revision
  ON question_agent_logs(bot_report_revision);
```

Do not run the development `migrate all`/AutoMigrate path against production.
Production schema execution, backup, and rollback remain an operator decision;
this Web-only work does not run production DDL.

## Status values and revision semantics

The public lifecycle statuses are:

- `RUNNING`: the umbrella run is pollable and may expose an intermediate report;
- `INPUT_REQUIRED`: a native Review/A2UI pause with a validated surface and the
  same umbrella run id;
- `SUCCEEDED`: a terminal run with a final report when available;
- `FAILED`: a terminal run whose final synthesis failed; the latest non-empty
  intermediate report remains visible.

The decoder also normalizes compatibility statuses `PENDING`, `QUEUED`,
`CANCELLED`/`CANCELED`, and `TIMED_OUT`/`TIMEOUT` for the bounded projection.
An empty or unsupported status is rejected (the reconciler's legacy blank
status guard leaves the row untouched).

For every poll, `report_revision` is monotonic. Older revisions are ignored;
equal revisions may merge non-empty metadata; newer revisions may replace
fields while blank values never erase visible report text. `final_report` wins
when non-empty; otherwise the newest
non-empty `intermediate_report` is the visible report. Optional failures keep
the intermediate report and mark the projection degraded. Empty artifact lists
do not clear existing validated artifact columns.

## History fallback order

`AnswerCheck` follows this reversible read order for each owner-scoped row:

1. Read a persisted projection whose `run_id` matches the row's `bot_run_id`.
2. Prefer that projection's status, tool, and visible report; retain Web-owned
   reaction, collection, upload, and row identity fields.
3. If the projection is absent, malformed, unavailable, or the Bot gateway is
   dark/unreachable, keep the legacy MySQL query/answer/status fields.
4. When Bot history is active, a valid `/v1/runs` result may fill the missing
   content; it must not replace a valid persisted projection with an older or
   less-complete response.

A running submission with a missing umbrella `run_id` is an error
(`ErrMissingBotRunID`) rather than a row keyed by a child task. A successful
response with `run_id: null` and `degraded_tracking: true` is explicitly
non-pollable; Web returns the answer without fabricating an identity.

## Timeout and error mapping

The blocking `/query` boundary maps a transport deadline (`ErrBotTimeout`) to
HTTP **504 Gateway Timeout** with the safe message
`request timed out, please narrow your query or try again later`. The Web
request id may be returned as `request_id`; the upstream Bot `X-Request-Id` is
kept only as bounded server diagnostics and never replaces the Web id.

Other stable mappings are: gateway/expert disabled → 503, unknown tool or
invalid A2UI surface → 400, missing umbrella run id → 409, and surfaceable Bot
client errors → 400. Unclassified failures use a generic 500 response. SSE
failures after the first frame are represented as an in-band `RunError`; no
synthetic successful report is created.

## Acceptance boundary

Local Go tests and offline compatibility checks exercise synthetic fixtures only.
They are not Bot or production acceptance evidence. The following rows remain
**External Pending** until an authorized acceptance packet is returned and
reviewed:

| Row | Scope | Status |
| --- | --- | --- |
| RC-WEB-001 | Umbrella submission and run identity | External Pending |
| RC-WEB-002 | Monotonic intermediate/final revisions | External Pending |
| RC-WEB-003 | DeepGenome partial/degraded/failure matrix | External Pending |
| RC-WEB-004 | Analyst/Design/Network reports and artifacts | External Pending |
| RC-WEB-005 | Timeout and request-id behavior | External Pending |
| RC-WEB-006 | A2UI and AG-UI pass-through | External Pending |
| RC-WEB-007 | Expert/history dual-read and rollback | External Pending |
| RC-LIVE-001 | Authorized live end-to-end run | External Pending |

No row above is marked passed by this document. Feature gates remain dark by
default (`expert_enabled`, `stream_enabled`, and `a2ui_actions_enabled` are
false), and no Bot, operations, deployment, or live configuration change is
part of this Web reference.
