# Changelog

All notable changes to **Phytomni-Web** are recorded here. This entry covers the
`chore/repo-reorg` branch (137 commits, `2026-06-16` → `2026-06-27`) relative to
`main` (`520c97a`). The format groups changes by concern; each bullet maps to one
or more commits on the branch.

> **Conventions.** `apps/web` = Vue/Vite frontend, `apps/server` = Go gateway.
> Emojis mirror the commit subjects. "Behavior-preserving" = pure rename/move
> with no runtime contract change.

---

## 📁 Repository layout & naming (behavior-preserving)

- **Subprojects moved under `apps/`** — `chat-ai/` → `apps/web/`,
  `nky_client_go/` → `apps/server/`. Top-level dirs gone.
- **Go module renamed** `nky_client_go` → `phytomni-server`; **npm package
  name** aligned to `phytomni-web`.
- **DB connection registry key** `nky_client_go` → `phytomni-server`.
- **Default ports moved** — Go `:8082` → `:8080`; Vite dev `80` → `5173`.
- **DB name in DSN** `nongke` → `phytomni`.
- **GORM model types dropped the `S`/`s_` prefix and pluralized** — `SUser` →
  `User` (table `s_user` → `users`), `SQuestionAgentLog` → `QuestionAgentLog`
  (table `s_question_agent_logs` → `question_agent_logs`), and 9 more (11 total; full
  mapping in the deployment manual §5).
- **Handler/service method names dropped the `Api` prefix** (`ApiLogin` →
  `Login`, `ApiQuery` → `Query`, …); **response envelope consolidated** onto
  `common` (dead duplicate removed).
- **Server-local middleware package renamed** `middleware` → `httpmw`; **FreshGA
  cron file renamed** to `task_reconciler.go`; **gene/auth handler files** given
  honest names; **router handler groups** named by purpose.
- **Frontend task-manager API module consolidated** into `api/task.ts`.
- **Stale `chat-ai` codename** swept from code comments; **dead
  `ApiQueryList`/index/user-info handlers + Pinia counter demo + scaffold
  components** deleted.
- `.gitignore consolidated and pruned (root + apps/web); dead rules removed, grouped by concern.

## 🔀 RESTful API — `/api/v1` (breaking, frontend-coordinated)

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

## 🔥 Removed — external server-task surface

- **Server-task HTTP surface removed** — the external task-registration routes
  `POST /api/v1/server/tasks` / `PATCH /api/v1/server/tasks/:id` and their
  `/v1/nky/server/{create,update}_task` aliases, plus the
  `ServerCreateTask`/`ServerUpdateTask` handler & service, are deleted. They had
  no real external caller (external server clients call Bot, not Go; task status
  is driven by the `SyncBotRuns` cron over `question_agent_logs`). The
  `server_tool_logs` table and `model.ServerToolLogs` are kept (historical rows
  preserved; not dropped). Ops removes the nginx `/v1/nky/server/` block on the
  next maintenance window.

## ✨ Auth & registration hardening

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
- Local-plan terms + dead test code dropped from the hardening commits.

## ✨ Redis subsystem (fail-open throughout)

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

## 🗑️ Dead code & external-dependency cleanup

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

## 💄 Chat UX & agent naming

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
  rendered into the sending bubble. (Elapsed-seconds readout later dropped;
  ETA + bar retained.)
- **Mention Enter-guard** made testable + non-circular; send-on-Enter after
  an `@mention` fully selected fixed; **aria-labels** on composer
  send/upload/abort buttons.

## ♻️ Frontend decomposition (chat view split)

The monolithic chat view was decomposed into tested composables / co-located
modules: `useChatStates`, `useSelectChat`, `useSendMessage`, `useRefreshMessage`,
`useFileUpload`, `useCopyDownload`, `useReactions`, `useAgentImages`,
`useAgentsPanel`, `useComposer`, `useLogView`, `useTutorial`, `useImageZoomPan`,
plus sidebar composables (nav, chat-history, agents dropdown, responsive
collapse, date grouping). DeepGenome split into `useDeepGenomeDownloads`,
image viewer, table-of-contents, and tested `@/utils/{markdown-inline,
reference-renderer,citation}` modules. Tutorial keydown leak fixed on unmount;
`/undefined/` asset path guarded when `.env.production` missing.

## 🔒 Security fixes

- **Stop serializing the password hash** in `UserResponse`.
- **Escape analyst-log content before `v-html`** in the chat view.
- **Escape image-caption markdown before `v-html`** in `DeepGenomeResultViewer`.

## 🧪 Tests

- Coverage gated on the fully-tested P1 composables/utils; `useSelectChat`
  capture-safety locked against mid-fetch chat switch; agents-panel
  scroll-debounce + tooltip fallback covered; RESTful open-route wiring
  locked; migrate idempotent second-run error captured in rename test.
- Go: revocation end-to-end through the real router; ChatLimit gate; register
  floor; ratelimit integration; unique-email migration; agent-canonical drift
  guard; 504 mapping.

## 📝 Docs

- Deployment docs synced to new layout/ports/DB name; **agent naming
  convergence operator runbook** added; API docs refreshed for `/api/v1`.

---

### Verification

Local gate `./scripts/validate_web_local.sh` (12 G-checks) is green on the
branch tip; the same gate runs in CI on PRs and pushes to `main`.
