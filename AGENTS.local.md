> Repo-local agent context for Phytomni-Web. Shared process rules are in the
> SHARED block above (from `1.phytomni/.claude/shared/`). Day-2 workflow:
> [`../.claude/shared/README.md`](../.claude/shared/README.md).
>
> 📖 **中文深度解读**:见 [.claude/reference/项目架构.md](.claude/reference/项目架构.md)
> (三项目关系/谱系见父级 [`1.phytomni/.claude/reference/项目总览.md`](../.claude/reference/项目总览.md))

## Repository shape


Polyglot monorepo with **two independently-runnable sub-projects** — there is no top-level build, test, or dependency manifest. Always `cd` into the sub-project first.

| Path | Stack | Port | Role |
|---|---|---|---|
| `apps/web/` | Vue 3 + Vite + TypeScript + Element Plus + Pinia | Vite dev (`VITE_PORT`, often 5173) | Frontend SPA |
| `apps/server/` | Go 1.23 + Gin + GORM (MySQL) + Viper | 8080 | Business/data API (`/api/v1/*`) + chat relay to Bot |

> **Layout/DB/port cutover — APPLIED in production (0.1.1).** The `phytomni` database, unprefixed-plural table names, the `phytomni-server` connection-registry key, and port 8080 are live. The one-time operator cutover (`CREATE DATABASE phytomni`, `RENAME TABLE`, live `config/app.yml` db-key + DSN + port) is done; see [`docs/deployment/history/repo-reorg-cutover.md`](docs/deployment/history/repo-reorg-cutover.md) for the historical record + rollback. The next upgrade (0.1.1→0.1.2) is [`docs/deployment/upgrading.md`](docs/deployment/upgrading.md). Go tests use in-memory SQLite with these names.

### How the services connect

The frontend talks to a single backend — the Go service on 8080 — which fronts both the business API and the chat-orchestration relay. Routing is encoded in `apps/web/vite.config.ts`:

- `/api/v1/*` → Go service on 8080 (the single proxied surface: auth, users, conversations, gene data, async tasks, downloads)
- Chat sends go through `POST /api/v1/conversations/:id/messages`, which the Go gateway **forwards to Phytomni-Bot** (sibling repo) via `apps/server/external/bot/`; it only serves real traffic when `bot.proxy_enabled` is true in `config/app.yml`. The Bot write-back alias `POST /query/analyst/update_log` is server-to-server and skips the browser dev proxy. (A dark-launched AG-UI SSE streaming path fronts the same endpoint behind two default-OFF flags — see §Chat streaming below; with the flags off this is the blocking path unchanged.)

Within this repo the Go service is the sole MySQL writer (`phytomni`): it persists/reads `QuestionAgentLog`, `ServerToolLogs`, etc. Async results sync back via `/query/analyst/update_log` and the GA cron.

The dev proxy default is `http://localhost:8080` for `/api/v1`; override via `VITE_DEV_PROXY_API` in `apps/web/.env.dev` to point at a LAN backend.

## Project Structure & Module Organization


- `apps/web/` — Vue 3 + Vite + TypeScript frontend (`src/`, `public/`, `dist/`).
- `apps/server/` — Go 1.23 Gin/GORM API service (`http/router`, `http/handler/api_handler`, `service/api_service`, `model`, `config/app.yml`).

In `apps/web/src/views/chat/`, keep per-dialogue UI state in `chatStates[dialogueId]`, not top-level refs (see §Architecture details).

## Build, Test, and Development Commands


Standard per-subproject commands:

### `apps/web/`
```bash
npm install
npm run dev               # Vite dev server (uses .env.dev)
npm run dev:prod          # Vite dev server using production env (footgun: hits prod backends)
npm run host              # Vite dev server bound to --host for LAN testing
npm run type-check        # vue-tsc --noEmit (there is no plain tsc — .vue files require vue-tsc)
npm run build             # production build into dist/
npm run lint               # footgun: eslint --fix over the WHOLE tree (auto-mutates ~80 files). Baseline = type-check + build; lint one file with `npx eslint <file> --no-fix`
npm run preview           # serves dist/ on 4173
```
Vitest is configured: `npm test` (watch), `npm run test:run`, `npm run coverage` (the G12 gate). Add specs as `.spec.ts`/`.test.ts` next to the covered module.

ESLint is warning-only **except** a scoped `no-console: error` on `src/views/login/**` + `src/permission.ts` (auth paths must never log token-bearing request/response/error objects). Adding `console.*` there fails the eslint G-check; the rest of the app uses `console` legitimately.

### `apps/server/`
The Go binary uses `urfave/cli`. `Action = commands.Serve` is the default, so `go run main.go` (no subcommand) starts the server.
```bash
go mod tidy
go run main.go                   # serve (default action) — :8080
go run main.go migrate           # run DB migrations (GORM AutoMigrate)
go run main.go test              # built-in CLI test command (commands/test.go — NOT `go test`)
go run main.go --config <path>   # override config file location (default: ./config/)
```
Config is loaded by `utils.LoadConfigInFile` via Viper. Edit `config/app.yml` for DB / Huawei OBS / EIHealth / SMTP / cron settings before first run.

### Local gates (run before pushing)

The canonical pre-PR check runs all per-subproject gates in one shot:
```bash
./scripts/validate_web_local.sh           # 13 G-checks: gofmt, go vet, go build, vue-tsc, vite build, eslint, scan_secrets, SET_LOGIN_STATUS invariant, G13 i18n hardcoded-copy scanner (strict mode), etc.
./scripts/scan_secrets.py --staged        # pre-commit secret scan (auto-installed below)
./scripts/install_git_hooks.sh            # first-time setup: install pre-commit hook + git config
```
The same `validate_web_local.sh` runs in CI (`.github/workflows/ci.yml`) on every PR and push to `main`, so a local pass = a likely-green CI.

## Testing Guidelines


- apps/web uses **vitest** (`npm run coverage` is the G12 gate). Also validate with `npm run type-check` and `npm run build`.
- The Go project has both a CLI `test` subcommand (`go run main.go test`) and a real `go test ./...` suite (`*_test.go` under `external/bot/`, `service/api_service/`, `middleware/`, `db/`, `commands/`, `http/handler/api_handler/`, `common/i18n/`, …). `go test ./...` is gated as **G7.5** — keep it green.
- Name future Go tests `*_test.go` and frontend tests `.spec.ts` or `.test.ts`. Use those conventions instead of inventing a parallel suite.
- **Go DB tests run on in-memory SQLite, never MySQL.** Open `glebarez/sqlite` (pure-Go, already a dep) and **hand-write a minimal `CREATE TABLE`** — do NOT `AutoMigrate` the GORM models (their MySQL `type:enum` tags break SQLite AutoMigrate) — then register it with `db.Set("phytomni-server", gdb)` so `model.DB(ctx)` / `model.Default()` resolve to it. Mirror `service/api_service/agent_task_test.go`'s `setupTestDB`. **Your DDL table name must match the model's real `TableName()`** — e.g. `User` → `users`, `QuestionAgentLog` → `question_agent_logs` — or the query hits "no such table". For tests that read back the async SQL-logger writes, pin `SetMaxOpenConns(1)` (each `:memory:` connection is its own DB).
- **Frontend vitest gotchas (apps/web).** `npm run test:run` runs the specs but does **not** enforce coverage thresholds — only `npm run coverage` (G12) does, so a green `test:run` can still fail the gate. When unit-testing a module that registers side-effects on import (e.g. `permission.ts` calls `router.beforeEach(...)` at load), **export the function under test** and `vi.mock("@/router", …)` to neutralize the real router + lazy route-component imports. A spy referenced **eagerly** inside a `vi.mock` factory (`vi.mock(p, () => ({ fn }))`) must come from `vi.hoisted()` — the `mock`-prefix naming exemption only saves **lazy** references (`() => mockFn`); an eager one hits the TDZ. Mirror `apps/web/tests/unit/permission.spec.ts` and `apps/web/tests/component/ForgotPassword.spec.ts`.

## Architecture details worth knowing


### apps/web — parallel chat state (the non-obvious bit)

Every dialogue is an entry in a single `chatStates` map keyed by `dialogueId`, holding `{isSending, messageInput, fileList, historyQuestion, copyVisible, copyTimeRef, logData, loadingLog, refreshingMessages}`. The top-level refs `messageInput` / `isSending` / etc. are `computed` getters/setters that proxy into `chatStates[currentChatId]`. This is what lets multiple chats send in parallel without bleeding state.

**Implication when extending the chat UI:** never add a new top-level `ref` for per-chat state — add a field to the `chatStates` record and expose it via a `computed` proxy. See `apps/web/PARALLEL_CHAT_FEATURES.md` for the full structure. State is created lazily through `getChatState(dialogueId)`.

**Transfer progress invariant:** axios upload byte progress lives in `chatStates[dialogueId].uploadTransfer`; download byte progress lives in the shared `download-transfers` Map. Do not add top-level refs for either, and do not show an upload byte bar on the stream/fetch path.

The main chat surface lives under `apps/web/src/views/chat/` (with `sidebar.vue`); other top-level views are `history/`, `profile/`, `cloud-storage/`. Router is `src/router/index.ts`, i18n strings in `src/locales/langs/{zh-CN,en-US}.ts` (`zh-CN` holds the Chinese UI display strings; code, comments, and docs are English per the single-language policy — see §Coding Style).

**i18n lazy-loading (non-obvious):** en-US is bundled eagerly (it is the `fallbackLocale`); zh-CN is deferred behind a dynamic `import()` in `src/locales/lazy.ts`. **`setLanguage(lang)` is async** (`Promise<SupportedLocales>`) — it awaits the pack before switching `locale.value`. Callers (`main.ts` boot, `LangSwitch.vue`) must `await` or `.then()` it; never call it fire-and-forget.

**Browser tab title (don't regress):** `document.title` comes from `chat.appTitle` (en `Phytomni` / zh `农科发现大模型`). Writers: `setLanguage` (after the pack loads) and `permission.ts` `beforeEachGuard`. Boot HTML (`apps/web/index.html`) uses English `Phytomni` until JS runs — never restore the old `CAAS Breeding…` string; never hardcode the title in `LangSwitch` or the guard.

**Element Plus locale (don't regress):** EP built-in copy (pagination, empty states, etc.) is driven by a root `<el-config-provider :locale="epLocale">` in `App.vue`, where `epLocale` is computed from `appStore.language` (`zh-CN` → `zh-cn`, else `en`). **`app.use(ElementPlus)` must not pass `locale`** — boot-time locale froze EP strings across language switches. Do not hand-patch EP module `globalConfig` inside `setLanguage` unless a MessageBox/teleport path is proven broken (optional hardening only then). Spreading EP locale objects into vue-i18n `messages` is legacy hygiene and does **not** drive EP components.

**Display dates (don't regress):** user-visible dates go through vue-i18n `d()` via `formatDisplayDate` (`src/locales/format-display-date.ts`) and `datetimeFormats` presets `date` | `datetime` | `timestamp` (registered in `createI18n`; local TZ — never `timeZone: "UTC"`). Keep raw ISO/`Date` in state (e.g. profile `lastLoginAt`) so LangSwitch reformats immediately; do not store preformatted display strings. Do **not** reintroduce `moment`, hardcoded `toLocaleDateString("zh-CN")` / `toLocaleString("zh-CN")`, or dayjs as a moment stand-in. Call-site presets: task-manager → `date`; history / favorites / profile → `datetime`; global-config → `timestamp`.

**Chat onboarding tour (non-obvious):** the first-run / replay tutorial is Element Plus `<el-tour>` (three steps: sidebar → empty-state agent cases → input), driven by `views/chat/composables/useTutorial.ts` (`showTutorial` / `startTutorial` / `completeTutorial` / `checkTutorialStatus`). Contracts to keep: `userStore.seen_tutorial` + `localStorage.seenTutorial`; `sessionStorage.tutorial_pending` hand-off from `change-password` after first-login password change; sidebar “Start Tutorial” replay. Do **not** reintroduce the hand-rolled overlay DOM/CSS. Step 2’s target is on the `v-if`’d empty-state cases bar — when messages exist EP may skip that step; never block chat send for a missing target. Read-only `userStore.isFirstLogin` is `login_status === "0"`; **G11** still applies — `SET_LOGIN_STATUS` writers remain only `stores/user.ts` + `views/login/index.vue`.

**Pinia action observer (non-obvious):** `stores/actionObserver.ts` is registered in `main.ts` and records **action name + error message only** on failures — never `args` (auth-redaction). Do not widen the sink payload.

The `@/` import alias maps to `apps/web/src/`.

### apps/web — Terms of Service & Privacy Policy (bilingual legal pages)

Public routes `/terms` and `/privacy` (`views/legal/index.vue`, `meta.doc` ∈ `{terms,privacy}`, `layout: "nolayout"`) render bilingual legal bodies. Source of truth is versioned Markdown under `apps/web/src/legal/` (`terms|privacy.{en-US,zh-CN}.md`) plus `LEGAL_META` in `legal/meta.ts` (`version` + `effectiveDate`). Loader: `loadLegalDoc(kind, locale)`; renderer: `renderLegalMarkdown` (escape-first subset — headings/lists/bold/links/HR only; links via `sanitizeHref`; **no new markdown npm dep**). UI chrome (`legal.*`, register checkbox labels) stays in locale packs; **do not** stuff full legal prose into `zh-CN.ts` / `en-US.ts`.

**Auth wiring:** `/terms` and `/privacy` are on `WHITELIST` but **not** on `GUEST_ONLY_PATHS` (logged-in users may open them). Login/register agreement links point at those routes; registration requires an explicit consent checkbox (client-side only in v1 — no consent-version DB column). Footer links Terms/Privacy beside the ICP filing; **ICP stays `京ICP备07026971号-9`**. Pages show an i18n draft banner until institute/legal sign-off. Operator identity in the bodies: CAAS BRI / 中国农业科学院生物技术研究所, `bri-zhbgs@caas.cn`.

**Scroll root (don't regress):** `App.vue` locks `html` / `body` / `#app` to `overflow: hidden` (chat shell). Legal pages must be their own scroll root — `.legal-page` uses `height: 100vh; overflow-y: auto` plus bottom padding so the fixed Footer does not cover the last lines. Do not rely on document/body scroll for `/terms` or `/privacy`.

**Don't regress:** keep Chinese legal bodies in `*.zh-CN.md` (G13 scans `.vue`/`.ts` only); keep improvement default-on + opt-out, user-responsible research-data sensitivity, and the research-strengthened AI disclaimer in the prose; do not add Cookie banners or Go auth changes unless explicitly scoped.

### apps/web — agent markdown renders through v-html (sanitization invariant)

`apps/web/src/components/DeepGenomeResultViewer.vue` renders deep_genome agent markdown (Bot-relayed, so attacker-influenceable via RAG / agent output) through ~13 `v-html` sinks: `processInlineMarkdown` deliberately resurrects escaped `<a>` tags into live HTML, and the reference renderer interpolates `doc.dl` / `doc.pm` / `.md` link URLs straight into `<a href>`.

**v-html sanitization invariant (don't regress):** agent-influenced content reaching any `v-html` sink must route through `@/utils/sanitize-markup` — `sanitizeAnchorAttributes` (tokenizer + attribute-NAME allow-list, scheme-checked `href`) for the resurrected `<a>`, and `sanitizeHref` (scheme allow-list + attribute escaping) for any URL interpolated into an `href`. Never go back to an `on*` denylist — HTML lets `href="x"onmouseover="y"` glue attributes with no separating space, bypassing it. Test-locked in `tests/unit/utils/sanitize-markup.spec.ts`, gated under G12.

**Regex-reentrancy guard (don't regress; local branch pending push as of 2026-07-04):** `processInlineMarkdown`'s sequential `.replace` passes stash each finished tag behind an opaque sentinel token and expand them only at the end (fixed-point loop), so a later image/citation pass can never re-scan the `<a href>` an earlier pass just produced. Without this, markdown syntax inside a resurrected href splices a tag whose `"` breaks out of the attribute into a browser-recovered `on*` handler — a real, executable XSS that the escape-first pipeline alone does NOT stop (the escaping is correct; the defect was a later pass re-entering an earlier pass's emitted HTML). Never collapse the vault back to direct emit, and never make `expandVault` single-pass (a link wrapping an image nests one token inside another). The sentinel is a Private-Use-Area char stripped on entry (forgery-resistant; a literal NUL would trip eslint `no-control-regex` and fail G2). Test-locked in `markdown-inline.spec.ts` ("regex-reentrancy XSS guard"). This guard protects all three `processInlineMarkdown` callers (`DeepGenomeResultViewer`/deep-genome-markdown, `MarkdownViewer`, and the streaming `MarkdownBlock`).

**Citation namespace gotcha:** cited-family content renders through the shared `CitedAnswer.vue` → `MarkdownViewer` → `linkifyCitations(html, ns)` chain. `linkifyCitations` with an empty `ns` is a deliberate no-op (scope gate) — a new `<CitedAnswer>` or `<DeepGenomeResultViewer>` call site that forgets `:ns` renders `[N]` as dead literal text with no error. Always pass a page-unique `:ns` (chat uses `'m' + index`; demos use static tokens).

### apps/server — layered Gin app

Layers (top → bottom): `http/router` → `http/handler/api_handler` → `service/api_service` → `model` (GORM tables) / external integrations. Cross-cutting code lives in `middleware/` (JWT, recovery, etc.), `common/` (response/request types, email, **document_format/** per-agent doc generators, **i18n** — `T(c, key, args...)` forwards TemplateData/PluralCount via `*go-i18n.LocalizeConfig` when args are present; zero-arg call sites stay unchanged; never panic on typed-nil config), `utils/` (config, validator, HTTP helpers, signers), `cron/` (Robfig cron jobs for GA and token refresh; both constructors wrapped with `WithChain(Recover, SkipIfStillRunning)` to guard the reconciler against concurrent re-entry and panic; scheduler handle retained behind a mutex for admin inspection via `Entries()`), `cache/` (Redis client — active and **fail-open**: `InitFromViper` in `main.go`, `redis.enabled` defaults to true; a Redis outage degrades features, never blocks boot or auth. Backs token revocation, rate limiting, and the OBS-listing cache; `/readyz` reports Redis state without going unready).

**gzip + SSE (don't regress):** when `http.gzip` is enabled (still **default OFF**), `server/http.go` mounts gzip with `WithExcludedPathsRegexs` for `^/api/v1/conversations/[^/]+/messages` so the chat send / AG-UI SSE path is not buffered by the gzip writer. Do not flip the default on casually, and do not drop the exclude when enabling gzip with streaming.

**DataAgent Xlsx export (don't regress):** Excel downloads use `common/document_format/xlsx.ExportTable` on `github.com/xuri/excelize/v2` (pinned v2.9.1) with **StreamWriter only** — `SetPanes` (freeze row 1) before `SetRow`, `CoordinatesToCellName` for cell refs (never `rune('A'+i)`). `data_agent.ExportToExcel` delegates; do not reintroduce `360EntSecGroup-Skylar/excelize` v1. Golden-byte tests live in `common/document_format/xlsx/`.

External integrations to watch for: **Huawei Cloud OBS** (object storage, via `huaweicloud-sdk-go-obs`), **Huawei Cloud EIHealth** (bioinformatics compute platform — async task creation/status polling), **Sentry** (error reporting via `gin-contrib/sentry-go`), SMTP email (`jordan-wright/email`), Zap structured logging.

When adding an endpoint: define model in `model/`, business logic in `service/api_service/`, handler in `http/handler/api_handler/`, route in `http/router/`. Use `rxLog.Sugar()` for logs (`rxLog` is the package alias used throughout).

**Audit-log redaction invariant (don't regress):** the Go service is the sole writer of two MySQL audit tables — `user_operation_logs` (HTTP audit, `middleware/operation_log.go`) and `sql_operation_logs` (SQL audit, `db/logger.go`). Request bodies/query strings are redacted by content-type (`redactBodyByContentType` / `redactQueryParams`; multipart dropped), and SQL is parameterized via GORM `ParameterizedQueries` (`SqlLogger.ParamsFilter` forwards to the base logger) so `sql_content` stores `?` placeholders, not literal emails/PII. Any edit to those two files must keep plaintext credentials/PII out of both tables.

**Access-control invariant (don't regress):** three server-side authorization boundaries were (re)audited into place and are easy to silently strip. (1) **Operation-log reads are admin-only** — `GET /api/v1/operation-logs` (`GetOperationLogs`, `service/api_service/operation_log.go`) resolves the JWT operator and requires `User.Code ∈ {admin, super_admin}`, returning `ErrOperationLogForbidden` → 403; an empty `user_ids` returns *all* rows, so that gate is the only thing stopping any authenticated user from dumping cross-user audit PII. Mirror the `UnlockUser` admin pattern for any new audit-table reader. (2) **Cron-entries reads are admin-only** — `GET /api/v1/admin/cron-entries` (`GetCronEntries`, `service/api_service/cron_entries.go`) mirrors the operation-log admin gate (`ErrCronEntriesForbidden` → 403); the endpoint exposes internal job timing (`Next`/`Prev` run). Test-locked in `cron_entries_test.go`. (3) **Async-task surfaces are owner-scoped** — `AsyncTaskInfo` filters `id AND user_name` (enumerable auto-increment id ⇒ no cross-user read) and `AsyncTaskList` builds the owner filter once via `Session(&gorm.Session{})` so both the `Count` and the paged `Find` inherit `user_name`; do **not** revert to reusing a bare `db` across finishers — it reads as unscoped (two audits misread it) even though `clone==0` made it work. Test-locked in `operation_log_test.go` / `async_task_info_test.go` / `async_task_list_test.go` / `cron_entries_test.go`.

**Redis-backed auth invariants (don't regress):** server-side logout (`POST /api/v1/auth/logout` / `/logout-all`) revokes JWTs via three layers — token blacklist, per-user epoch, and a `password_change_at` floor. The IatSkew comparison must stay consistent (skew subtracted on compare, real `now` written on SET — never `now+skew`). AuthMiddleware pipelines the blocklist Exists + epoch Get into a single Redis round-trip via `CheckRevocation` (`cache/revocation.go`); fail-open semantics are preserved per field (pipeline error or nil client → not-revoked; epoch miss is a normal miss, not a degrade). The old `IsBlocked`/`GetUserEpoch` functions remain for test callers. User JWTs use `github.com/golang-jwt/jwt/v5` with `Claims` on `RegisteredClaims` and HS256 pinned via `jwt.WithValidMethods` (also on download tokens); compare iat/exp through `IssuedAtUnix()` / `ExpiresAtUnix()` — do **not** reintroduce v3 or a hand-rolled keyfunc alg-pin. The IatSkew arithmetic is untouched. All rate limits (`PerIPRateLimit` on login/register, `PerUserRateLimit` on chat send) and the ChatLimit gate are **fail-open** and dark-launched (master switches default OFF); the registration floor check is the one deliberate **fail-closed** path. Test-locked under `middleware/` and `http/router/*_integration_test.go`.

**Secret env injection (don't regress):** `PHYTOMNI_JWT_SECRET` / `PHYTOMNI_DB_DSN` / `PHYTOMNI_REDIS_PASSWORD` override file config **only when non-empty**. Unset or empty env leaves `app.yml` values in place. JWT uses `applyEnvJWTSecret()` after load — do **not** reintroduce `viper.BindEnv` for `jwt.secret_key` (BindEnv treats set-empty as an override). Redis boot uses `InitFromViper` only — do not revive `InitFromViperDefault` / `NewClientDefault`.

### Chat orchestration — relayed to Phytomni-Bot

`POST /query` is no longer served in-repo. The Go gateway (`Query` handler) forwards it to **Phytomni-Bot** via the `apps/server/external/bot/` relay (client, answer-shape adapter, OBS relay). Agent logic (`ChatAgent` | `KnowledgeAgent` | `DataAgent` | `AnalystAgent` | `ReviewAgent` | `DeepGenomeAgent`), per-tool formatting, and the MCP server now live in `../Phytomni-Bot` — work on agent/tool behavior there, not here.

**`/query` error contract:** the handler maps service errors through `queryErrorStatus` (`http/handler/api_handler/query.go`) — a disabled gateway (`api_service.ErrGatewayDisabled`) → **503**, expert mode disabled (`ErrExpertDisabled`) → **503**, an unknown tool (`ErrUnknownTool`) → **400**, a Bot timeout (`rxBot.ErrBotTimeout`) → **504**, an unsyncable row without `bot_run_id` (`api_service.ErrMissingBotRunID`, shared with the analyst update-log handler) → **409**, a client-correctable Bot 4xx (`rxBot.SurfaceableMessage`, which deliberately excludes 401/403 and all 5xx) → **400** with the Bot message, everything else → **500** generic. The analyst update-log handler also rejects a blank `task_id` → **400** before the service is called. Add new client/config error states as **wrapped sentinels** (`fmt.Errorf("%w …", …)`), not plain errors, or they collapse into 500.

Async lifecycle: analyst jobs run on EIHealth; `deep_genome` runs in-process on Bot. The GA cron (`apps/server/cron/task_reconciler.go`) polls `status="RUNNING"` rows and reconciles them — EIHealth via the IAM poll, Bot runs via the run aggregate — writing results back into `QuestionAgentLog`.

**Async write-back invariant (don't regress):** `QueryAnalystUpdateLog` (`service/api_service/query.go`) and `SyncBotRuns` (`service/api_service/agent_task.go`) reconcile finished Bot runs with GORM **map** `Updates()`, which — unlike struct `Updates` — does **not** skip zero values. So they must (a) skip writing a blank `status` (an empty string strands the row out of the cron's `WHERE status='RUNNING'` poll set permanently) and (b) never clobber an existing `answer` with a blank reshape. Both guards are test-locked in `agent_task_test.go` / `query_updatelog_test.go`.

### Chat streaming (AG-UI SSE) — dark-launched, both flags OFF (local branch, pending push as of 2026-07-04)

An S1+S2 streaming spine upgrades chat from blocking to AG-UI SSE, gated behind two flags that both default OFF (`bot.stream_enabled` in `config/app.yml`, `VITE_STREAM_ENABLED` in the frontend env). **With both OFF the behavior is byte-identical to the blocking path** — the whole feature is dormant until a coordinated cutover. Architecture: Bot emits AG-UI SSE frames → the Go `Query` handler's SSE branch (`http/handler/api_handler/query.go`) → `QueryStream` service method (`service/api_service/query.go`) opens the Bot stream, tee-forwards frames to the browser while accumulating answer/`run_id`, and persists a `QuestionAgentLog` row at stream end → the Vue `useStreamMessage` composable (`views/chat/composables/`) consumes the stream with `fetch`+`ReadableStream`, pushes a placeholder message, mutates it per event, and finalizes. Rendering goes through a content-block registry (`views/chat/streaming/blockRegistry.ts` + `components/blocks/*`).

Invariants worth knowing before touching any of this (all test-locked; see `.claude/plans/2026-06-28-streaming-spine-s1s2-agui-*.md`):
- **Streaming is Instant×chat only.** `mode=expert` routes to Bot `POST /v1/query/route` (blocking, no streaming primitive) and must never stream. The three-way gate is consistent across the handler (`in.Mode != "expert"`), the `QueryStream` guard (returns the wrapped sentinel `ErrStreamUnsupported` → 400 for expert or a non-chat slug — the frontend forces `tool=""` in Expert, so `SlugFor("")→"chat"` collapse is caught on both sides), and the frontend `shouldStream` (`STREAM_CAPABLE = {ChatAgent}`). knowledge/review streaming is a Bot handoff P1; analyst/deep_genome stay async.
- **Persistence equivalence.** The streamed row equals the blocking-path row field-for-field **including the `mode` column** (`table.go`; `Mode: in.Mode`); the INSERT/refresh-two-step-UPDATE branch is shared via `persistQuestionLog` (blocking `Query` and `QueryStream` both call it — keep the row literal byte-unchanged when editing). Status is grounded in `scanner.Err()`/accumulator `RunError` (→ `"FAILED"`), never hardcoded `"SUCCEEDED"`, so a partial/failed stream can't masquerade as success or strand the row. Go tests use `setupExpertTestDB` (its DDL has the `mode` column), never `setupTestDB`.
- **run_id contract.** The persisted `bot_run_id` is the Bot run-**registry** id from `RunStarted` (not a `chatcmpl-*` id). This makes streamed chat rows overlay-matchable on reload — **before flipping `bot.stream_enabled`, Bot must persist the real accumulated answer in its run record** (not the current `"[streamed]"` placeholder), or reloading a streamed conversation overwrites the real answer. See the activation gate in `.claude/handoff/2026-06-28-agui-streaming-contract.md`.
- **SSE headers are written lazily** (only when the first frame forwards), so a pre-first-byte `QueryStream` error still ships a correctly-typed JSON response instead of a `text/event-stream`-mislabeled error body.
- **Citation ns (P1 gate).** P0 chat mounts `StreamMessage` with no `:ns` (chat emits no `phyto.references`, so `[N]` stays literal — consistent with the no-ns `MarkdownViewer` branch). Before P1 knowledge/review streaming or expanding `STREAM_CAPABLE`, resolve how a finalized blocks-bearing message renders its references (StreamMessage self-renders vs. finalize clears blocks → CitedAnswer) — otherwise references are captured-but-invisible (`useStreamMessage` sets `placeholder.doc_list`) with `[N]` as dead text. Same scope-gate footgun as the Citation namespace gotcha above.
- **Interactive agent surfaces (`phyto.a2ui`, landed on `release/0.1.3`).** Bot may emit AG-UI `Custom` `{ name: "phyto.a2ui", value: { catalog_version, surface_id, widget, props } }` with `widget ∈ {confirm,form,choice}` and `catalog_version` v1+. The reducer folds valid frames into `type: "agent-surface"` blocks (`authority: "agent"`, `interactive: true`); unknown/old catalogs are skipped without breaking the stream. Widgets render agent copy as Vue text only (no `v-html`). Actions go through a swappable transport (`a2uiAction.ts`) bound to the in-flight `run_id` via per-dialogue `a2uiRunId` / `a2uiActionSender` (cleared in stream `finally` → unsubmitted surfaces expire). Lock-on-submit; RunError stamps `failed` and does not unlock. **Bot emit + action accept are Bot-owned** (handoff `Phytomni-Bot/.cursor/handoff/2026-07-08-a2ui-contract-handoff.md`); the gateway route `POST /api/v1/conversations/:id/a2ui-actions` exists, gated by `bot.a2ui_actions_enabled` (default false → Bot-shaped stub 403 after ownership checks), requires a matching `dialogue_id` + `user_name` + `bot_run_id` row (else 404), and forwards to Bot `POST /v1/runs/{run_id}/a2ui-actions`. Without Bot emit, production chat stays identical for non-`phyto.a2ui` traffic. Do not expand into a general A2UI catalog renderer; do not touch the markdown / DeepGenome `v-html` sanitization path for this surface.

## Tooling artifacts in the repo


- **`.codegraph/`** is a code-indexing tool's working directory (contains a SQLite `codegraph.db`). Its own `.codegraph/.gitignore` excludes `*.db`, `cache/`, `*.log`, and `.dirty` hook markers, so the contents are **per-machine** and must not be committed. Don't `rm -rf .codegraph/` either — leave the directory in place; only its contents are local.

## Coding Style & Naming Conventions


- TypeScript and Vue SFCs in `apps/web/src/`; keep `@/` imports. Let ESLint + Prettier normalize frontend formatting.
- Format Go with `gofmt`; keep package names short and lowercase.
- Python follows PEP 8 and snake_case.
- **Single-language policy (enforced repo-wide, 2026-06-29):** comments, string literals, console/log, tests, docs, and config/CI/script text are **English**. Chinese is kept ONLY in: `src/locales/langs/zh-CN.ts` + `apps/server/common/i18n/locales/zh-CN.toml` values; and these documented exceptions — the 京ICP备07026971号-9 filing identifier in Vue `<template>` (`components/Footer.vue`, `views/chat/index.vue`), the `LangSwitch` `中文` toggle, the `附件` legacy marker in `views/chat/utils/message-parse.ts` (dual-parse), the agent Chinese names in `constants/agents.ts`, the `ForgotPassword.spec` zh-CN assertion, the UTF-8-decode fixture in `scripts/tests/test_scan_secrets.py`, and the bilingual legal bodies in `apps/web/src/legal/*.{zh-CN,en-US}.md` (Chinese prose lives in `*.zh-CN.md`; G13 does not scan `.md`). Do NOT reintroduce Chinese outside these surfaces; do NOT translate these surfaces. All other Vue `<template>` display copy routes through i18n `t('key')` calls, gated by G13 (`scripts/check_i18n.py`, strict mode).

## Local Project Context


Read `.codex/PROJECT_CONTEXT.md` before reconciling this repo with the production export or the core Bot repository. The cross-project overview lives at `../PROJECT_CONTEXT.md`; it explains when to trust `../project` for production web or gateway hotfixes and when to trust `../Phytomni-Bot` for MCP and agent business logic.

## Engineer Reference Materials


Also check `.codex/ENGINEER_MATERIALS.md` before large sync work. It records the extra `../frontend`, `../nky_client_go`, interface/deployment notes, and CSV template supplied by engineering. Treat documented `/root/...` paths as production-server paths only; do not test them locally or copy secrets from reference material. The same material is summarized for humans in `.cursor/docs/ENGINEER_SOURCES.md` and `.cursor/docs/DEPLOYMENT_SATELLITE_SERVICES.md`.

## Domain context


This is an **agricultural / plant-genomics knowledge platform** (`phytomni` / `nongke` = 农科, "agricultural science"). Expect biology-flavored data: species codes, gene IDs, RAG citations over scientific literature, EIHealth analysis pipelines. The `DeepGenomeAgent` (now on Phytomni-Bot) and the Go `gene/*` endpoints are the bio-specific surfaces.

## Repo Notes — Production Sync Gates

#### Repo note — Web gate commands for backport PRs

List in PR bodies:

- Go: `gofmt -l . && go vet ./... && go build` (from `apps/server/`)
- Frontend: `npm run type-check && npm run build` (from `apps/web/`)
- Full local gate: `./scripts/validate_web_local.sh`
- Secret scan: `./scripts/scan_secrets.py --staged`

Schema bumps pair `apps/server/model/table.go` with the Bot-side equivalent.
`ALTER TABLE` is documented in the PR body but executed by ops.
