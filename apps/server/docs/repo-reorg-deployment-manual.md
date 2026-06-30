# Phytomni Web — Production Deployment & Upgrade Manual (`main` → `chore/repo-reorg`)

This manual takes the **currently-deployed production stack** — which is
`main` tip (`520c97a`) — to the **`chore/repo-reorg` branch** (`90bb4ab`,
137 commits, 2026-06-16 → 2026-06-27). It is an in-place upgrade guide for
the ops team: what changed, the exact steps, the cutover order, how to verify,
how to roll back.

> **Read this first — scope correction.** The older
> [`web-production-deployment-manual.md`](web-production-deployment-manual.md)
> describes the *original* Python→Go/Bot migration (Python retirement, bcrypt,
> first-login gate, Bot wiring, OBS relay). **That migration is already live in
> production** (production runs `main`, which carries all of it). This document
> covers **only the `main` → `repo-reorg` delta** — layout/module/table/port
> renames, the `/api/v1` RESTful sweep, Redis subsystem, auth hardening, dead
> code, and chat UX. Do not re-run the Python-retirement or bcrypt steps from
> the older manual; they are done.

**Headline changes (operator must act on each):**

1. **Repo layout rename** — subprojects moved under `apps/`, Go module
   `phytomni-server`, DB registry key `phytomni-server`, ports `8082→8080` /
   Vite `80→5173`, DB name `nongke→phytomni`, **all tables `s_*` → unprefixed
   plural**. The running binary will not boot against the old config/schema.
2. **RESTful `/api/v1`** — every business endpoint moved; nginx needs a new
   `/api/v1` location; one cross-boundary old alias retained temporarily.
3. **Redis subsystem live** (token revocation, rate limit, OBS cache) —
   requires a reachable Redis; all features fail-open if Redis is down.
4. **Auth hardening** — server-side logout, unique email index, register flood
   floor, ChatLimit gate (dark-launched OFF).
5. **Dead code removed** — Sentry, SMTP email package, Huawei IAM/EIHealth
   direct connect, gin-cache store. Two **orphan config blocks** (`email:`,
   `huawei:`) remain in `app.yml.example` with no consumers — see §4.

---

## 0. Scope & conventions

**Audience.** Ops with: shell on the production host (`/root/...`), MySQL
admin, nginx admin, Redis admin, and the ability to edit `config/app.yml` and
restart the Go service.

**Wording.** This guide never uses version numbers. It says **"the current
production stack"** for what is running today (`main`) and **"this release" /
"the new build"** for `chore/repo-reorg`.

**Secrets are placeholders.** Every credential is written as a placeholder such
as `<DB_PASSWORD>`, `<PTM_WEB_KEY>`, `<JWT_SECRET>`, `<PROD_DB_HOST>`,
`<REDIS_HOST>`. Substitute real values out-of-band on the server. Never commit
real values, never paste them into tickets or logs.

**Verify-on-server markers.** Facts that live only on the production server
(not in any repo) are marked **(verify on-server)** — confirm in place.

**Companion documents.**
- [`web-production-deployment-manual.md`](web-production-deployment-manual.md) — the *original* Python→Go/Bot migration manual (already live; reference only).
- [`bot-cutover-ops-runbook.md`](bot-cutover-ops-runbook.md) — Bot key mint/rotation/staged-cutover/rollback (already done; reference only).
- [`../../CHANGELOG.md`](../../CHANGELOG.md) — full commit-level changelog for this release.

**Contents.**
1. [What changed](#1-what-changed-vs-the-current-production-stack)
2. [Target topology & ports](#2-target-topology--ports)
3. [Prerequisites & pre-flight](#3-prerequisites--pre-flight)
4. [Configuration & secrets (app.yml)](#4-configuration--secrets-appyml)
5. [Database migration](#5-database-migration)
6. [Backend deploy (Go)](#6-backend-deploy-go)
7. [nginx & frontend](#7-nginx--frontend)
8. [Cutover sequence](#8-cutover-sequence)
9. [Verification & smoke](#9-verification--smoke)
10. [Rollback](#10-rollback)
11. [Degraded mode & known gotchas](#11-degraded-mode--known-gotchas)

---

## 1. What changed vs the current production stack

| Area | Currently in production (`main`) | This release (`repo-reorg`) | Why it matters |
|---|---|---|---|
| Repo layout | `chat-ai/` + `nky_client_go/` at root | `apps/web/` + `apps/server/` | Build paths, deploy scripts, supervisor CWD all change |
| Go module | `nky_client_go` | `phytomni-server` | Binary name + import paths change; rebuild, no in-place swap |
| Go port | `:8082` | `:8080` | nginx upstream + any direct clients must repoint |
| Vite dev port | `80` | `5173` | Dev-only; production build unaffected |
| DB name | `nongke` | `phytomni` | DSN changes; `CREATE DATABASE` + data copy or `RENAME` |
| DB registry key | `nky_client_go` | `phytomni-server` | `app.yml` `db:` block key changes |
| Table names | `s_user`, `s_question_agent_logs`, … (11 tables, `s_` prefix, singular) | `users`, `question_agent_logs`, … (unprefixed, plural) | `RENAME TABLE` for each; GORM `TableName()` rewritten |
| API paths | `/auth/*`, `/v1/*`, `/query` (verb-in-path) | `/api/v1/*` RESTful + retained alias | nginx needs `/api/v1` location; frontend rebuilt |
| Redis | Commented out at boot; cache package present but inert | Activated (`redis.enabled` default true); revocation + ratelimit + OBS cache | Requires reachable Redis; all fail-open if down |
| Auth | Login only; no server logout; MD5/bcrypt lazy upgrade already live | + `POST /api/v1/auth/logout` + `/logout-all` (token revocation); unique email index; register flood floor; ChatLimit gate (OFF) | New endpoints; one-time unique-index migration; dark-launched gate |
| Sentry | Wired (inert) | Removed | Drop dep; no config action |
| SMTP email package | Present (dead — zero importers) | Removed | `email:` config block now orphan (§4) |
| Huawei IAM/EIHealth | Direct connect in FreshGA cron | Removed; all async via Bot `SyncBotRuns` | `huawei:` config block now orphan (§4); Web holds no Huawei creds |
| Agent naming | `BriefReviewAgent` (maps to `brief_gene`) | `BriefGeneAgent` canonical; SSOT + drift guard | One-time `rename-tool-names` + `backfill` migration |
| Frontend | Monolithic chat view | Decomposed into composables; canonical render-switches; 504 message; send progress | Rebuild `dist`; behavior-compatible |
| `.gitignore` | Flat, dead rules | Consolidated, grouped, pruned | No deploy impact |

---

## 2. Target topology & ports

| Component | Port | Role |
|---|---|---|
| nginx | `:443` (TLS, `phytomni.cn`) | TLS termination + reverse proxy by path + serves the SPA |
| Go service | `:8080` (**was `:8082`**) | Serves `/api/v1/*` + retained alias `/query/analyst/update_log`. Sole MySQL writer |
| Bot | `:8000` (internal) | Unchanged — Go relays chat here; deployed by the Bot team |
| MySQL | `:3306` | **`phytomni` database** (was `nongke`) |
| Redis | `:6379` (**now required**) | Token revocation + rate limit + OBS listing cache (all fail-open) |
| Satellite: `/aiquery/*`, `/oneauth/*` | separate | Unchanged |

**Current data flow (production, `main`)**

```
                          ┌────────────────────────────────────┐
 Browser ── HTTPS ──▶ nginx│ /auth, /v1, /query ─▶ Go     :8082 │──▶ MySQL :3306 (nongke, s_* tables)
 (phytomni.cn :443)        └────────────────────────────────────┘
                                                  │ relay (Bearer <PTM_WEB_KEY>)
                                                  ▼
                                          Bot :8000 (internal)
```

**New data flow (this release)**

```
                          ┌──────────────────────────────────────────┐
 Browser ── HTTPS ──▶ nginx│ /api/v1, /query/analyst/update_log        │──▶ MySQL :3306 (phytomni, plural tables)
 (phytomni.cn :443)        │                     ─▶ Go     :8080       │──▶ Redis :6379 (revocation/ratelimit/obscache)
                          └──────────────────────────────────────────┘
                                                  │ relay (Bearer <PTM_WEB_KEY>)
                                                  ▼
                                          Bot :8000 (internal)
```

---

## 3. Prerequisites & pre-flight

Do these before touching anything mutable.

1. **Back up (mandatory, first).**
   - MySQL: `mysqldump -u <DB_USER> -p nongke > nongke_backup_$(date +%F).sql` (note: **`nongke`** is the current DB name).
   - Frontend: archive the live `dist` directory to a dated backup (§7).
   - Config: copy the current `config/app.yml` to a safe location.
   - Redis: if revocation/ratelimit state matters, `BGSAVE` + copy the RDB (state is ephemeral; losing it just means already-issued tokens stay valid until natural expiry).
2. **Toolchain on the build host.** Go 1.23; Node + npm.
3. **Redis reachable** from the Go host at `<REDIS_HOST>:6379`. If Redis is
   unavailable, the release still runs (every Redis feature fail-opens), but
   token revocation, rate limiting, and OBS caching are inert — confirm
   whether that is acceptable for your soak window.
4. **Access.** MySQL admin (with `CREATE DATABASE` / `RENAME TABLE`); shell
   access to the on-server nginx config **(verify on-server: path under
   `/root/...`)**; Redis admin.

---

## 4. Configuration & secrets (app.yml)

Copy `apps/server/config/app.yml.example` to `config/app.yml` and fill in real
values. `app.yml` is git-ignored — keep it out of VCS and not world-readable.
Below are the blocks that are **new or changed** versus the current production
config. Secrets are placeholders.

### 4.1 `db` — CHANGED (critical)

The registry key and DSN change. Current production uses key `nky_client_go`
pointing at `nongke`; this release uses key `phytomni-server` pointing at
`phytomni`:

```yaml
db:
  phytomni-server:                       # was: nky_client_go
    dialect: mysql
    dsn: "<DB_USER>:<DB_PASSWORD>@tcp(<PROD_DB_HOST>:3306)/phytomni?charset=utf8mb4&parseTime=True&loc=Local"
                                       # was: /nongke
```

The `phytomni` database must exist and contain the **renamed tables** (§5)
before the binary boots. Confirm whether MySQL is co-located (`localhost`) or
external **(verify on-server)**, and that the DSN user has the same grants it
had on `nongke`.

### 4.2 `redis` — NEW (critical)

```yaml
redis:
  enabled: true                # default true = secure path; false ⇒ all Redis features fail-open
  clients:
    web:
      addrs:
        - "<REDIS_HOST>:6379"
      db: 0
      password: <REDIS_PASSWORD>   # empty if none
      type: single-node
  default: web
```

`enabled: true` is the secure path (revocation/ratelimit/obscache active). If
Redis is down at boot, the service still starts and every Redis feature
fail-opens (a startup WARN is logged). See §11.

### 4.3 `ratelimit` — NEW (dark-launched OFF)

```yaml
ratelimit:
  enabled: false               # master switch; default OFF (dark launch)
  login:    { limit: 60, window: 60s }    # per-IP on /auth/sessions
  register: { limit: 10, window: 1h  }    # per-IP on /auth/registrations
  query:    { limit: 30, window: 60s }    # per-user on /query
```

Leave `enabled: false` for the initial deploy (zero behavior change). Flip to
`true` after soak once you confirm the limits are right for your traffic.
Redis down ⇒ always allow (auth never degrades).

### 4.4 `obscache` — NEW (default ON)

```yaml
obscache:
  enabled: true                # default ON; fail-open
  ttl: 1h
```

Benign fail-open optimization for gene-download listing. Default ON is safe;
set `false` to bypass the cache without affecting revocation/ratelimit.

### 4.5 `chatlimit` — NEW (dark-launched OFF)

```yaml
chatlimit:
  enforce: false               # default OFF; ON ⇒ self-registered users (chat_limit=0) blocked from /query
```

`enforce: false` = today's behavior (everyone can chat). Flip to `true` only
after you decide the invitation-quota model is active. Bypass for
`admin`/`super_admin`/`vip_user`; fail-open on DB error. `guest_default_chat_limit` (default 5) sets the quota for new self-registrations.

### 4.6 `bot` — CHANGED (port only)

The `bot` block is unchanged except `api_base_url` now references `:8080`:

```yaml
bot:
  base_url: "http://<BOT_HOST>:8000"     # unchanged
  user_api_key: "<PTM_WEB_KEY>"          # unchanged — reuse the existing key
  timeout_seconds: 900                   # unchanged
  proxy_enabled: true                    # unchanged
  # …rest unchanged
```

The existing `ptm_<web>` key from the Bot team is reused — do **not** mint a
new one.

### 4.7 `jwt` — unchanged

Keep `jwt.secret_key` as-is (same as the current production value). Tokens
stay valid across the flip.

### 4.8 Orphan blocks — `email:` and `huawei:` (no action, optional cleanup)

This release **removed the code** that consumed these blocks, but the blocks
remain in `app.yml.example`:

- **`email:`** — the SMTP email package (`common/email/email_send.go`) was
  deleted (zero importers). The `email:` block is now dead config. **Safe to
  leave in `app.yml`** (no consumer reads it); remove it if you want a clean
  config. No behavioral impact either way.
- **`huawei:`** — the Web side no longer talks to Huawei IAM/EIHealth directly
  (the FreshGA cron now reconciles via the Bot). The `huawei:` block is dead
  config on the Web side. **Safe to leave**; remove if you want a clean
  config. (The Bot still holds Huawei OBS credentials — that is unchanged.)

### 4.9 Other keys

- `gene_file_path` — unchanged value (`/var/lib/phytomni/gene_examples`).
- `bcrypt_cost: 10` — unchanged; the bcrypt lazy upgrade is already live.
- `app.trusted_proxies`, `http.gzip`, `http.maintenance` — optional tuning.

---

## 5. Database migration

Run after the backup in §3. The migration has **two parts**: (A) rename the
database + tables, (B) add the unique email index + run the agent-name
rename/backfill. All table renames are metadata-only (`RENAME TABLE` is
instant, online, non-blocking).

> **Table rename mapping (11 tables).** Production today uses the `s_`-prefixed
> singular names; this release expects unprefixed plural:

| Current (`main`) | This release (`repo-reorg`) |
|---|---|
| `s_user` | `users` |
| `s_tool_name` | `tool_names` |
| `s_user_tool_name` | `user_tool_names` |
| `s_question_agent_logs` | `question_agent_logs` |
| `s_gene_list` | `gene_lists` |
| `s_gene_example` | `gene_examples` |
| `s_user_permission` | `user_permissions` |
| `s_server_tool_logs` | `server_tool_logs` |
| `s_user_feedback` | `user_feedback` |
| `s_user_operation_logs` | `user_operation_logs` |
| `s_sql_operation_logs` | `sql_operation_logs` |
| *(any other `s_*` table present)* | *(drop `s_`, pluralize — verify on-server)* |

### 5.1 Rename the database

Either rename in place (fastest, keeps grants if you re-grant) or create-new +
copy. **Rename in place** is recommended:

```sql
RENAME DATABASE nongke TO phytomni;   -- MySQL 8.0+: metadata-only, instant
-- If your MySQL lacks RENAME DATABASE, use the dump/restore path:
--   mysqldump nongke > dump.sql; CREATE DATABASE phytomni; mysql phytomni < dump.sql
```

Confirm the DSN user still has grants on `phytomni` after the rename
(`GRANT ... ON phytomni.* TO ...`).

### 5.2 Rename the 11 tables

Run inside `phytomni`. Each `RENAME TABLE` is online and instant:

```sql
USE phytomni;
RENAME TABLE
  s_user                 TO users,
  s_tool_name            TO tool_names,
  s_user_tool_name       TO user_tool_names,
  s_question_agent_logs  TO question_agent_logs,
  s_gene_list            TO gene_lists,
  s_gene_example         TO gene_examples,
  s_user_permission      TO user_permissions,
  s_server_tool_logs     TO server_tool_logs,
  s_user_feedback        TO user_feedback,
  s_user_operation_logs  TO user_operation_logs,
  s_sql_operation_logs   TO sql_operation_logs;
```

Verify on-server that no `s_*` tables remain (`SHOW TABLES LIKE 's_%';` should
return zero rows aside from any legacy tables you intentionally keep — see
§5.5).

### 5.3 Unique email index (idempotent CLI)

```bash
go run main.go migrate add-unique-email-index   # guarded; reports duplicates first
```

If duplicates exist, the command refuses and lists them — reconcile manually
(keep one, reassign the others) then re-run. Equivalent DDL:

```sql
ALTER TABLE users ADD UNIQUE INDEX uniq_users_email (email);
```

### 5.4 Agent tool-name rename + history backfill (idempotent CLI)

Renames the `BriefReviewAgent` → `BriefGeneAgent` surface and converges the 5
plural→singular tool names in history:

```bash
go run main.go migrate rename-tool-names        # idempotent
go run main.go migrate backfill-agent-tool-names # idempotent
```

Equivalent manual SQL (for reference):

```sql
UPDATE tool_names        SET tool_name='BriefGeneAgent' WHERE tool_name='BriefReviewAgent';
UPDATE tool_names        SET tool_name='ChatAgent'      WHERE tool_name='ChatAgents';
-- …(5 plural→singular rows total)
UPDATE question_agent_logs SET tool_name='BriefGeneAgent' WHERE tool_name='BriefReviewAgent';
-- …(same 5 in history)
```

### 5.5 Two legacy tables — KEEP, do not drop

`s_question_log` and `s_koo_search_question_logs` (if present) are not in the
data model. **Do not drop them.** Leave in place; confirm with the product
team before any removal.

> **Never run `go run main.go migrate all` in production.** That subcommand is
> `AutoMigrate` for dev/CI fresh schemas only; production DDL stays manual
> (the statements above).

### 5.6 Expert chat mode `mode` column + flag — PENDING (future feature, additive)

> **Not part of this release's cutover.** The Instant/Expert chat-mode selector
> ships with Expert **dark** (`bot.expert_enabled` defaults `false`). Do these
> steps only when turning Expert on — and only **after** the Bot
> `POST /v1/query/route` endpoint is deployed.

The gateway adds an additive `question_agent_logs.mode` column (plain
`ADD COLUMN`, default-covered, online, rollbackable) and a `bot.expert_enabled`
config flag. To enable Expert, in order:

1. Add the column (existing rows get the default `'instant'`):

   ```sql
   ALTER TABLE question_agent_logs
     ADD COLUMN mode VARCHAR(20) NOT NULL DEFAULT 'instant';
   ```

2. Deploy the Bot `POST /v1/query/route` endpoint (Bot work-order; out of scope
   for this repo).

3. Set `bot.expert_enabled: true` in the live `config/app.yml` and restart the
   Go service. (`app.yml.example` already documents the key under the `bot:`
   block, default `false`.)

Until all three are done Expert stays dark: the SPA disables the Expert pill and
the gateway returns **503** for any `mode=expert` request — no Bot call.

---

## 6. Backend deploy (Go)

1. **Build** with Go 1.23 (note the new module path — build from `apps/server/`):

   ```bash
   cd apps/server
   GOTOOLCHAIN=auto go build -o phytomni-server .
   ```

   The binary is now named `phytomni-server` (was `nky_client_go` binary).

2. **Config resolution.** The binary loads `./config/app.yml` relative to its
   working directory, or pass `--config <path>`. Run it from a directory whose
   `./config/app.yml` is the production config (§4).

3. **Run.** Default action is `Serve`, now on `:8080`:

   ```bash
   ./phytomni-server          # serve (default) — :8080
   ```

   Put it under a process supervisor (systemd). Update the supervisor unit:
   - binary path → `phytomni-server`
   - CWD / `--config` → the new config location
   - port expectation → `8080`

4. **Boot order.** Bring Go up with `bot.proxy_enabled: true` (the Bot is
   already up from the prior migration). The boot-time Bot agent validation
   must pass (it did before; the agent set is unchanged). Redis connects
   fail-open if unavailable.

---

## 7. nginx & frontend

> **The authoritative nginx config is on the production server (`/root/...`)
> and is NOT in any repo.** Ops edits it in place.

### 7.1 Reverse-proxy rules (to Go `:8080`)

The Go service now serves `/api/v1/*` plus one retained alias. nginx must
proxy it to `127.0.0.1:8080`:

```nginx
# NEW: RESTful business API
location /api/v1 { proxy_pass http://127.0.0.1:8080; }

# RETAINED alias (until Bot backport) — the /v1/nky/server/* block was removed
# with the Go server-task surface (no real external caller).
location /query/analyst/update_log { proxy_pass http://127.0.0.1:8080; }

# CHANGED port: was :8082 — keep only if you still serve /query here
# (the /query send endpoint is now POST /api/v1/conversations/:id/messages,
#  but the Bot writeback alias /query/analyst/update_log stays)
location / {
    root <NGINX_WEB_ROOT>;          # the deployed dist directory
    try_files $uri /index.html;     # SPA fallback
}
```

**Remove the old `/auth` and `/v1` locations** that pointed at `:8082` — the
frontend no longer calls them (it calls `/api/v1`). Keep any `/query` location
only if you need the `update_log` alias (handled above). The old `:8082`
upstream can be deleted.

### 7.2 Frontend build & deploy

```bash
cd apps/web
npm run build                       # outputs to ./dist
```

1. Archive the current live `dist` to a dated backup (e.g. `dist_$(date +%F)`).
2. Copy the new `dist` into the nginx web root.
3. Reload nginx:

   ```bash
   nginx -t && systemctl reload nginx
   ```

Cache headers: long `max-age` for hash-fingerprinted `/assets/`; `no-cache`
for `index.html`.

### 7.3 Preserve from the current config

- **TLS** on `:443` (cert paths on-server only — **verify on-server**).
- **Per-IP rate limiting** (`limit_req_zone` + `limit_req`) — keep; the new
  app-level ratelimit is additive, not a replacement.
- **Logs** — the current setup writes logs to `/root/gauss/app/logs`, a path
  under the gaussapp host dir. gaussapp is being retired (BI now connects to
  Huawei GaussDB directly from the Bot), so do not carry `/root/gauss/*` forward
  as a preserved dependency — repoint any logging still targeting it onto a
  gaussapp-independent path before the directory is removed.
- The separate **`/aiquery`** and **`/oneauth`** satellite proxies (unchanged).

---

## 8. Cutover sequence

Staged: steps 1–6 are **reversible**; step 7 is **irreversible** (the table
rename). Do step 7 only after smoke is green. **The frontend and backend must
ship together** — the frontend only calls `/api/v1`, which only the new binary
serves.

1. **Back up** — DB dump (`nongke`), live `dist`, current `app.yml`, Redis RDB (§3).
2. **Build** the new Go binary (`phytomni-server`) and the new frontend `dist`.
3. **Rename the database + 11 tables** (§5.1–5.2) while the old binary is still
   serving — `RENAME TABLE` is online and non-blocking. **⚠️ the old binary
   will start erroring the moment tables are renamed** (it queries `s_user`
   etc.); proceed immediately to step 4.
4. **Stop the old binary** (`nky_client_go` on `:8082`).
5. **Deploy the new `app.yml`** (§4 — new `db` key/DSN, `redis`, `ratelimit`,
   `obscache`, `chatlimit` blocks; port `8080`).
6. **Start the new binary** (`phytomni-server` on `:8080`), deploy the new
   `dist` + nginx rules (§7), reload nginx. Run the idempotent migrations
   (§5.3–5.4: unique-email index, agent-name rename/backfill).
7. **Smoke test** (§9). If green, the cutover is complete. The table rename is
   the point of no return for a binary-only rollback (§10).

> **Minimize the gap between step 3 and step 6.** Between the table rename and
> the new binary serving, the site is down. Practice the sequence on a staging
> host first; have the new binary + config + nginx rules ready to start before
> you rename.

---

## 9. Verification & smoke

- **Health.** `GET /readyz` returns 200; the response shows `redis` status,
  `fail_open` count, `ratelimit_blocked`, `obs_cache_hit`.
- **Auth.** `POST /api/v1/auth/sessions` succeeds (note the new path);
  `GET /api/v1/users/me/tool-permissions` returns the user's tools.
- **Logout.** `POST /api/v1/auth/logout` returns 200 and the token is rejected
  on next use; `POST /api/v1/auth/logout-all` invalidates all sessions for the
  user.
- **Chat round-trip.** `POST /api/v1/conversations/0/messages` returns 200 for
  ChatAgent and at least one RAG agent; confirm a rendered reply in the
  browser.
- **Agent naming.** A `brief_gene` request renders with the canonical
  `BriefGeneAgent` name (no `BriefReviewAgent` anywhere in the UI).
- **Error contract.** `/query` (if still routed) returns 504 on Bot relay
  timeout with the specific message; 503 when the gateway is disabled.
- **Audit access.** `GET /api/v1/operation-logs` returns **403** for a
  non-admin account.
- **Redis fail-open.** Stop Redis temporarily; confirm login + chat still work
  (revocation/ratelimit/obscache inert, WARN logged); restart Redis.
- **Rate limit (if enabled).** Hammer `/auth/sessions` from one IP > `login.limit` times in the window; confirm 429.
- **ChatLimit (if enforced).** A `chat_limit=0` user gets 403 on
  `/api/v1/conversations/0/messages`; an admin is unaffected.

---

## 10. Rollback

**Before the table rename (step 7 not yet run):**

1. Stop the new binary; redeploy the old `nky_client_go` binary on `:8082`.
2. Restore the old `app.yml`, `dist`, and nginx rules; reload nginx.
3. (DB rename not yet applied — nothing to revert.)

**After the table rename (step 7 run):** a binary-only rollback is **not
sufficient** — the old binary queries `s_*` tables that no longer exist. To
roll back:

1. **Rename the tables back** (instant, online):

   ```sql
   USE phytomni;
   RENAME TABLE
     users                TO s_user,
     tool_names           TO s_tool_name,
     user_tool_names      TO s_user_tool_name,
     question_agent_logs  TO s_question_agent_logs,
     gene_lists           TO s_gene_list,
     gene_examples        TO s_gene_example,
     user_permissions     TO s_user_permission,
     server_tool_logs     TO s_server_tool_logs,
     user_feedback        TO s_user_feedback,
     user_operation_logs  TO s_user_operation_logs,
     sql_operation_logs   TO s_sql_operation_logs;
   RENAME DATABASE phytomni TO nongke;
   ```

2. Redeploy the old binary + old `app.yml` (DSN back to `nongke` / `s_*` /
   `:8082`) + old `dist` + old nginx rules; reload nginx.
3. The unique-email index and agent-name rename are additive/idempotent —
   leaving them in place is harmless to the old binary (it ignores the index;
   the renamed tool names render as-is). Drop the unique index only if you
   need the old schema pristine: `ALTER TABLE s_user DROP INDEX uniq_users_email;`.

**Frontend-only rollback:** restore the dated `dist` backup and reload nginx
(no DB involvement).

> **The table rename is the only irreversible step.** Everything else (config,
> binary, dist, nginx, Redis) is a redeploy. Practice the rename-back SQL on
> staging first.

---

## 11. Degraded mode & known gotchas

- **Redis down.** Every Redis feature fail-opens: token revocation is inert
  (logged-out tokens stay valid until natural JWT expiry), rate limiting is
  inert (all requests allowed), OBS listing cache is inert (every listing hits
  the Bot). Login + chat keep working. A startup WARN is logged;
  `/readyz` shows the fail-open count. To restore, bring Redis back — no
  restart needed (the client reconnects).
- **`/api/v1` is frontend+backend coupled.** The old frontend calls `/auth` +
  `/v1`; the new frontend calls `/api/v1`. Never serve the new frontend
  against the old binary or vice versa — deploy them together (§8).
- **Retained alias.** `/query/analyst/update_log` (Bot writeback) still serves
  on the new binary. Remove the nginx location only after the Bot backports to
  `PATCH /api/v1/async-tasks/analyst-log`. (The `/v1/nky/server/*` external
  server alias was removed — no real external caller.)
- **Orphan config blocks.** `email:` and `huawei:` in `app.yml` have no
  consumers. Leaving them is harmless; removing them is cosmetic.
- **ChatLimit dark launch.** `chatlimit.enforce` defaults to `false` — no
  behavior change at deploy. Flipping to `true` blocks self-registered users
  (`chat_limit=0`) from `/query` (403 `Account has no chat quota`). Bypass for
  admin/super_admin/vip_user. Decide deliberately before flipping.
- **Rate limit dark launch.** `ratelimit.enabled` defaults to `false`. Flip
  only after confirming `login`/`register`/`query` limits suit your traffic.
- **Port change `8082→8080`.** Any direct (non-nginx) client of the Go service
  must repoint. The browser goes through nginx and is unaffected.
- **Agent naming clean break.** Stale browser tabs sending old tool tokens
  (`BriefReviewAgent`, plural forms) will 400 until reloaded — expected for
  the canonical rename.

---

## Appendix — what this release does NOT re-do

The following were done in the **prior** migration (already live in
production, described in [`web-production-deployment-manual.md`](web-production-deployment-manual.md))
and are **not** re-applied here:

- Python chat service retirement (`/query` already relayed to Bot).
- bcrypt password hashing + lazy MD5 upgrade (already live).
- First-login backend gate + frontend guard (already shipped together).
- Bot integration (`ptm_<web>` key, boot agent validation, OBS relay) —
  reuse the existing key; the Bot is unchanged.
- `bot_run_id` / `image_paths` columns + enum tightenings (already migrated).
- Huawei OBS credential move to Bot (already done; Web holds none).

If any of these are *not* actually live in your production (verify on-server),
stop and consult the older manual before proceeding — this release assumes
they are all in place.
