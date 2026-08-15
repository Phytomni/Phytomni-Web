# Bot & operations runbook

**Evergreen — the recurring Web ↔ Phytomni-Bot operational procedures** that stay
valid across releases: Bot key mint/rotation, the dark-launch activation gates
(Expert, streaming, A2UI, remote product surfaces, interop, and history
dual-read), degraded-mode behavior, and rollback. All examples are
scrubbed — never paste real keys, tokens, or DSNs into this file or into commits.

> **What's evergreen vs one-time here.** §1–§5 (service token, key mint, 90-day
> rotation, topology, real-user isolation), §9 (degraded mode), and §11
> (dark-launch activation gates) are **ongoing** — you will run them repeatedly.
> §6–§8 and §10 (the original `/query` cutover, ETL trigger, post-cutover Huawei
> cleanup) describe the **one-time Python→Go cutover that is already done**; they
> are kept as reference alongside [`history/python-to-go-cutover.md`](history/python-to-go-cutover.md).

Architecture reference: the internal Web↔Bot target-architecture document (maintained separately, not in this repo).
The gateway is dormant until `bot.proxy_enabled=true`.

> **⚠️ API path reorganization (RESTful `/api/v1`):** async result write-back has moved to `PATCH /api/v1/async-tasks/analyst-log`; the Bot currently still calls the old `POST /query/analyst/update_log`, which stays served as an alias on the Go side and will be removed by ops once the Bot is backported to the new path. Where the text below references old `/query/...` paths, the new contract takes [`API_DOC.md`](../../apps/server/API_DOC.md)'s `/api/v1` as authoritative.

## 1. Bot service token (ops-only)

The Bot **service token** mints and revokes user keys. It is ops-only:
it never enters `app.yml`, source, or git. It lives only in the ops
secrets channel and on the Bot side. Web Go holds a **user key**, not the
service token, and contains no key-mint/revoke code.

## 2. First deploy — mint the `ptm_<web>` user key

One Web app = one Bot principal (`user_id="web"`). Mint once at deploy:

```bash
curl -X POST <bot-base-url>/v1/api-keys \
  -H "Authorization: Bearer <SERVICE_TOKEN>" \
  -H "Content-Type: application/json" \
  -d '{"user_id":"web","name":"chat-ai-web-app"}'
```

Take the one-time `api_key` from the response and write it to production
`app.yml` `bot.user_api_key` (secure config delivery, not git). Set
`bot.base_url` to the internal Bot URL (e.g. `http://bot.internal:8000`).

The key MUST carry the `relay:obs` scope — Bot's relay routes deny
scope-less keys (this is intentional; legacy keys do not auto-gain relay
access). Grant it at mint time per the Bot-side key-issuing procedure, or
re-issue the key with the scope if the current one lacks it. The Bot
deployment itself must run with `RELAY_ENABLED=true`, otherwise every
`/v1/relay/*` route 404s and gene/analyst result downloads fail.

## 3. 90-day key rotation (ops procedure, not a Web Go cron)

1. Mint a new `ptm_<web>` key via the curl in §2.
2. Write it to production `app.yml`.
3. Rolling-restart Web Go (no downtime).
4. Revoke the old key once in-flight requests drain:

```bash
curl -X DELETE <bot-base-url>/v1/api-keys/<old-prefix> \
  -H "Authorization: Bearer <SERVICE_TOKEN>"
```

Logs must redact the key to its prefix only (`bot.key_audit_redact=true`).

## 4. Topology constraint

Bot is internal-only; Web Go is the sole internet-facing service. chat-ai
never reaches Bot directly. `/query` and `/query/analyst/update_log` are
served by Web Go at the root path (not under `/v1`) with the standard JWT
auth chain.

## 5. Real-user isolation (must stay covered)

Bot always sees `user_id="web"`. Real-user isolation is 100% Web Go's job:
every read that joins Bot data filters on the Web identity. `ApiAnswerCheck`
(B-5) and `ApiQuery` (B-4) scope by `user_name` (the JWT-decoded user).
Any future Bot-proxy endpoint must do the same — never trust a client-sent
user id.

## 6. Cutover sequence (Push #2 — gated, STAGED)

**Operator-only.** Every step in this section is run by ops on the
production host, and ONLY after the gateway code is complete, reviewed,
and three-party signed off. Nothing here is executed from the Web repo or
by an AI agent — the repo's job ends at "code ready + this doc correct."
Production stays untouched until that gate passes.

Preconditions: gateway code complete + reviewed; Bot deploy URL provided;
the `ptm_<web>` user key already issued and held by ops (§2 documents the
mint/rotate procedure); Bot e2e green; `timeout_seconds` set above the
slowest SYNC agent (prod observed chat ~140s / knowledge ~198s /
review >300s → use ≥900s); three-party sign-off.

NOTE — the production Bot was already smoke-verified end-to-end against the
live deploy (2026-06-11): chat/knowledge/data returned correctly shaped
answers (`{content,doc_list}` / `{headers,rows}`) through the gateway, and
deep_genome `species_code` is Bot-fixed. The Bot team's ongoing dev-branch
graph work is NOT a precondition — it does not touch the production deploy.

Stage the cutover so the REVERSIBLE flip precedes the IRREVERSIBLE delete,
keeping an instant rollback live throughout verification:

1. Deploy Web Go with the gateway code (dormant, `proxy_enabled=false`).
2. **Reversible flip** (instant-rollback-able — do NOT delete Python yet):
   - set `app.yml` `bot.base_url` / `user_api_key` / `timeout_seconds`,
     flip `bot.proxy_enabled` to `true`
   - route production `/query` to Web Go — ops choice: flip the nginx
     upstream, OR deploy Web Go into the slot the Python service occupies
     so the existing route resolves to the gateway (no nginx edit). This
     routing change, not the flag, is what actually moves traffic; it is
     the only production-facing edit, made here at cutover and reversible
     (§8)
   - run `go run main.go migrate add-bot-run-id` against prod once
     (idempotent) if the `bot_run_id` column is missing
   - leave the Python service RUNNING on its port
3. **Production smoke** through the live gateway (every agent × immediate +
   history replay). On any failure → §8 rollback (flag + repoint, no git).
4. **Soak window** (hours / a day) with the flip live and Python standing by.
5. **Only after smoke green + soak — the irreversible acts:**
   - remove the Python systemd unit on the production host (ops); the
     in-repo `nky_client_python/` is already gone (deleted in the cutover
     commit, now in `main` history), so no repo `git rm` remains here — only
     the host-side service teardown
   - retire the decommissioned Python's OBS credentials in the Huawei
     console. NOTE — Web `/query` uploads already relay through Bot
     (`/v1/files`), and gene/analyst result downloads now go through
     Bot's OBS relay (`/v1/relay/obs/*`), so the gateway holds NO Huawei
     OBS credentials at all: the `huawei.obs.*` keys are gone from
     `app.yml` and any leftover Web-side OBS ak/sk can be retired in the
     Huawei console together with the Python ones. Preconditions for the
     download path: Bot deploy sets `RELAY_ENABLED=true` and the
     `ptm_<web>` key carries the `relay:obs` scope (§2). Downloads whose
     stored path predates the cutover (legacy EIHealth prefixes/buckets
     outside Bot's output root) are rejected by Bot and surface to users
     as "historical data is no longer available for download" — expected, forward-only policy.

## 7. Phase 6 ETL trigger (Option Y only — currently deferred)

Historical-row backfill is deferred (Option X). If/when Option Y is
chosen: three-party sign-off → Web provides a read-only production MySQL
DSN over a secure channel → Bot ops runs a dry-run + reconciliation →
production ETL → Web runs the `bot_run_id` backfill. Not required for
cutover; old rows read MySQL legacy fields via the B-5 fallback.

## 8. Rollback

Two windows, matching the staged §6:

1. **Before the §6-step-5 delete (the safe window):** flip `app.yml`
   `bot.proxy_enabled` back to `false` AND route `/query` back to the
   still-running Python service (reverse whichever method §6 step 2 used —
   nginx upstream or slot swap). Instantly restored — no git changes, no
   redeploy. This is exactly why §6 keeps Python standing until after smoke
   - soak.
2. **After the production decommission:** the in-repo Python service was
   already removed in the cutover commit (in `main` history), so restore it
   with `git revert` of that commit, redeploy it, repoint `/query` at the
   Python port, restart. The `bot_run_id` column stays (harmless, nullable).
3. `ApiAnswerCheck` serves MySQL legacy fields while the gateway is off, so
   history replay keeps working in either window.

## 9. Degraded mode (Bot unavailable)

- Startup: with `proxy_enabled=true`, Web Go fails fast if Bot `/v1/agents`
  is unreachable or missing a required slug. With `proxy_enabled=false`,
  Web Go boots without contacting Bot.
- Runtime: `/query` returns a 5xx with an operator-actionable log when Bot
  is down; `/v1/answer/check` degrades to MySQL legacy fields rather than
  failing. Web Go itself never crashes on Bot trouble.

## 10. Post-deploy: remove dead Huawei config (operator)

- Delete the `huawei.*` block from the live `config/app.yml` (the Go service no
  longer reads it).
- Optional one-time cleanup: any RUNNING `question_agent_logs` row that predates
  the Bot cutover (has a `task_id` but no `bot_run_id`) can no longer be
  reconciled and can be marked failed, e.g.
  `UPDATE question_agent_logs SET status='FAILED' WHERE status='RUNNING' AND (bot_run_id IS NULL OR bot_run_id='') AND created_at < '<cutover-date>';`
  Run only after confirming such rows exist and are genuinely stale.

## 11. `0.1.3` / `0.1.4` dark-launched features — Bot-coordination activation gates

The `0.1.4` compatibility follow-up preserves the `0.1.3` dark-launch contract
for the capabilities listed below. The extended Research input rollout is a
separate, no-new-flag deployment contract with storage and proxy preconditions
in §12. The `0.1.3` release ships several Web↔Bot capabilities **dark** on the Web side
(default-OFF flags, byte-identical to the blocking behavior until flipped). Each
flip requires a matching Bot-side capability, security review where applicable,
and owner/CI/staging/live evidence **first**, or the feature breaks on
activation. Keep these coordination points here so Bot owners and ops flip in
lockstep. Local G15–G17 checks are readiness evidence only; every row in the
activation matrix remains **External Pending** until an authorized packet is
reviewed.

### 11.1 Expert routing mode (`bot.expert_enabled`)

- **Web state:** the Instant/Expert selector and the `mode` column are live but
  dark (`bot.expert_enabled=false`). Instant is unaffected; any `mode=expert`
  request returns **503** while dark.
- **Bot precondition to flip ON:** the Bot must serve
  **`POST /v1/query/route`** for autonomous Expert routing. Forced Expert
  Knowledge and Brief Gene may use the direct SSE path described in §11.2 only
  when their exact `/v1/agents` descriptors advertise
  `capabilities.streaming=true`; all other Expert routes remain blocking.
- **Activation order:** (1) Bot deploys `/v1/query/route`; (2) ops adds the
  `question_agent_logs.mode` column (repo-reorg manual §5.6); (3) ops sets
  `bot.expert_enabled=true` and restarts Web Go. Rollback = flip the flag back
  (instant; the column is additive and harmless).

### 11.2 AG-UI SSE streaming (`bot.stream_enabled` + `VITE_STREAM_ENABLED`)

- **Web state:** the streaming spine (Go tee-forward + `useStreamMessage`) is
  complete but dark. With `bot.stream_enabled=false`, `/query` keeps the blocking
  ChatCompletion path byte-for-byte.
- **⚠️ Bot precondition to flip ON (load-bearing):** the Bot must persist the
  **real accumulated answer** in its run record — not the `"[streamed]"`
  placeholder. The persisted `bot_run_id` is the Bot run-**registry** id from the
  `RunStarted` frame, which is what makes a streamed chat row overlay-matchable on
  reload. **If the flag is flipped before Bot persists the real answer, reloading
  a streamed conversation overwrites the real answer with the placeholder.**
- **Capability precondition:** Bot `/v1/agents` must publish
  `capabilities.streaming=true` on each exact agent descriptor before Web may
  advertise that stream. Missing, false, stale, absent, or mismatched descriptors
  fail closed even when the local flags are on. Chat requires only the stream
  gates; forced Expert Knowledge and Brief Gene additionally require
  `bot.expert_enabled=true`. Web Go validates the matching descriptor again at
  SSE request admission, before opening `/v1/chat/completions`, so a direct
  authenticated caller cannot bypass browser negotiation. No other Expert or
  async agent streams.
- **Activation order:** (1) Bot ships real-answer persistence and advertises the
  verified per-agent streaming booleans; (2) deploy Web Go and confirm
  `/api/v1/bot/capabilities` exposes `stream=true` only for the intended agents;
  (3) enable `bot.expert_enabled` if forced Expert streams are intended; (4) set
  `bot.stream_enabled=true` and the frontend `VITE_STREAM_ENABLED` in lockstep;
  (5) smoke Instant Chat plus forced Expert Knowledge and Brief Gene, verify the
  Brief Gene request resolves a free-form gene id, then reload each conversation
  and confirm the accumulated answer survives. Keep unsupported descriptors and
  denied tools on the blocking/refused path during the smoke. With local stream
  flags still on, temporarily return a missing or false matching descriptor and
  verify a direct authenticated SSE request receives a non-SSE rejection without
  a Bot chat-completion call.
- **Rollback:** set `bot.stream_enabled=false` and
  `VITE_STREAM_ENABLED=false`, restart Web Go and redeploy the SPA, then repeat
  one blocking Chat and one forced Expert request. Disable `bot.expert_enabled`
  separately only when the whole Expert surface must be rolled back. No schema
  rollback is required.

### 11.3 A2UI actions (`bot.a2ui_actions_enabled`)

- **Web state:** typed A2UI surfaces and the owner/run-bound action relay are
  deployed, but the gateway flag is `false`; the disabled path returns before a
  Bot call. Submitted surfaces expire when their in-flight run is gone.
- **Bot and review preconditions:** Bot must emit the accepted catalog and
  accept the matching action contract. Web G15, the A2UI action review, owner
  checks, expiry/retry tests, and staging/live evidence must be linked in the
  acceptance record before a flag change.
- **Activation order:** (1) Bot owner returns emit/action evidence; (2) Web
  owner and security review the acceptance row; (3) ops enables
  `bot.a2ui_actions_enabled` and smoke-tests a synthetic owner/run-matched
  action. Rollback = set the flag back to `false` and restart; no schema
  rollback is needed.

### 11.4 Remote Research, Design, and Network surfaces

- **Web state:** `bot.research_enabled`, `bot.design_enabled`, and
  `bot.network_enabled` are all `false`. With a flag off, Web must not dispatch
  to Bot and the user sees the documented unavailable state.
- **Preconditions:** each surface needs its own Bot capability, resolver and
  attachment checks, permission/owner checks, bounded result/artifact evidence,
  and Bot/CI/staging/live smoke results. Do not treat the presence of a route or
  a local fixture as evidence.
- **Activation order:** enable one flag at a time after its acceptance row is
  reviewed; record the Web/Bot SHAs and operator. Rollback = disable only the
  affected flag and repeat its unavailable-state smoke check.

### 11.5 Interop capability and provenance (`bot.interop_enabled`)

- **Web state:** capability discovery is hidden/off while the flag is `false`.
  The Web boundary remains the allowlist, owner-scope, bounded-size, and
  redaction authority; the browser never calls Bot interop directly.
- **Preconditions:** security review must confirm that capability/provenance
  output excludes raw Bot envelopes, provider diagnostics, private paths,
  credentials, and cross-user data. Bot owner, CI, staging/live, and operations
  evidence must be linked before activation.
- **Activation order:** ops flips `bot.interop_enabled` only after review and
  restarts Web Go; smoke a permitted capability and a denied/owner-mismatch
  request. Rollback = set it back to `false`; retain the sanitized projection
  schema and legacy history.

### 11.6 History dual-read (`bot.history_dual_read`)

- **Web state:** the projection-first history path and legacy fallback are
  always available. `history_dual_read=false` keeps the optional Bot history
  observation path dormant.
- **Preconditions:** compare projection, legacy, and Bot history for synthetic
  owner-scoped rows; verify monotonic report revisions, non-empty report
  precedence, artifact retention, and flag rollback. RC-WEB-007 and RC-LIVE-001
  must be reviewed before enabling.
- **Activation order:** ops enables the flag for observation only and records
  the comparison window; it must not change user ownership or write raw Bot
  history into MySQL. Rollback = set it back to `false`; do not drop
  `bot_projection_json`, `bot_report_revision`, or their index.

### 11.7 Resumable biological uploads (`bot.resumable_upload_enabled`)

- **Web state:** the control/data-plane client and five-state UI are deployed,
  but the switch is `false`. The current checkout still contains legacy
  multipart relay code; the source-boundary checker therefore remains a
  deliberate pre-cutover diagnostic and must not be treated as a pass.
- **Bot preconditions:** the Bot owner must return a clean SHA and receipt for
  `obs-multipart-v2` v2, durable upload state, Huawei OBS ownership, bounded
  part streaming, cleanup, owner-scoped AssetResolver/Agent wiring, capability
  revocation, redaction, and no Web/Go cloud credentials. The receipt must
  separately identify development, staging, and production evidence; an
  unexecuted 10 GiB case is `Needs Verification`.
- **Web preconditions:** the Web full gate passes; capability negotiation
  returns `upload.enabled=false` until every Bot/origin condition is true; the
  browser matrix covers queued, uploading, paused, failed, and completed at
  `320`, `390`, `480`, `768`, `1024`, `1366`, `1920`, and `2560` CSS pixels in
  both themes. Synthetic screenshots are not live storage acceptance.
- **Activation order:** (1) deploy the accepted Bot data plane; (2) deploy Web
  with the switch off and the exact browser-reachable `upload_public_origin`;
  (3) verify `/api/v1/bot/capabilities` exposes only the bounded manifest and
  no credentials; (4) enable `bot.resumable_upload_enabled` and restart Web;
  (5) smoke one small file and generated biological fixtures, then exercise
  interruption/resume, capability renewal, cancel, cross-user denial, and
  Agent resolution. Do not enable this flag while the Bot receipt or boundary
  checker is pending.
- **Rollback:** set the switch to `false`, restart Web, and preserve the
  failed evidence. Do not silently fall back to a body relay after the breaking
  cutover; a full release rollback is a separately reviewed operation and must
  retain additive Bot persistence. Never delete completed assets as part of a
  flag rollback.

### 11.8 Shared evidence and deployment boundary

The 0.1.3 projection migration is a deployment prerequisite, not an activation
gate. Run `go run main.go migrate add-bot-projection` before new binary traffic
as documented in [`upgrading.md`](upgrading.md). The local
`validate_web_local.sh` G13–G17 result cannot substitute for Bot-owner,
operations, staging, or live acceptance. Keep all flags false on the initial
deploy unless a separately authorized acceptance packet says otherwise.

### 11.9 Canonical agent names and local verification

The Bot `/v1/agents` registry is the source of truth for the English tool names
used by `tool_names`, Web Go, persisted projections, and the frontend. The
current registry is:

| Slug          | Canonical tool name     |
| ------------- | ----------------------- |
| `chat`        | `ChatAgent`             |
| `knowledge`   | `KnowledgeAgent`        |
| `data`        | `DataAgent`             |
| `review`      | `ReviewAgent`           |
| `brief_gene`  | `BriefGeneAgent`        |
| `analyst`     | `AnalystAgent`          |
| `deep_genome` | `DeepGenomeAgent`       |
| `research`    | `InSilicoResearchAgent` |
| `design`      | `DigitalDesignAgent`    |
| `network`     | `GeneNetworkAgent`      |

The one-time clean-break migrations are idempotent and must run before the Go
binary and frontend are switched together:

```bash
go run main.go migrate rename-tool-names
go run main.go migrate backfill-agent-tool-names
```

Before a development smoke test, inspect rather than blindly re-seed the local
database. It must contain one row for each canonical name and no legacy alias;
the `user_tool_names` grants remain an explicit product permission decision and
must not be bulk-granted merely to satisfy this check. Production operators
must run the migrations against a verified backup and follow the rollback
procedure for the deployed release. Never apply these statements to production
from a developer workstation.

## 12. Extended Research input rollout

This rollout does not add a hidden switch, cohort, path field, or description
field. Every user already authorized for Research uses the same ordinary query
and Attach action. Protocol compatibility is the mixed-version safety boundary.

After the operator storage/proxy preflight completes, Bot deployment must
complete before Web deployment. The Bot must advertise
`research_input_resolution_v1` version `1` with compatible query, attachment,
path, reference, and scientific-format limits. Web then consumes that contract
and fails Research closed when it is absent or incompatible; it never silently
falls back to a smaller query limit.

Production widening of `question_agent_logs.query` and
`question_agent_logs.answer` to `MEDIUMTEXT`, plus any reverse-proxy request-body
adjustment, follows the separately transferred operator handoff. Operators own
the backup, lock/performance assessment, execution, verification, rollout
observation, and rollback. Repository code and local gates do not execute or
prove those production actions.

Deploy and smoke in this order:

1. Verify the widened columns and proxy allowance using sanitized evidence.
2. Deploy Bot and verify the versioned capability without exposing private
   paths, document text, credentials, or resolver internals.
3. Deploy Web and exercise the supported Research submission forms with a
   non-production account.
4. Record Bot, Web, staging, and operations results independently; a local Web
   pass is not paired-runtime or production acceptance.

On rollback, revert Web before Bot so the active Web never depends on a missing
protocol. Keep both widened columns and the larger safe proxy allowance; do not
delete uploads, Research runs, or user history.
