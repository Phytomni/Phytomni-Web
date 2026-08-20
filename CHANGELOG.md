# Changelog

All notable changes to **Phytomni-Web** are recorded here. Versions are dated
snapshots of `main`; each entry maps to one or more commits landed in that
window. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/)
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).
Newest first.

> **Conventions.** `apps/web` = Vue/Vite frontend, `apps/server` = Go gateway.
> Emojis mirror the commit subjects. "Behavior-preserving" = pure rename/move
> with no runtime contract change. "Dark-launched" = code shipped behind a
> default-OFF flag, byte-identical to prior behavior until an operator flips it.

## [Unreleased]

### 🐛 Instant Chat copy is no longer empty

- Copy on Instant ChatAgent (and other stream-family replies) writes the
  visible Markdown from stream blocks. An empty payload reports copy failed
  instead of a successful blank clipboard.

### 🐛 Wait card follows remote completion without reload

- A running Chat wait card leaves the running state when lifecycle reports
  SUCCEEDED, FAILED, or CANCELLED, including while the tab is in the
  background.
- Fan-out children (Design, Research) show on the wait card, including
  destined-to-fail rows.

### 🐛 Wait card keeps elapsed progress after reload

- Reopening a running wait card after login or refresh reconstructs elapsed
  time from the persisted assistant `created_at`, so the percent no longer
  restarts at 0% while the task is still running.

### 🐛 Wait card current step, spinner, and agent name

- The live working-step row keeps a leading spinner in front of its number
  (`[spinner] 18. …`) and stays bold through the last step until the official
  answer replaces the wait card.
- The assistant wait card shows the known agent name above the blue bubble.
  Finished turns keep that name and drop the “This turn was answered by”
  prefix.

### 🐛 Agent preview no longer blocks neighboring clicks

- Expert agent hover cards flip above the chip when there is more room
  above, instead of sliding over the chip row and case links.
- A click that lands on the card but belongs to another chip or case
  passes through to that control.

### 🧹 Chat console and form-field Issues

- Drop the leftover `Theme initialized` boot log so a clean chat session no
  longer prints a debug object in the console.
- Give the Expert agent picker an `id` and `name` so Chrome no longer reports
  a nameless form field on `/chat`.
- An authenticated visit to `/` now replaces directly to `/chat` instead of
  bouncing through `/login`, which Chrome was marking as a skippable history
  item.

### 🔐 Default role tool grants

- `user_tool_names` defaults are now guest = Chat/Knowledge/Data, user =
  those plus Review/BriefGene, and vip_user = all ten agents. Other role
  codes are not rewritten.

### 🐛 Expert forced-agent follow-up

- An accepted Expert turn keeps the captured `selectedAgent`. A Knowledge
  (or other forced-tool) follow-up still sends `tool=<that agent>` instead
  of clearing back to Auto and hitting autonomous Expert routing.

### 🛑 Owner-initiated task cancel

- JWT owners can `POST /api/v1/async-tasks/:id/cancel`. The gateway authorizes
  the Web row, then cancels the Bot run and last-claim jobs. The browser never
  supplies a Bot run id.
- Tasks without a Bot run id cancel locally. Already-emitted tokens stay on the
  row as a cancelled draft and are not promoted to an official report.
- Succeeded, failed, timed-out, and finalizing rows return 409. A cancelled
  row is sticky against a later shared-fingerprint success snapshot.
- Composer Stop, pollable wait, dedicated agent pages, and Task Manager all
  call the same cancel API. Already-emitted tokens stay on the same assistant
  row as a cancelled draft. Leaving a dedicated page only disconnects
  transport and does not cancel the remote job.
- Persist CANCELLED even when the Bot cancel snapshot cannot be merged, and
  do not let a later Query persist overlay a cancelled owner row.
- Expert Knowledge and BriefGene streams omit Instant conversation envelopes
  so Bot can mint a run that owner cancel can stop.
- After an owner row exists, Stop does not abort the in-flight Query. That
  lets DeepGenome finish minting its Bot run so cancel can settle
  `cancelled` instead of request-abort `failed`.

### 🧬 Research input resolution

- Research submissions retain one query and one Attach action while accepting
  uploaded assets or pasted dataset paths; no path or description input is
  added, and the complete user text remains available to the Bot-owned resolver.
- The Web query default is 131,072 Unicode code points with a 1,048,576 hard
  maximum. Version 1 of `research_input_resolution_v1` negotiates the effective
  limits: 64 attachments, 64 pasted dataset paths, and 128 combined references
  by default, each with a 256 hard maximum. No layer silently truncates or adds
  a new rollout cohort.
- Fresh schemas declare `question_agent_logs.query` and `answer` as
  `MEDIUMTEXT`. Production widening and proxy allowance remain operator-owned;
  deploy the compatible Bot before Web and keep widened columns on rollback.
- Local Web gates cover repository behavior only. Bot delivery, production DDL,
  proxy configuration, paired runtime, staging, and production acceptance
  remain independently verified external work.

### 🧪 Frontend toolchain contract reconciliation

- Keep Vitest 4 coverage auto-update disabled through its supported
  `coverage.thresholds.autoUpdate` option, align the Vite 8 checkpoint evidence,
  and make TypeScript reverse probes independent of incremental build state.
- Close the final Vite 8 contract gaps by removing the transitional Sass option,
  reconciling the exact coverage inventory, hardening warning-oracle mode lookup,
  and stabilizing upgraded Vue test fixtures without changing thresholds.

## [0.1.4] — 2026-07-24 (release candidate)

Quality and compatibility follow-up on the `0.1.3` Web/Bot contract. The
release keeps all new Bot-facing capabilities dark-launched and does not claim
Bot, operations, staging, or production acceptance.

### 🛡️ Quality gates and CI governance

- Static-analysis governance now closes the exact registry with zero temporary
  records while retaining target-level evidence and fail-closed reconciliation.
- The complete local gate covers the read-only frontend and Go checks,
  repository policy checks, G13 i18n, G14 visual, G15 A2UI, G16 Bot/Web
  compatibility, and G17 activation evidence.
- Node 26, Python 3.12, and the repository quality runners are aligned without
  changing application coverage behavior; coverage G12 is unchanged, and Bot, operations, and deployment code remain outside this scope.
- The frontend now uses the direct Vite `8.1.5` toolchain with Vitest `4.1.10`,
  TypeScript `6.0.3`, vue-tsc `3.3.8`, ESLint `10.7.0`, and Prettier `3.9.6`.
  The explicit browser floor is Chrome/Edge 111, Firefox 114, and Safari 16.4.
- Build, test, and coverage release evidence runs through the warning oracle;
  raw frontend commands remain diagnostic-only. TypeScript 7 remains a
  documented compatibility boundary until a stable typescript-eslint peer
  release supports it and the complete gate passes.

### 🔗 Bot compatibility and chat continuity

- Native Bot responses normalize a compatible top-level `id` to the Web
  `run_id` contract while rejecting conflicting identities.
- Failed or ambiguous new-chat submissions retain temporary dialogue identity
  until an authoritative Web dialogue id is returned.
- Typed Bot upstream failures preserve 504 timeouts, map other upstream 5xx
  responses to safe 502 errors, and keep genuine Web failures at 500.
- Server-derived permissions now constrain Expert routing, while Instant keeps
  the ChatAgent-only contract and dedicated Research, Design, and Network
  product runs use their own authenticated endpoint.
- Expert selection is kept across rejection, abort, timeout, and uncertain
  transport outcomes, then cleared only after an accepted turn.
- All eight Bot/Web acceptance rows remain **External Pending** and all new
  capability flags remain default-off.

### 🎨 Frontend visual evidence

- Chat visual refinement and the current release candidate were captured with
  the deterministic fixture harness; the human-reviewed package covers desktop
  light/dark, mobile drawer states, and wide desktop geometry.
- Local production-preview self-review now covers login, public legal pages,
  lazy Chinese locale loading, light/dark Chat fixture shells, and the mobile
  drawer. Real authenticated Chat, 200% zoom, and forced-colors remain
  explicitly `Needs Verification` pending owner-provided evidence.

---

## [0.1.3] — 2026-07-18

Release candidate for the production-facing Web merge on top of the `0.1.2`
stack. The release keeps existing blocking chat, ownership checks, and legacy
history behavior available while adding compatibility infrastructure and a
converged frontend experience. **All new Bot-facing capabilities remain
default-off; local evidence is not external acceptance.** **Ops upgrade
runbook:** [`docs/deployment/upgrading.md`](docs/deployment/upgrading.md).

### 🎨 Frontend experience and accessibility

- Workspace, chat, agent, research, artifact, authentication, legal, and
  responsive surfaces converge on the current shell and visual tokens, with
  keyboard/forced-colors behavior and localized display copy covered by the
  frontend contracts.
- Chat lifecycle, upload/download progress, history, artifacts, citations,
  and remote-agent surfaces preserve per-dialogue ownership and safe markdown
  rendering while G14 visual evidence remains a local gate.

### ✨ A2UI lifecycle and action safety (dark-launched OFF)

- Typed A2UI surfaces and action relay support bounded forms, choices, expiry,
  owner/run matching, retry limits, and lifecycle cleanup without exposing raw
  agent HTML or payloads.
- `bot.a2ui_actions_enabled` remains `false`; G15 proves Web activation
  readiness only and does not authorize a Bot or production flag change.

### 🔗 Bot HEAD compatibility and report projections

- Bot umbrella `run_id` is separated from OpenAI completion ids and child task
  ids; Web persists the canonical run identity for polling, history joins, and
  A2UI ownership.
- Sanitized, bounded, revisioned Bot projections use compare-and-swap
  persistence. Newer non-empty reports win while legacy answer/status/artifact
  columns remain readable for fallback and rollback.
- History fallback/dual-read, canonical agent parity, remote Research/Design/
  Network request shaping, Expert/AG-UI compatibility, and artifact ownership
  boundaries are covered by the Web contract. `history_dual_read` remains
  disabled until the matching acceptance record exists.

### 🧭 Interop, provenance, and security boundaries (dark-launched OFF)

- Capability and provenance discovery is Web-owned, allowlisted, owner-scoped,
  bounded, and redacted; raw Bot envelopes, private paths, provider traces,
  credentials, and cross-user rows remain unavailable to the browser.
- `bot.interop_enabled`, `research_enabled`, `design_enabled`, and
  `network_enabled` remain `false` pending security review and Bot/operations
  acceptance. G16 records local compatibility evidence; it is not live proof.

### 🧪 Release gates and deployment prerequisite

- The local release gate now records G14 frontend visual, G15 A2UI readiness,
  G16 Bot/Web compatibility, and G17 activation-evidence checks in addition to
  the existing G13 i18n gate.
- Before 0.1.3 traffic, operators must run the additive
  `add-bot-projection` migration for `bot_projection_json`,
  `bot_report_revision`, and `idx_question_agent_logs_bot_report_revision`.
  The migration preserves legacy columns and is documented in the active
  upgrade runbook.
- Bot-owner review, Bot CI, staging/live smoke evidence, and operations sign-off
  remain **External Pending**. `expert_enabled`, `stream_enabled`,
  `a2ui_actions_enabled`, `interop_enabled`, the remote-agent flags, and
  `history_dual_read` stay off for the initial deploy.

## [0.1.2] — 2026-07-06

Feature + hardening release on top of the `0.1.1` layout. Adds Instant/Expert
chat modes (dark), an AG-UI SSE streaming spine (dark), a shared citation
subsystem, backend i18n unification with a hardcoded-copy gate, a security-boundary
sweep, the gene-example obsfs migration, and backend infrastructure hardening.
**Two operator actions are required at deploy** (both operator-only, invisible to
the local gate): the `tool_names` permission-key data migration and — only when
activating Expert — the additive `mode` column. Everything else is additive or
dark-launched. **Historical ops upgrade runbook:**
[`docs/deployment/history/upgrade-0.1.1-to-0.1.2.md`](docs/deployment/history/upgrade-0.1.1-to-0.1.2.md).

### 🌐 i18n unification (single-language policy, enforced)

- **Backend user-facing strings routed through `gin-contrib/i18n`** — API
  messages, `gin.H` bodies, and error passthroughs resolve against
  `common/i18n/locales/{zh-CN,en-US}.toml`; a boundary translator (`TMaybe`)
  handles error-passthrough surfaces without touching auth decisions.
- **Vue template Chinese moved into i18n keys**; `ElMessage` toasts routed
  through `t('key')`; backend `zh` punctuation normalized to full-width.
- **G13 hardcoded-copy scanner locked to strict mode** with a ratcheting
  allowlist; frontend key-parity + reference-resolvability gate (vitest) and
  TOML bundle key-parity gate (`go test`) added. The documented kept-Chinese
  allow-list (`zh-CN` locale values, the ICP filing id, the `中文` toggle, agent
  names, a few legacy markers) is unchanged.
- Frontend i18n copy revised and orphaned keys pruned.

### 🔥 Removed — external server-task surface

- **Server-task HTTP surface removed** — `POST /api/v1/server/tasks` /
  `PATCH /api/v1/server/tasks/:id` and their `/v1/nky/server/{create,update}_task`
  aliases, plus the `ServerCreateTask`/`ServerUpdateTask` handler & service, are
  deleted. They had no real external caller (external clients call the Bot, not
  Go; task status is driven by the `SyncBotRuns` cron over `question_agent_logs`).
  The `server_tool_logs` table and `model.ServerToolLogs` are **kept** (historical
  rows preserved). Ops removes the nginx `/v1/nky/server/` block on the next
  maintenance window.

### ✨ Instant / Expert chat modes (Expert dark-launched OFF)

- **Per-conversation chat mode** (`chatMode` proxy into `chatStates`) with an
  Instant/Expert selector; mode persisted on the `question_agent_logs.mode`
  column and reconstructed from history on reload. Instant is live; **Expert is
  gated behind `bot.expert_enabled` (default `false`)**.
- **Expert routes to Bot `POST /v1/query/route`** (blocking) — never streams. The
  three-way gate (handler + `QueryStream` guard + frontend `shouldStream`) is
  consistent; a disabled Expert path maps to **503** (`ErrExpertDisabled`).
- `expert_enabled` surfaced on the tool-permissions response so the SPA can show
  or disable the Expert pill.

### ✨ Citation subsystem (per-message namespace)

- **Shared `CitedAnswer` renderer** for cited agents (chat, knowledge-agent
  demo, brief-gene-agent demo); chat cited answers route through it and drop the
  old inline list.
- **`[N]` / `[N,M]` citation markers linkified** in rendered answers, scoped by
  a per-message **namespace** (`ns` prop threaded MarkdownViewer → linkifier →
  reference rows) so anchors resolve within one answer and stay clickable across
  messages. Enriched citations copy as their full bibliography, not just the
  title. DeepGenome reference ids + inline anchors namespaced per message. Print
  CSS broadened so namespaced anchors stay inline-block.

### 🌊 Chat streaming — AG-UI SSE spine (dark-launched OFF)

- **AG-UI SSE frame parser + tee accumulator** on the Go side; a `QueryStream`
  service method tee-forwards frames to the browser while accumulating the
  answer/`run_id` and persisting a `QuestionAgentLog` row at stream end. The
  gateway grows an SSE branch behind **`bot.stream_enabled` (default `false`)** —
  with the flag off, `/query` keeps the blocking ChatCompletion path unchanged.
- **Persistence equivalence** — the streamed row equals the blocking-path row
  field-for-field including the `mode` column (shared `persistQuestionLog`);
  status is grounded in the accumulator's `RunError` (→ `FAILED`), never
  hardcoded success. **SSE headers deferred** until the first frame so a
  pre-first-byte error still ships a correctly-typed JSON response.
- **Frontend**: a `useStreamMessage` composable consumes the stream with
  `fetch` + `ReadableStream`; a content-block registry + renderers drive safe
  incremental markdown. Streaming modules gated under coverage. (Frontend flag
  `VITE_STREAM_ENABLED`, default off.)
- **Security fix folded in — regex-reentrancy XSS** in inline-markdown
  resurrection stopped: emitted tags are stashed behind a private-use sentinel
  and expanded to a fixed point, so a later pass can never re-scan an earlier
  pass's `<a href>`. Guards all three `processInlineMarkdown` callers. Removed
  the unused prior streaming client path.

### 🔒 Security-boundary sweep

- **Gene-example upload filenames hardened** — `CleanUploadFilename` +
  `SafeJoinUploadPath` reject traversal; boundaries test-locked.
- **Legacy email download links disabled** — the unauthenticated email route
  returns a stable **410 Gone**; authenticated relay downloads intact.
- **Chat downloads signed on click** (short-lived URL minted at click, not
  embedded); the direct-download path removed.
- **Analyst sync errors made explicit** — an unsyncable row without `bot_run_id`
  returns **409** (`ErrMissingBotRunID`); a blank `task_id` returns **400**
  before the service runs.

### 🧬 Gene-example serving — obsfs mount

- **Gene list + detail markdown + example images now read from the obsfs FUSE
  mount** (`gene_obsfs_path`), a self-contained Web model that avoids the Bot
  relay's tenant-prefix `403`; the Bot relay remains a fallback when the mount
  path is empty. Gene detail images render from backend URLs.
- **New public endpoint `GET /api/v1/gene-images/:gene/:file`** (obsfs-backed);
  the traversal gate is mutation-proof test-locked. Orphan gene-example upload
  path dropped; 12 hardcoded demo images removed.

### ✨ Backend infrastructure hardening

- **Cron scheduler hardened** — both reconcilers wrapped with
  `WithChain(Recover, SkipIfStillRunning)` so the GA/token-refresh jobs survive a
  panic and never re-enter concurrently; the scheduler handle is retained behind
  a mutex and exposed read-only via a new admin-gated
  **`GET /api/v1/admin/cron-entries`** (mirrors the operation-log admin gate).
- **JWT verification pinned to HS256** via a keyfunc alg-check (golang-jwt v3
  lacks `WithValidMethods`), blocking alg-confusion downgrades. The IatSkew
  revocation arithmetic is untouched.
- **12-factor secret injection** — `PHYTOMNI_JWT_SECRET` (via `viper.BindEnv`),
  `PHYTOMNI_DB_DSN`, and `PHYTOMNI_REDIS_PASSWORD` (via explicit `os.Getenv`,
  since `UnmarshalKey` bypasses `BindEnv`) override the file values when set;
  **env unset ⇒ file value wins ⇒ prior behavior byte-identical**.
- **Auth-path revocation reads pipelined** — `AuthMiddleware` folds the blocklist
  `Exists` + per-user epoch `Get` into a single Redis round-trip
  (`CheckRevocation`), fail-open **per field** (pipeline error / nil client ⇒
  not-revoked; epoch miss is a normal miss, not a degrade).
- **Redis connection-pool knobs exposed** — `pool_size` / `min_idle_conns` in the
  redis client config (zero ⇒ go-redis defaults).

### 📝 Docs

- **Deployment docs updated for the obsfs config**; dead constants pruned;
  `app.yml.example` documents the `PHYTOMNI_*` env overrides, redis pool knobs,
  `gene_obsfs_path`, and the `expert_enabled` / `stream_enabled` dark-launch flags.
- **Operator runbook — `tool_names` permission-key migration.** The frontend
  permission identifiers were translated to English; they are matched verbatim
  against the backend `permission_list` (built from `tool_names`), so the
  frontend and an 8-row `tool_names` `UPDATE` **must ship together** or every
  permission-gated nav/admin item silently disappears. Full SQL is in the
  [`upgrading.md`](docs/deployment/upgrading.md) §3.1
  and durably in the migrating commit body.

---

## [0.1.1] — 2026-06-27

Infrastructure release: repository re-layout, the RESTful `/api/v1` sweep, the
Redis subsystem, auth/registration hardening, external-dependency cleanup, and
chat UX. Delivered on the `chore/repo-reorg` branch relative to the prior `main`
tip (`520c97a`). **Requires a coordinated operator cutover** — DB/table rename,
port move, and a frontend+backend co-deploy; see
[`docs/deployment/history/repo-reorg-cutover.md`](docs/deployment/history/repo-reorg-cutover.md).

### 📁 Repository layout & naming (behavior-preserving)

- **Subprojects moved under `apps/`** — `chat-ai/` → `apps/web/`,
  `nky_client_go/` → `apps/server/`. Top-level dirs gone.
- **Go module renamed** `nky_client_go` → `phytomni-server`; **npm package
  name** aligned to `phytomni-web`.
- **DB connection registry key** `nky_client_go` → `phytomni-server`.
- **Default ports moved** — Go `:8082` → `:8080`; Vite dev `80` → `5173`.
- **DB name in DSN** `nongke` → `phytomni`.
- **GORM model types dropped the `S`/`s_` prefix and pluralized** — `SUser` →
  `User` (table `s_user` → `users`), `SQuestionAgentLog` → `QuestionAgentLog`
  (table `s_question_agent_logs` → `question_agent_logs`), and 9 more (11 total;
  full mapping in the deployment manual §5).
- **Handler/service method names dropped the `Api` prefix** (`ApiLogin` →
  `Login`, `ApiQuery` → `Query`, …); **response envelope consolidated** onto
  `common` (dead duplicate removed).
- **Server-local middleware package renamed** `middleware` → `httpmw`; **FreshGA
  cron file renamed** to `task_reconciler.go`; **gene/auth handler files** given
  honest names; **router handler groups** named by purpose.
- **Frontend task-manager API module consolidated** into `api/task.ts`.
- **Stale `chat-ai` codename** swept from code comments; **dead
  `ApiQueryList`/index/user-info handlers** deleted.
- `.gitignore` consolidated and pruned (root + apps/web); dead rules removed,
  grouped by concern.

### 🔀 RESTful API — `/api/v1` (breaking, frontend-coordinated)

- **All business API moved under RESTful `/api/v1`** with verb-on-resource
  semantics. Auth: `POST /auth/sessions`, `POST /auth/registrations`.
  Conversations: `POST /conversations`, `POST /conversations/:id/messages`,
  `PATCH /conversations/:id`, `POST /conversations/:id/{reaction,favorite}`.
  Users/permissions/async-tasks/operation-logs/genes/downloads all relocated —
  authoritative list in [`apps/server/API_DOC.md`](apps/server/API_DOC.md).
- **Two cross-boundary old aliases retained** (operator removes after
  backport): `POST /query/analyst/update_log` (Bot writeback) and
  `/v1/nky/server/*` (external server client).
- **Frontend dev proxy + API docs refreshed**; two missed frontend wrappers
  fixed in the `/api/v1` sweep; open-route wiring locked with tests.

### ✨ Auth & registration hardening

- **Server-side logout + token revocation** — `POST /api/v1/auth/logout`
  (single device) and `/api/v1/auth/logout-all` (all devices via per-user
  epoch bump). JWTs stamped with `iat`; revocation enforced in `AuthMiddleware`
  via Redis blocklist + per-user epoch + `password_change_at` floor.
- **Password-change re-login lockout window closed** — epoch bump on every
  password change prevents a just-changed user from being locked out.
- **Unique email enforced at the DB** (UNIQUE index on `users.email`); a
  pre-migration reports duplicates so ops can reconcile before the index lands.
- **Durable per-IP register flood floor** over `user_operation_logs` (precise
  IP equality, fail-closed); distinct 503 message for register-floor backend
  errors; `chat_limit` backfilled for existing users before enforcement.
- **ChatLimit gate at `/query`** (dark-launched **OFF** by default;
  `chatlimit.enforce`); bypass for `admin`/`super_admin`/`vip_user`; fail-open
  on DB error. Self-registered users (`chat_limit=0`) are inactive until an
  admin grants quota.

### ✨ Redis subsystem (fail-open throughout)

- **Redis user/product layer activated at boot** (`redis.enabled` default
  `true`); cheap `Available()` health check; fail-open observability counter
  and rate-limited WARN; `/readyz` reports Redis status and fail-open count.
  miniredis test harness added.
- **Token revocation primitives** (blocklist + per-user epoch); revocation
  Redis ops bounded with an **80 ms timeout**.
- **Rate limiting / anti-abuse** — fail-open Redis fixed-window `Allow`
  primitive; per-IP `/auth/sessions` + `/auth/registrations`, per-user
  `/query`; `ratelimit_blocked` exposed on `/readyz`. Master switch default
  **OFF** (dark launch); Redis down ⇒ always allow (auth never degrades).
- **OBS listing cache** — fail-open Redis cache for gene-download listing
  (`cache.GetObsKeys`/`PutObsKeys`, 80 ms timeout); `obscache.enabled` default
  ON; `obs_cache_hit` on `/readyz`. Cache boundary = security boundary
  (ownership checked outside/before cache; only raw keys cached, never signed
  URLs; only `SUCCEEDED` + non-empty).

### 🗑️ Dead code & external-dependency cleanup

- **Sentry error-reporting wiring stripped** (inert; `gin-contrib/sentry-go`
  dropped).
- **Dead SMTP email package removed** (`common/email/email_send.go` had zero
  importers; `jordan-wright/email` dropped). ⚠️ the `email:` block in
  `app.yml.example` is now **orphan config** (no consumer) — see deployment
  manual §4.
- **Dead gin-cache Redis store + unused outbound HTTP helpers removed.**
- **Huawei IAM/EIHealth direct connect retired** — `huaweiIAMAuthBody` /
  `huaweiEIHealthJobsBase` and the FreshGA IAM poll removed; all async
  reconciliation now goes through the Bot run API (`SyncBotRuns`). The
  `huawei:` block is dead config on the Web side.
- **Self-hosted avatars** off `cube.elemecdn` demo CDN (last live external
  dependency besides Bot/MySQL); dead env config + commented logo markup
  dropped.

### 💄 Chat UX & agent naming

- **Canonical agent names** — `BriefReviewAgent` surface renamed to
  `BriefGeneAgent` (zero residue); `CanonicalAgentTool` SSOT pins the Bot
  `{slug: tool}` map; gateway maps + document formatter + render-switches
  converged; store fallback fixed. Migration adds `rename-tool-names` +
  `backfill-agent-tool-names` (idempotent).
- **Relay timeout → 504** with a specific user-facing message; frontend shows
  the specific message on 504.
- **Perceived send progress** — half-life pseudo-progress model
  (`agentProgress.ts`); `SendProgress.vue` (ETA text + pseudo bar, per-agent
  config); per-dialogue progress state wired into `chatStates`; progress
  rendered into the sending bubble.
- **Mention Enter-guard** made testable + non-circular; send-on-Enter after
  an `@mention` fully selected fixed; **aria-labels** on composer
  send/upload/abort buttons.

### ♻️ Frontend decomposition (chat view, cont.)

The chat sidebar was further decomposed into tested composables (nav,
chat-history actions, agents dropdown, responsive collapse) and the DeepGenome
markdown parser extracted into a tested module. Backend `register`/`user`/
`agent_task` files split by responsibility (permission handlers, user-credential
methods, EIHealth/Bot reconcilers).

### 🔒 Security fixes

- **Stop serializing the password hash** in `UserResponse`.
- **Escape analyst-log content before `v-html`** in the chat view.

### 🧪 Tests

- Coverage gated on the fully-tested P1 composables/utils; `useSelectChat`
  capture-safety locked against mid-fetch chat switch; agents-panel
  scroll-debounce + tooltip fallback covered; RESTful open-route wiring
  locked; migrate idempotent second-run error captured in rename test.
- Go: revocation end-to-end through the real router; ChatLimit gate; register
  floor; ratelimit integration; unique-email migration; agent-canonical drift
  guard; 504 mapping.

### 📝 Docs

- **`main` → `repo-reorg` deployment & upgrade manual added**
  ([`docs/deployment/history/repo-reorg-cutover.md`](docs/deployment/history/repo-reorg-cutover.md)):
  DB/table rename, port move, `/api/v1` nginx location, Redis blocks, cutover
  order, rollback. Agent-naming convergence operator runbook added; API docs
  refreshed for `/api/v1`.

---

## [0.1.0] — 2026-06-16

Frontend chat-view decomposition baseline plus dead-code and early-security
hardening — the groundwork the `0.1.1` infrastructure release built on. No
operator action; behavior-compatible.

### ♻️ Frontend decomposition (chat view split)

The monolithic chat view was decomposed into tested composables / co-located
modules: `useChatStates`, `useSelectChat`, `useSendMessage`, `useRefreshMessage`,
`useFileUpload`, `useCopyDownload`, `useReactions`, `useAgentImages`,
`useAgentsPanel`, `useComposer`, `useLogView`, `useTutorial`, `useImageZoomPan`,
plus a sidebar chat-history date-grouping composable. DeepGenome split into
`useDeepGenomeDownloads`, image viewer, table-of-contents, and tested
`@/utils/{markdown-inline,reference-renderer,citation}` modules. Tutorial keydown
leak fixed on unmount; `/undefined/` asset path guarded when `.env.production`
missing; util filenames normalized to kebab-case.

### 🔥 Dead-code removal

- **Unreferenced scaffold + dead fork components** deleted; the **Pinia counter
  demo store** dropped; the commented-out legacy `ApiQueryList` query and dead
  `index`/`user-info` handlers removed; orphaned imports/comments from the
  decomposition swept.

### 🔒 Security fixes

- **Escape image-caption markdown before `v-html`** in `DeepGenomeResultViewer`.

### 🧪 Tests

- Analyst image fallback-listing containment path covered; `useSelectChat`
  capture safety locked against a mid-fetch chat switch.

---

### Verification

Local gate `./scripts/validate_web_local.sh` (13 G-checks: gofmt, go vet, go
build, `go test ./...`, vue-tsc, vite build, eslint, vitest coverage, secret
scan, SET_LOGIN_STATUS invariant, G13 i18n hardcoded-copy scanner) is green at
the `0.1.2` tip; the same gate runs in CI on every PR and push to `main`.
