# Phytomni Web — Production Deployment & Upgrade Manual

This manual takes the **currently-deployed production Web stack** to **this release**. It is an in-place upgrade guide for the ops team: it lists what changed, the exact steps to apply each change, the cutover order, how to verify, and how to roll back.

The headline change: **the legacy Python chat service is retired. The Go service becomes the sole `/query` gateway and relays chat traffic to the Bot.** The Bot is deployed and operated by a separate team — this manual covers only the **Web side** of that integration (URL, key, ports, boot check, relay routes) and links the Bot's own deployment doc where Bot bring-up is needed.

> **⚠️ 本次发布含 API 路径重整(RESTful `/api/v1`):** Go 业务 API 已整体收敛到 RESTful 的 `/api/v1` 前缀(动词与资源路径均变),权威映射见 [`API_DOC.md`](../API_DOC.md)。运维须知:
> - **nginx 反代须新增 `/api/v1` location** 指向 Go 服务;前端只打 `/api/v1`,旧 `/auth`、`/v1`、`/query` 前端面已废弃。
> - **跨边界旧别名暂留**:Bot 仍调 `POST /query/analyst/update_log`、外部 server 客户端仍调 `/v1/nky/server/*`——这两条旧路由 Go 侧继续作为别名服务,待 Bot / 外部客户端 backport 后由运维移除。
> - 下文 curl/nginx 示例若仍引用旧路径,新契约一律以 `API_DOC.md` 的 `/api/v1` 为准;完整运营级路径核对在 cutover 时随本次发布一并落地。

---

## 0. Scope & conventions

**Audience.** Ops/运维 with: shell on the production host (`/root/...`), MySQL admin, nginx admin, and the ability to edit `config/app.yml` and restart the Go service.

**Wording.** This guide never uses version numbers. It says **"the current production stack"** for what is running today and **"this release" / "the new build"** for what you are deploying.

**Secrets are placeholders.** Every credential below is written as a placeholder such as `<DB_PASSWORD>`, `<PTM_WEB_KEY>`, `<BOT_SERVICE_TOKEN>`, `<JWT_SECRET>`, `<PROD_DB_HOST>`, `<SMTP_AUTH_CODE>`. Substitute the real values out-of-band on the server. Never commit real values, and never paste them into tickets or logs.

**Verify-on-server markers.** A few facts live only on the production server and are **not** in any repo. They are marked **(verify on-server)** below — confirm them in place rather than assuming.

**Companion documents.**
- [`bot-cutover-ops-runbook.md`](bot-cutover-ops-runbook.md) — the detailed Bot key mint / 90-day rotation / staged-cutover / rollback procedure. This manual references it instead of duplicating it.
- [`Phytomni-Bot/docs/deployment.md`](https://github.com/Phytomni/Phytomni-Bot/blob/main/docs/deployment.md) — how the Bot team brings the Bot up (out of scope here).

**Contents.**
1. [What changed](#1-what-changed-vs-the-current-production-stack)
2. [Target topology & ports](#2-target-topology--ports)
3. [Prerequisites & pre-flight](#3-prerequisites--pre-flight)
4. [Configuration & secrets (app.yml)](#4-configuration--secrets-appyml)
5. [Database migration](#5-database-migration)
6. [Backend deploy (Go)](#6-backend-deploy-go)
7. [Bot integration contract](#7-bot-integration-contract)
8. [nginx & frontend](#8-nginx--frontend)
9. [Cutover sequence](#9-cutover-sequence)
10. [Verification & smoke](#10-verification--smoke)
11. [Rollback](#11-rollback)
12. [Degraded mode & known gotchas](#12-degraded-mode--known-gotchas)

---

## 1. What changed vs the current production stack

| Area | Currently in production | This release | Why it matters |
|---|---|---|---|
| Chat backend | A Python service (`nky_client_python`) serves `/query`, owns the MCP client, and holds Huawei OBS credentials | Removed. The Go service's `/query` handler relays to the Bot | A whole process is decommissioned; `/query` traffic moves to Go |
| Bot dependency | None | Required. Go validates Bot agents at boot when the gateway is enabled | Bot must be up and complete before Go starts with the gateway on |
| OBS credentials | Held by the Python/Web side; files fetched directly | Held by the Bot only; downloads go through a Bot relay | Web carries no Huawei OBS keys after cutover |
| `app.yml` | Minimal | New `bot`, `jwt`, `email` blocks; DSN host/user change; `gene_file_path` change | Several new required keys; missing them blocks boot or features |
| DB schema | — | `+bot_run_id`, `+image_paths`, three enum tightenings; two legacy tables retained-but-unused | An additive migration is required before cutover |
| nginx | `/query` upstream is the Python service | `/query` upstream is Go `:8080` | One reverse-proxy line moves at cutover |
| First-login flow | No server-side gate | Backend gate + matching frontend guard | Backend and frontend **must** ship together |
| Auth | MD5 password hashes; audit logs unredacted | bcrypt (lazy upgrade); operation-log admin-only + body redaction | Set `bcrypt_cost`; **run the §5.6 operator preconditions** (inventory, column width, snapshot, canary) before deploy — the hash migration is forward-only |

---

## 2. Target topology & ports

| Component | Port | Role |
|---|---|---|
| nginx | `:443` (TLS, `phytomni.cn`) | TLS termination + reverse proxy by path + serves the SPA |
| Go service | `:8080` | Serves `/api/v1/*` (plus the retained back-compat aliases `/query/analyst/update_log` and `/v1/nky/server/*`). Sole MySQL writer |
| Bot | `:8000` | **Internal only.** Go relays chat here; the browser never reaches it directly. Deployed by the Bot team |
| MySQL | `:3306` | `phytomni` database |
| Legacy Python chat service | **(verify on-server)** | Retired at cutover; remove from nginx once `/query` points at Go |
| Satellite: `/aiquery/*`, `/oneauth/*` | separate | Redis cache + unified auth — unchanged, proxied independently |

**Current data flow**

```
                          ┌──────────────────────────────┐
 Browser ── HTTPS ──▶ nginx│ /auth, /v1  ─▶ Go      :8080 │──▶ MySQL :3306 (phytomni)
 (phytomni.cn :443)        │ /query      ─▶ Python service│──▶ MCP server + Huawei OBS
                          └──────────────────────────────┘
```

**New data flow**

```
                          ┌────────────────────────────────────┐
 Browser ── HTTPS ──▶ nginx│ /auth, /v1, /query ─▶ Go     :8080 │──▶ MySQL :3306 (phytomni)
 (phytomni.cn :443)        └────────────────────────────────────┘
                                                  │ relay (Bearer <PTM_WEB_KEY>)
                                                  ▼
                                          Bot :8000 (internal)
                                                  ▼
                                       MCP agents + Huawei OBS
```

---

## 3. Prerequisites & pre-flight

Do these before touching anything mutable.

1. **Back up (mandatory, first).**
   - MySQL: `mysqldump -u <DB_USER> -p phytomni > phytomni_backup_$(date +%F).sql`
   - Frontend: archive the live `dist` directory to a dated backup (see §8).
   - Config: copy the current `config/app.yml` to a safe location.
2. **Toolchain on the build host.**
   - Go 1.23 to build the Go binary.
   - Node + npm to build `apps/web/dist`.
3. **Bot readiness** (coordinate with the Bot team — see §7):
   - The Bot is reachable on its internal URL.
   - The Bot exposes all required agents (§7).
   - A `ptm_<web>` key has been minted for this Web app.
4. **Access.** MySQL admin; shell access to the on-server nginx config **(verify on-server: path under `/root/...`)**.

---

## 4. Configuration & secrets (app.yml)

Copy `config/app.yml.example` to `config/app.yml` and fill in real values. `app.yml` is git-ignored — keep it out of version control and not world-readable. Below are the blocks that are **new or changed** versus the current production config. Secrets are placeholders.

### 4.1 `bot` — NEW (critical)

```yaml
bot:
  base_url: "http://<BOT_HOST>:8000"   # Bot HTTP root (internal VPC URL in production)
  user_api_key: "<PTM_WEB_KEY>"        # one ptm_… key for the whole Web app (see §7)
  timeout_seconds: 900                 # gateway↔Bot HTTP timeout for SYNC agents
  proxy_enabled: true                  # master switch; false ⇒ /query returns 503
  key_audit_redact: true               # logs emit only the key prefix
  max_upload_file_bytes: 26214400      # 25 MiB per file
  max_upload_file_count: 10
  max_upload_total_bytes: 52428800     # 50 MiB per request
```

- `proxy_enabled` **must be `true`** in any real deployment — after cutover the Go gateway is the only `/query` handler. With it `true`, the Go service performs a boot-time Bot agent check and **fails fast** if the Bot is unreachable (see §7).
- `timeout_seconds` bounds **synchronous** agent calls only. Observed production latencies: chat ~140s, knowledge ~198s, review >300s (RAG-heavy). Keep it **≥900**; raise it if your RAG agents run slower. Async agents (analyst, deep_genome) return a task id immediately and are not bound by this.
- `user_api_key` is minted by the Bot team; `key_audit_redact: true` ensures it is never logged in full.

### 4.2 `huawei` — REMOVED

The Go service no longer talks to Huawei IAM/EIHealth directly and holds no
Huawei credentials. Async (analyst / deep_genome) task status is reconciled
through the Bot run API (`SyncBotRuns` + the `/query/analyst/update_log`
writeback); OBS access is the Bot relay (`/v1/relay/obs/*`). Remove any
`huawei.*` block from the live `app.yml`.

### 4.3 `jwt` — NEW (critical)

```yaml
jwt:
  secret_key: "<JWT_SECRET>"           # e.g. openssl rand -hex 32
```

While the Python service remains available as a rollback target (§11), keep `jwt.secret_key` equal to that service's `SECRET_KEY_CLIENT` so tokens stay valid across a rollback. After the Python service is decommissioned, the secret is Go-only.

### 4.4 `email` — NEW (important)

Outbound notification email (chat-page links + OBS download links). Omit the block only if notifications are disabled.

```yaml
email:
  web_base_url: "http://<WEB_HOST>"
  api_base_url: "http://<API_HOST>:8080"
  smtp_server: "smtp.qq.com"
  smtp_port: 587
  from_display: "nky_email <<SENDER_EMAIL>>"
  from_address: "<SENDER_EMAIL>"
  from_auth_code: "<SMTP_AUTH_CODE>"
```

### 4.5 Database DSN — CHANGED (important)

The current production DSN points at an external host as `root`. This release expects:

```yaml
db:
  phytomni-server:
    dialect: mysql
    dsn: "<DB_USER>:<DB_PASSWORD>@tcp(<PROD_DB_HOST>:3306)/phytomni?charset=utf8mb4&parseTime=True&loc=Local"
```

Confirm whether the database is co-located (`localhost`) or stays on its external host **(verify on-server)**, and that the DSN user has INSERT on the audit-log tables plus the `User`/`QuestionAgentLog` families.

### 4.6 Other keys

- `gene_file_path` — CHANGED: point at the directory holding the per-gene `.out` artifacts (e.g. `/var/lib/phytomni/gene_examples`), not the old Python path.
- `bcrypt_cost: 10` — optional (default 10; allowed range `[10,31]`; the server refuses to boot outside it). Do not raise without measuring login p99 on production hardware.
- `app.trusted_proxies`, `http.gzip`, `http.maintenance` — optional tuning; defaults are safe.
- **OBS credentials are removed from the Web config** — they live on the Bot now. Revoke any lingering Web-side Huawei OBS access key/secret **after** soak.

---

## 5. Database migration

Run after the backup in §3. All statements are **additive and safe** on existing data. Use the wired CLI where one exists (`go run main.go <cmd>`, or the built binary `./phytomni-server <cmd>`).

> **Table names:** the SQL in this section uses the production table names as they exist today (`s_*`). The repo's table rename (drop `s_` and pluralize — e.g. `s_user` → `users`, `s_question_agent_logs` → `question_agent_logs`) ships as a separate operator cutover (`RENAME TABLE`); run each statement against whichever names are live at the time.

### 5.1 Tighten three enum columns

```sql
ALTER TABLE s_user
  MODIFY COLUMN first_login_status ENUM('0','1') NOT NULL DEFAULT '0' COMMENT '登陆状态';
ALTER TABLE s_question_agent_logs
  MODIFY COLUMN reaction_type ENUM('0','1','2') NOT NULL DEFAULT '0' COMMENT '点赞状态';
ALTER TABLE s_question_agent_logs
  MODIFY COLUMN collect_type ENUM('0','1') NOT NULL DEFAULT '0' COMMENT '收藏状态';
```

### 5.2 Add `bot_run_id` (idempotent CLI)

```bash
go run main.go migrate add-bot-run-id      # guarded by HasColumn; safe to re-run
```

Equivalent DDL (for reference only — prefer the command above):

```sql
ALTER TABLE s_question_agent_logs
  ADD COLUMN bot_run_id VARCHAR(64) NULL COMMENT 'Bot run_id 跨服务关联键' AFTER server_id;
```

### 5.3 Add `image_paths` (idempotent CLI)

```bash
go run main.go migrate add-image-paths     # guarded by HasColumn; safe to re-run
```

Equivalent DDL (for reference only — prefer the command above):

```sql
ALTER TABLE s_question_agent_logs
  ADD COLUMN image_paths TEXT NULL COMMENT '图廊图片OBS路径(JSON数组)' AFTER download_path;
```

> **Do not skip this.** The Go model writes `image_paths` on every chat-log insert. Without the column, **every `/query` returns 500** (`Unknown column 'image_paths'`) even though the Bot answered. This was reproduced in a live end-to-end run. The `add-image-paths` subcommand is dev/CI fresh-schema convenience; production DDL still runs manually (use the CLI or the SQL above, your choice).

### 5.4 Backfill the first-login flag

```bash
go run main.go migrate up                  # idempotent, WHERE-guarded
```

### 5.5 Two legacy tables — KEEP, do not drop

The data model no longer defines `s_question_log` or `s_koo_search_question_logs`, but they still exist in production. **Do not drop them.** Leave them in place and confirm with the product team before any removal or archival.

> **Never run `go run main.go migrate all` in production.** That subcommand is `AutoMigrate` for dev/CI fresh schemas only; production DDL stays manual (the statements above).

### 5.6 Password storage (bcrypt) — operator preconditions

The Go service hashes new passwords with bcrypt and **lazily upgrades** a legacy MD5 row to bcrypt on that user's next successful login (no forced resets). This is a one-way migration of the stored hash. Before deploying the bcrypt-capable binary, run these read-only checks against production and capture a backup. None of this is automatic — the binary cannot widen a column, take a snapshot, or canary itself.

1. **Hash inventory (read-only).** Confirm every row is a recognized scheme; triage `empty`/`other` before deploy (those users cannot log in and will never upgrade):

   ```sql
   SELECT COUNT(*),
     CASE
       WHEN password REGEXP '^[$]2[aby][$]' THEN 'bcrypt'
       WHEN password REGEXP '^[0-9a-f]{32}$' THEN 'md5'
       WHEN password IS NULL OR password = '' THEN 'empty'
       ELSE 'other'
     END AS scheme
   FROM s_user GROUP BY scheme;
   ```

2. **Column width.** A bcrypt hash is 60 chars; the column must hold ≥ 60:

   ```sql
   SHOW COLUMNS FROM s_user LIKE 'password';
   ```

   If it is already wide (`longtext`, `varchar(255)`, etc.) **no ALTER is needed**. Only if it is narrower than 60: `ALTER TABLE s_user MODIFY COLUMN password VARCHAR(72)` — run online (`ALGORITHM=INPLACE, LOCK=NONE`), and add `NOT NULL` only after confirming zero NULLs.

3. **Snapshot `s_user`** immediately before deploy. This is the rollback net (see §11): once bcrypt rows are written, the change is forward-only.

4. **Legacy-account canary.** On a restored snapshot or a replica, deploy the new binary and confirm a **real** legacy (MD5) account both logs in **and** upgrades to `$2…`, against the production hash format — not just a synthetic test row.

5. **Post-deploy monitoring.** Track the count of all **non-bcrypt** rows (not only clean 32-hex MD5 — `other`/`empty` are invisible to a naive MD5 count) and watch for lazy-upgrade write failures in the logs. A row that never logs in stays on MD5 indefinitely; decide later whether a forced-reset campaign is warranted.

> `bcrypt_cost` is the **only** app.yml knob (see §4.6); it does not remove the operator steps above.

---

## 6. Backend deploy (Go)

1. **Build** with Go 1.23:

   ```bash
   cd apps/server
   GOTOOLCHAIN=auto go build -o phytomni-server .
   ```

2. **Config resolution.** The binary loads `./config/app.yml` relative to its working directory, or pass `--config <path>` to point elsewhere. Run it from a directory whose `./config/app.yml` is the production config.

3. **Run.** The default action is `Serve`, which listens on `:8080`:

   ```bash
   ./phytomni-server          # serve (default) — :8080
   ```

   Put it under a process supervisor (systemd). Send logs to your standard sink (`log.outputs` in `app.yml`).

4. **First boot dormant.** Bring Go up first with `bot.proxy_enabled: false` to validate the non-chat surface (`/api/v1/*`) without requiring the Bot. Flip the gateway on later in the cutover (§9).

---

## 7. Bot integration contract

The Bot is deployed and operated separately on an internal `:8000` — for Bot bring-up, see [`Phytomni-Bot/docs/deployment.md`](https://github.com/Phytomni/Phytomni-Bot/blob/main/docs/deployment.md). This section is only what the **Web side** must wire.

### 7.1 Mint the Web's Bot key (Bot team / ops)

The Bot ops mint one user-scoped key for this Web app using the ops-only service token (the service token never enters Web config):

```bash
curl -X POST <BOT_BASE_URL>/v1/api-keys \
  -H "Authorization: Bearer <BOT_SERVICE_TOKEN>" \
  -H "Content-Type: application/json" \
  -d '{"user_id":"web","name":"chat-ai-web-app"}'
```

Put the returned `ptm_…` value into `bot.user_api_key`. The key **must** carry the `agents` and `relay:obs` scopes (the Bot denies relay routes to scope-less keys), and the Bot must run with `RELAY_ENABLED=true`. See runbook [§2](bot-cutover-ops-runbook.md). Rotate every ~90 days per runbook [§3](bot-cutover-ops-runbook.md).

### 7.2 Boot-time agent validation (fail-fast)

When `proxy_enabled: true`, the Go service calls `GET /v1/agents` at startup and **refuses to boot** unless every required slug is present:

```
chat, knowledge, data, analyst, review, deep_genome, brief_gene
```

Ensure the Bot exposes all seven before starting Go with the gateway on. (This is the Web-owned alias→slug table; the chat UI's tool names map to these slugs.)

### 7.3 Relay surface

- **Sync agents** (chat / knowledge / review): Go relays `POST /v1/chat/completions`.
- **Async agents** (analyst / deep_genome): Go posts `POST /v1/agents/{slug}/runs`, gets a run id, stores it in `question_agent_logs.bot_run_id`, and reconciles later via the writeback (`PATCH /api/v1/async-tasks/analyst-log`; the Bot still uses the `/query/analyst/update_log` alias until it backports).
- **File upload**: `POST /v1/files`.
- **OBS download**: `/v1/relay/obs/*` (Go→Bot) and the browser-facing `/api/v1/downloads/relay-file?t=<signed-token>` (token in the query string so `window.open` / `<img>` / email links work without an auth header).

### 7.4 Error contract (`/query`)

The handler maps service errors to HTTP status:

| Condition | Status |
|---|---|
| Gateway disabled (`proxy_enabled` false / Bot config missing) | **503** |
| Unknown tool/agent name | **400** |
| Client-correctable Bot 4xx (excludes 401/403, all 5xx) | **400** (with the Bot message) |
| Everything else | **500** |

### 7.5 Real-user isolation stays in Web

The Bot sees a single principal (`user_id="web"`). Real per-user isolation lives entirely in the Go service: every read/write is filtered by the JWT-resolved `user_name`, never by a client-supplied id. See runbook [§5](bot-cutover-ops-runbook.md).

---

## 8. nginx & frontend

> **The authoritative nginx config is on the production server (`/root/...`) and is NOT in any repo.** Ops edits it in place. The `reference/deer-flow/docker/nginx/*` files in the repo are for **local dev only** (wrong upstreams) — do not use them.

### 8.1 Reverse-proxy rules (to Go `:8080`)

The Go service serves these path prefixes; nginx must proxy them to `127.0.0.1:8080`:

```nginx
location /auth  { proxy_pass http://127.0.0.1:8080; }
location /v1    { proxy_pass http://127.0.0.1:8080; }
location /query { proxy_pass http://127.0.0.1:8080; }   # CHANGED: was the Python service
location / {
    root <NGINX_WEB_ROOT>;          # the deployed dist directory
    try_files $uri /index.html;     # SPA fallback for Vue Router
}
```

The only routing change at cutover is the **`/query` upstream moving from the Python service to Go `:8080`**.

### 8.2 Frontend build & deploy

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

Cache headers: long `max-age` for the hash-fingerprinted `/assets/` and `/static/`; `no-cache` for `index.html`.

### 8.3 Preserve from the current config

- **TLS** on `:443` (cert paths live on-server only — **verify on-server**, never commit them).
- **Per-IP rate limiting** (`limit_req_zone` + `limit_req`).
- **Logs** to `/root/gauss/app/logs`.
- The separate **`/aiquery`** and **`/oneauth`** satellite proxies (unchanged).

---

## 9. Cutover sequence

Staged: steps 1–7 are **reversible**; step 9 is **irreversible**. Do not do step 9 until smoke + soak are green.

1. **Back up** — DB dump, live `dist`, current `app.yml` (§3).
2. **Confirm the Bot** is deployed, reachable, has all seven agents, and the `ptm_<web>` key is minted (§7).
3. **Migrate the database** (§5) while the Python service is still serving — every change is additive.
4. **Deploy the Go binary** with `bot.proxy_enabled: false`; verify `/auth` + `/v1` health.
5. **Deploy the new frontend `dist` + nginx rules**, but **keep `/query` pointed at the Python service** for now.
6. **Reversible flip:** set the `bot.*` config (§4.1), set `proxy_enabled: true`, restart Go (the boot agent validation must pass), then **repoint nginx `/query` → Go `:8080`** and `systemctl reload nginx`.
7. **Smoke test** (§10).
8. **Soak** for your standard window, watching `/query` error rates.
9. **Irreversible cleanup** (only if smoke + soak are green): decommission the Python service (its systemd unit) and revoke the Web-side Huawei OBS credentials.

See runbook [§6](bot-cutover-ops-runbook.md) for the staged-cutover detail.

---

## 10. Verification & smoke

- **Auth.** `POST /api/v1/auth/sessions` succeeds; `GET /api/v1/users/me/tool-permissions` returns the user's tools.
- **Chat round-trip.** `/query` returns 200 for each sync agent. Drive at least **ChatAgent** and one RAG agent (e.g. **KnowledgeAgent**) end-to-end from the browser and confirm a rendered reply. (This path was validated in a live local run.)
- **First-login.** A fresh user logs in → reaches the change-password form with **no redirect loop** → changes the password → lands on chat.
- **Error contract.** `/query` returns 503 when the gateway is disabled and 400 for an unknown tool name.
- **Audit access.** `GET /api/v1/operation-logs` returns **403** for a non-admin account.
- **Redaction.** Spot-check `user_operation_logs` — password fields are masked (`******`).

---

## 11. Rollback

**Before the irreversible step (§9.9):**

1. Set `bot.proxy_enabled: false` and restart Go.
2. Repoint nginx `/query` back to the Python service and `systemctl reload nginx`.

That is an instant revert with **no DB or code rollback needed** — `/query` returns to the Python path and the rest of the Go service keeps serving. See runbook [§8](bot-cutover-ops-runbook.md).

- **Frontend:** restore the dated `dist` backup and reload nginx.
- **Go binary:** redeploy the previous binary. **bcrypt point-of-no-return:** the old binary only understands MD5, so any account that already logged in under the new binary (and was lazily upgraded to `$2…`) can no longer authenticate against the old binary and is locked out. If you must roll the binary back after bcrypt rows exist, restore the §5.6 `s_user` snapshot for the affected rows — a binary-only rollback is **not** sufficient.
- **Database:** the added columns are nullable and additive; leaving them in place is harmless, so no down-migration is required.

---

## 12. Degraded mode & known gotchas

- **Bot down (with `proxy_enabled: true`).** `/query` returns 503 immediately; existing conversation history still renders (it reads MySQL legacy fields and makes no Bot call). To restore service before the Bot is back, fall back to the Python path (§11). See runbook [§9](bot-cutover-ops-runbook.md).
- **Slow RAG / upstream rerank.** A slow retrieval/rerank upstream can push a sync agent past `bot.timeout_seconds`, surfacing as a user 500. Keep `timeout_seconds` ≥900 and watch `/query` error rates; raise it if a heavy agent runs longer.
- **First-login gate must ship backend + frontend together.** The backend gate allows first-login users only to `/api/v1/users/me/password`; the frontend guard skips its tool-probe for that route. Deploy the Go service and the frontend in the **same** release — the backend gate alone locks first-login users out of the only page that clears the flag.
- **bcrypt lazy upgrade.** Legacy MD5 password hashes upgrade to bcrypt on the user's next successful login — no forced resets. Monitor upgrade success for a few weeks after deploy.

### Appendix — companion docs

- [`bot-cutover-ops-runbook.md`](bot-cutover-ops-runbook.md) — Bot key mint/rotation, staged cutover, rollback, degraded mode (detailed).
- [`Phytomni-Bot/docs/deployment.md`](https://github.com/Phytomni/Phytomni-Bot/blob/main/docs/deployment.md) — Bot bring-up (separate team).
