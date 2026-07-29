# Conversation Context V1

Status: dark launch. The Go and Bot feature flags remain disabled by default. This document describes the activation boundary; it is not evidence of staging or production activation.

## Scope and authority

V1 covers the synchronous Chat, Knowledge, Data, Review, and Brief Gene agents. Expert mode may still select an asynchronous agent, but its existing `202` and run/task lifecycle is unchanged. V1 does not claim synchronous completion for those agents.

| Boundary | Authority |
| --- | --- |
| Authentication, user permissions, dialogue ownership, durable visible rows, retry identity, deletion, and owner-scoped artifact authorization | Web Go service |
| Agent selection result, business-context projection, per-agent thread state, context delta, stage, settlement, and tombstone behavior | Phytomni-Bot |

Bot is authoritative for business context. Web Go is authoritative for user service and authorization. Bot never becomes a user or permission store, and Web never reconstructs business state from display prose.

## Enablement prerequisite

The Go feature gate is `bot.multiturn_v1_enabled`. The committed example configuration keeps it `false`. Go may send V1 envelopes only after Bot advertises `conversation_context` protocol version `1` from `/v1/agents`.

Both sides must be enabled deliberately in an authorized environment. With the Go gate off, requests use the existing V0 payload and response behavior. No live configuration is changed by this document.

## Request and settlement flow

1. Go authenticates the user, resolves the owner-scoped dialogue ledger, checks the user's current allowed agents, and constructs the V1 envelope. Instant mode fixes `ChatAgent`; Expert mode sends one explicit selection or no selection for Bot routing.
2. The envelope carries bounded user history, the current message, the complete current allowlist, and opaque authorized artifact references. It never carries storage paths, signed URLs, credentials, or display answer/report/table text.
3. Bot validates the envelope, selects the agent, and emits bounded stage metadata. The selected agent produces the visible answer and a business-context delta independently.
4. Go commits the visible result and private stage/artifact metadata atomically before acknowledging the Bot mutation. Blocking and streaming use the same settlement boundary.
5. When acknowledgment succeeds, the Bot context advances. When acknowledgment is unavailable after a durable visible result, Go records `ACK_PENDING` and retries acknowledgment before the next envelope.
6. A degraded or missing context preserves a successful visible answer but schedules a bounded rebuild from owner-scoped accepted Go history. At the current boundary, raw display output is never persisted as `AssistantSummary`; without a typed Bot-owned metadata summary, no assistant history entry is replayed.
7. A canceled or failed stream does not commit an assistant summary or a successful context delta. Stale submissions remain bounded by the existing cleanup/reconciliation path.

## Lifecycle states

| State | Meaning | Operator action |
| --- | --- | --- |
| `SUBMITTING` | Go has allocated a logical turn, but Bot completion or settlement is uncertain. | Retry the same logical client turn; do not create a second turn manually. |
| `ACK_PENDING` | The visible Go result is durable, but Bot acknowledgment is pending. | Allow the acknowledgment retry/reconciler to run before accepting the next V1 envelope. |
| `CONTEXT_DELETE_PENDING` | The owner-visible dialogue was deleted, but Bot tombstoning has not been confirmed. | Keep the row hidden and allow tombstone retry. |
| `CONTEXT_DELETE_ACKED` | Bot confirmed the tombstone. | No further context read or write is allowed for the deleted dialogue. |
| degraded/rebuild required | Bot context is absent, incompatible, or explicitly degraded. | Perform the one bounded rebuild from accepted Go metadata; do not replay raw answers. |

## Artifacts and email boundary

Chat artifact DTOs contain opaque artifact references and display metadata only. Go checks the authenticated user, dialogue, message, and artifact ownership when the user clicks. Only then does it mint a fresh relay URL. Artifact links are delivered directly in chat through this authenticated boundary.

Email is temporarily unavailable and is not a fallback. The legacy email download surface remains a predictable `410 Gone`; no conversation workflow may enqueue or depend on email delivery.

## Cleanup and observability

Stale `SUBMITTING` rows, pending acknowledgments, and pending tombstones are reconciled by the existing bounded cleanup paths. Cleanup must preserve owner scope and must not resurrect deleted context.

The only approved metric names are:

```text
conversation_context_prepare_total{outcome}
conversation_context_rebuild_total{reason}
conversation_context_stage_total{outcome}
conversation_context_settle_total{outcome}
conversation_context_tombstone_total{outcome}
conversation_context_degraded_total{agent}
conversation_submission_stale_total
```

Metric labels and logs must never contain a user name, dialogue ID, turn text, summary, artifact ID or path, allowlist, credential, signed URL, or raw answer/report/table output. Log only bounded outcome, reason, and canonical agent labels where the metric contract permits them.

## Staging activation runbook

Use synthetic accounts and synthetic data only.

1. Deploy Bot with its V1 flag `false`.
2. Verify `/v1/agents` does not advertise `conversation_context` V1.
3. Enable Bot V1 in authorized staging.
4. Verify `/v1/agents` advertises `conversation_context: [1]`.
5. Deploy Go/Web with `bot.multiturn_v1_enabled: false`.
6. Run V0 smoke tests.
7. Enable the Go V1 flag in authorized staging.
8. Run the ten acceptance scenarios: Instant lock, Expert explicit and automatic routing, Knowledge-to-Data-to-Review metadata continuity, Brief Gene follow-up/new identifier, permission revocation, Bot restart rebuild, retry idempotency, stream cancellation, owner isolation, and disabled/legacy behavior including async lifecycle.
9. Observe stage, settle, rebuild, degraded, acknowledgment, tombstone, and stale-submission outcomes using the approved counters.
10. Disable Go V1 immediately on a protocol, authorization, ownership, artifact, or lifecycle regression.

## Rollback

1. Disable `bot.multiturn_v1_enabled` in Go first. New requests immediately use V0, while existing visible rows remain readable and pending cleanup continues.
2. Verify Go no longer sends the `conversation` envelope or V1 mutation requests.
3. Disable the Bot V1 flag only after Go has stopped sending V1.
4. Do not delete Bot context tables or rewrite `bot_projection_json`; the additive private context is harmless to V0 readers.

If an ownership or artifact-isolation defect appears, disable Go V1 immediately and escalate it as a security incident. Do not wait for context drain.
