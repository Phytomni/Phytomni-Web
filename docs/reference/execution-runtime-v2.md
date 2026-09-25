# Unified Agent Execution Runtime V2

## Purpose and ownership

Runtime V2 replaces the synchronous-message/run-keyed coupling with one
browser-created `execution_id` (`client_turn_id`) that exists before any Agent
work begins. Web owns user/conversation authorization and the durable message
shell. Bot owns Agent selection, execution, journal sequence, spans, work units,
Todo, Results, public decision summaries, and terminal settlement.

The command path is deliberately single-owner:

1. Web validates identity, permission, attachments, request bounds, and the
   canonical Agent allowlist.
2. One Web transaction allocates the conversation/message shell, execution
   admission, and outbox command, then returns `202 Accepted`.
3. The leased Web dispatcher admits that command to Bot V2. It never executes
   Agent business logic.
4. Bot reserves the stable execution, resolves autonomous Expert through the
   private `expert-router` sentinel, rebinds the same execution to the selected
   public Agent, and delegates to the existing canonical business handler.
5. Bot's journal and supervisor are the only execution fact/terminal writers.
6. The leased Web projector copies bounded public facts and the completed
   message snapshot into Web history. Message/output commit happens before the
   separate conversation-context acknowledgement.
7. Browser SSE is a live view over persisted state. Disconnecting it never
   cancels the execution; refresh/offline completion is recovered from Web's
   projection.

No Runtime adapter may copy routing rules, scientific thresholds, prompt
construction, provider choice, or result shaping. The private Expert sentinel
is not an eleventh public Agent and disappears from the projected Agent slug
after routing.

## Public Web API

- `POST /api/v1/conversations/:id/messages` accepts `client_turn_id` and, when
  V2 is enabled, returns the durable shell/execution identity without waiting
  for Agent content.
- `GET /api/v1/executions/:execution_id` returns the owner-scoped projection.
- `GET /api/v1/executions/:execution_id/events` returns a bounded durable page.
- `GET /api/v1/executions/:execution_id/events/stream` immediately sends the
  admitted/cached snapshot and heartbeats, including before Bot dispatch.
- `GET /api/v1/executions/:execution_id/events/:event_id` returns one bounded
  public fact.
- `POST /api/v1/executions/:execution_id/actions` and `/cancel` are revisioned
  operations on the same execution.
- `GET /api/v1/executions/:execution_id/targets/:kind/:target_id` reauthorizes
  an opaque typed target; clients never submit paths, storage keys, or URLs.

Unknown and foreign owner bindings intentionally have the same not-found
response. Bot V2 routes require the Web service identity and are not browser
surfaces.

## Persistence and compatibility

Bot's V2 journal is authoritative. Web stores an owner/execution admission,
one outbox command, a monotonic projection/cursor, bounded event cache, content
revision/offset, and context revision. Legacy V1 runs and task logs remain
read-only, labeled incomplete history. V1 adapters may format/wait/read V2 but
must not become another write authority.

Retain legacy records until all of the following are measured for at least one
release retention window: no V1 compatibility writes, no run-addressed browser
traffic, all non-terminal legacy work is settled, rollback no longer depends on
the schema, and the data-retention owner approves removal. Additive columns and
historical rows are not deleted during rollback.

`conversation_messages_v2` is the canonical ordered conversation projection
for V2 turns. Its owner/conversation/index and owner/execution/source-event
unique indexes prevent cross-owner collisions and duplicate projector replay;
`delete_at` is the retention/tombstone boundary. Conversation deletion soft
deletes these items together with their execution admission and cached public
facts. Retention may purge tombstoned items only after the product retention
window and its associated execution has no rollback or audit hold.

The rollback for this additive schema is operational, not destructive: stop
new V2 admission, stop dispatcher/projector workers, and restore the explicit
legacy compatibility handler while leaving `conversation_messages_v2`,
admissions, outbox rows, and event cache intact. Re-enabling V2 resumes from
their durable cursors. A rollback must never drop the table, renumber
`message_index`, merge user/assistant items into an aggregate row, or copy
projected assistant content back into `question_agent_logs.answer`.

### Required Web schema preflight

Runtime V2 production DDL is explicit and operator-controlled. Before the new
Web binary receives traffic, back up the database, stop the old Web process,
and run the migration shipped in that same binary:

```bash
cd apps/server
./phytomni-server migrate add-execution-runtime-v2
```

For a deployment that predates `question_agent_execution_admissions`, first run
`./phytomni-server migrate add-execution-admissions`. The Runtime V2 migration
is additive and idempotent; re-run it once and require a zero exit status before
starting Web. It creates or completes `conversation_turns_v2`,
`conversation_turn_sequences_v2`, `conversation_messages_v2`,
`question_agent_execution_outbox`, and
`question_agent_execution_events_v2`, and extends the admission table with the
V2 revision, terminal, health, and lease fields. It does not rewrite legacy
conversation rows.

Web performs a read-only schema check before authenticating to Bot or opening
`:8080`. A missing table, column, or declared index fails startup with the
`migrate add-execution-runtime-v2` repair command; Web never runs production DDL
implicitly and must not report ready with a partially migrated Runtime V2
schema.

## Activation and process identity

Deploy Bot before Web and verify the V2 runtime/journal capability. Bot and Web
must then receive the same environment-only `PHYTOMNI_API_SERVICE_TOKEN`; Web
fails startup when it cannot authenticate its canonical dispatcher/projector.
Transactional message admission and execution workers are one production path,
not independently selectable implementations.

Frontend `VITE_EXECUTION_V2_ENABLED` and the presentation-only
`VITE_EXECUTION_WORKBENCH_ENABLED` may control rendering during rollout, but
they never change execution ownership or restore the retired synchronous path.
`PHYTOMNI_EXECUTION_V1_COMPAT_ENABLED` remains a read/wait/format compatibility
window only and must not create or settle executions.

## Execution activity detail production defaults

The enriched Activity view uses the existing Runtime V2 journal. It does not
add a polling loop or persist SSE heartbeats. These defaults are intentionally
finite and are advertised by Bot capabilities:

| Control                                       |                               Production default |
| --------------------------------------------- | -----------------------------------------------: |
| `PHYTOMNI_EXECUTION_EVENTS_ENABLED`           |                                           `true` |
| `PHYTOMNI_EXECUTION_V1_COMPAT_ENABLED`        |           `true` during the compatibility window |
| `PHYTOMNI_EXECUTION_LOG_ENABLED`              |                        `false` (explicit opt-in) |
| `VITE_EXECUTION_V2_ENABLED`                   |   enabled unless set to the exact string `false` |
| `VITE_EXECUTION_WORKBENCH_ENABLED`            |   enabled unless set to the exact string `false` |
| semantic progress coalescing                  |                                           500 ms |
| quiet-operation liveness coalescing           |                                             30 s |
| SSE heartbeat                                 |         15 s, transport-only and never journaled |
| grouped operations / attempts / detail fields | 256 per run / 8 per operation / 16 per operation |
| event payload / public summary                |                          16 KiB / 512 characters |
| event retention / live backlog                |                           10,000 per run / 1,000 |
| optional redacted execution log               |                                            1 MiB |

The 2026-08-22 pre-rollout measurement ran the real SQLite journal and runtime
tests. The byte column below is the sum of the stored public summary, public
payload, and target JSON columns; it excludes SQLite row/index overhead and is
therefore suitable for comparing scenarios, not database capacity planning.

| Measured scenario                                             | Journal events | Work-unit events | Public JSON bytes |
| ------------------------------------------------------------- | -------------: | ---------------: | ----------------: |
| successful public-agent baseline (10 agents)                  |         8 each |                0 |  1,391–1,943 each |
| Review progress with two semantic updates                     |             11 |                0 |             3,276 |
| two tool operations (one succeeds, one fails)                 |             20 |               12 |             3,020 |
| three model operations with retry, failure, and cancellation  |             28 |               20 |             4,455 |
| quiet operation with probes at 0 ms, 29,999 ms, and 30,000 ms |       16 total |                8 |             2,756 |

The quiet-operation row persisted exactly two liveness facts: the 29,999 ms
probe was coalesced and the 30,000 ms boundary probe was retained. Neither
liveness fact contained a fabricated completed/total counter. Browser SSE
heartbeats remained transport contact only and contributed zero journal rows.

Reproduce the measurement with the focused runtime, instrumentation, and
liveness tests in `tests/unit/test_execution_runtime_v2.py`,
`tests/unit/test_execution_instrumentation_v2.py`, and
`tests/unit/test_execution_liveness_v2.py`, then count `execution_events_v2`
and the lengths of its three public JSON columns.

## Release and independent rollback

Deploy Bot before Web. First deploy Bot with durable event production enabled
and the execution log left disabled, then verify the authenticated capability
record, a resumable event stream, and owner-scoped projection reads. Deploy Web
only after that verification; enable the V2 transport and workbench flags in
the frontend build. Enable the optional log in a later Bot-only rollout after
checking storage and redaction metrics.

The rollback switches are independent and are covered by unit tests:

- Rebuild Web with `VITE_EXECUTION_WORKBENCH_ENABLED=false` to hide the
  execution workbench without changing Bot execution or journal production.
- Rebuild Web with `VITE_EXECUTION_V2_ENABLED=false` to stop the browser V2
  event transport while retaining legacy-history presentation.
- Set `PHYTOMNI_EXECUTION_LOG_ENABLED=false` and restart Bot to stop producing
  new downloadable logs without disabling durable execution events.
- After the Web presentation/transport rollback is live, set
  `PHYTOMNI_EXECUTION_EVENTS_ENABLED=false` and restart Bot if journal event
  production itself must be stopped. Do not use the V1 compatibility flag as
  an alternate execution path.

All migrations are additive. Rollback changes flags and binaries only; it does
not drop Runtime V2 tables or delete retained execution records.

## Operator endpoints

The following authenticated admin/super-admin endpoints return `Cache-Control:
no-store` and never expose command JSON, prompts, provider payloads, paths, or
credentials:

- `GET /api/v1/admin/executions/:execution_id?owner_ref=...`
- `POST /api/v1/admin/executions/:execution_id/actions?owner_ref=...`
- `GET /api/v1/admin/execution-runtime/metrics`

Finite actions are `retry_dispatch`, `retry_reconcile`, `retry_projection`,
`dead_letter_dispatch`, and `settle_stranded_failed`. Dispatch mutations require
`expected_outbox_revision`; projection retry requires
`expected_projection_attempts`. Redispatch is rejected after a Bot run or
dispatch revision exists, so the endpoint cannot duplicate Agent/provider work.
It schedules the canonical worker and never invokes Bot directly.

## Metrics and initial alerts

The admin metrics view exposes fixed-cardinality process counters plus database
gauges for pending/dead-letter dispatch, due/degraded projection, and oldest lag.
Bot separately exposes fixed-cardinality journal append/failure/recovery
observations. Alert initially on:

- any dead-letter dispatch or append failure;
- oldest dispatch or projection lag above 60 seconds for 5 minutes;
- degraded projection above zero for 5 minutes;
- repeated lease steals, stream gaps, deadlines, partial outcomes, or V1
  compatibility use above the measured baseline.

Never attach owner, execution, run, Agent, provider, prompt, or error-message
values as metric labels. Recalibrate thresholds only from a recorded canary.

## Ambiguous dispatch and reconciliation bounds

Web performs at most six blind Bot delivery attempts with bounded exponential
backoff. Timeout, connection loss, or an unavailable acknowledgement after the
invocation boundary does not terminalize the admitted message. Exhaustion
moves the outbox record to `reconcile`, retains degraded operational metadata,
and keeps projection eligible by owner plus public `execution_id` even when no
`bot_run_id` was acknowledged.

The Bot catalog execution deadline is the outer unresolved-delivery bound
(currently 300 seconds to 7,200 seconds by Agent). Bot's supervisor owns the
truthful timed-out or other terminal decision. Web admin/super-admin operator
actions may retry, reconcile, or explicitly reject only under the current
outbox and execution revision fences. Metrics distinguish retry, reconcile,
reject, degraded projection, oldest reconciliation, and terminal conflicts;
only bounded first/last error codes are retained.

## Convergence and rollback audit

The retained V1/run-addressed handlers are read/format compatibility adapters.
The old request-owned settlement and lifecycle-read reconciliation paths must
not write V2 state. `durable-agent-activity-workbench` is superseded for runtime
identity, streaming, persistence, and projection by
`unified-agent-execution-runtime`; it remains unarchived until cross-service
provider acceptance and human business-parity sign-off are recorded.

Rollback order is frontend, Web admission, Web workers, Bot supervisor, then Bot
runtime. Do not delete V2 admissions/journal rows. In-flight admitted work may
be resumed by re-enabling the same workers; it must never be resubmitted through
the legacy message path.

### Bot-first reconciliation rollout and in-flight rollback

Before a Web binary that writes `reconcile` is enabled, deploy the compatible
Bot schema/runtime first and verify all of the following with the same service
identity Web will use:

1. ordinary admission still returns the legacy-compatible acknowledgement and
   durable `run_id`;
2. owner plus public `execution_id` resolves admitted, running, waiting-input,
   and terminal snapshots, including a late `run_id` when the original HTTP
   acknowledgement is unavailable;
3. replaying a claimed command does not invoke Agent/provider work twice; and
4. one terminal reservation has exactly one matching terminal journal fact.

The 2026-08-24 local compatibility gate exercised a real Bot process before
the Web reconciliation worker. It covered the ordinary acknowledged path, a
persisted admission whose acknowledgement was dropped, a complete Bot outage
followed by recovery, and all ten public Agent handlers. The acknowledged path
remained compatible, while the lost acknowledgement converged by
`execution_id` to one Bot run, one command row, one terminal fact, and the
correct assistant content. This is local release evidence, not a production
canary or activation approval.

If Web must be rolled back while rows are in flight:

- retain every admission, outbox, turn, message, and cached-event row;
- leave `acknowledged` rows with `bot_run_id` for the restored projector;
- leave `reconcile` rows without `bot_run_id` untouched—the older dispatcher
  does not claim that state, and no operator may turn it back into a blind
  Agent dispatch;
- use only revision-fenced `retry_reconcile` or `retry_projection` after the
  compatible Web worker returns; and
- keep the Bot reconciliation snapshot and atomic terminal settlement online
  until the count of admitted/reconciling rows reaches the recorded baseline.

Do not translate `reconcile` to legacy dead-letter/failed state, copy a Bot
answer into legacy aggregate tables, clear correlation fields, or drop the
additive columns. Bot rollback is last and is forbidden while a Web
`reconcile` row can still refer to an admitted Bot execution.
