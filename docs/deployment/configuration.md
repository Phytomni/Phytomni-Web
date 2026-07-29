# Configuration reference (`app.yml` + environment)

**Evergreen — describes the config surface as of the current release (`0.1.4`).**
This is the single source of truth for _what every key does_. The per-release
[`upgrading.md`](upgrading.md) and the archived cutover manuals under
[`history/`](history/) reference this file instead of re-documenting keys — when a
release adds or changes a key, update it **here**.

The `0.1.4` compatibility follow-up adds no configuration keys or production
schema changes beyond the `0.1.3` baseline. Preserve the existing dark-launch
defaults and use the release-specific upgrade addendum for deployment steps.

Config is loaded by Viper from `apps/server/config/app.yml` (copy from
`app.yml.example`; git-ignored, keep it out of VCS and not world-readable).
Secrets are placeholders — substitute real values out-of-band on the server.

## Target topology & ports

| Component                      | Port               | Role                                                                        |
| ------------------------------ | ------------------ | --------------------------------------------------------------------------- |
| nginx                          | `:443` (TLS)       | TLS termination + reverse proxy by path + serves the SPA                    |
| Go service (`phytomni-server`) | `:8080`            | `/api/v1/*` + retained alias `/query/analyst/update_log`. Sole MySQL writer |
| Bot                            | `:8000` (internal) | Go relays chat here; deployed by the Bot team                               |
| MySQL                          | `:3306`            | `phytomni` database                                                         |
| Redis                          | `:6379`            | Token revocation + rate limit + OBS listing cache (all fail-open)           |

## Secret injection from the environment (optional)

Three secrets can be injected from the environment instead of `app.yml`, for
12-factor / secret-manager delivery. **When the env var is unset or empty, the
`app.yml` value wins** — leaving the environment untouched (or setting an empty
string) keeps file-based config. Only a **non-empty** env value overrides the file.

| Env var                   | Overrides                       | Mechanism                      |
| ------------------------- | ------------------------------- | ------------------------------ |
| `PHYTOMNI_JWT_SECRET`     | `jwt.secret_key`                | explicit non-empty `os.Getenv` |
| `PHYTOMNI_DB_DSN`         | the `db.<key>.dsn`              | explicit `os.Getenv`           |
| `PHYTOMNI_REDIS_PASSWORD` | `redis.clients.<name>.password` | explicit `os.Getenv`           |

## `app.yml` blocks

### `db` — MySQL (critical)

```yaml
db:
  phytomni-server: # connection-registry key (must match)
    dialect: mysql
    dsn: "<DB_USER>:<DB_PASSWORD>@tcp(<PROD_DB_HOST>:3306)/phytomni?charset=utf8mb4&parseTime=True&loc=Local"
```

The `phytomni` database and its unprefixed-plural tables must exist before boot
(created by the `0.1.1` cutover — see [`history/repo-reorg-cutover.md`](history/repo-reorg-cutover.md) §5).

### `jwt` — token signing (critical)

```yaml
jwt:
  secret_key: "<JWT_SECRET>" # e.g. openssl rand -hex 32
```

Verification is pinned to HS256 (`0.1.3`). Keep the secret stable across
deploys so issued tokens stay valid. Overridable via `PHYTOMNI_JWT_SECRET`.

### `auth` — public self-registration gate (default ON)

```yaml
auth:
  registration_enabled: true
```

When `auth.registration_enabled` is missing or `true`, public
`POST /api/v1/auth/registrations` remains available. Set it to `false` to close
that public route: it returns HTTP 403 with the localized closed-registration
message. `GET /api/v1/auth/capabilities` remains public and reports the
`registration_enabled` boolean for client presentation.

`POST /api/v1/users` still requires an administrator token and remains usable
when public registration is closed. Changing this value requires a Go service
restart; no schema migration is involved. To roll back, set the key back to
`true` and restart the Go service.

### `redis` — user/product layer (critical; fail-open)

```yaml
redis:
  enabled: true # default true = secure path; false ⇒ all Redis features fail-open
  clients:
    web:
      addrs: ["<REDIS_HOST>:6379"]
      db: 0
      password: <REDIS_PASSWORD> # empty if none; overridable via PHYTOMNI_REDIS_PASSWORD
      type: single-node
      # pool_size: 0             # 0 = go-redis default (10 * CPU cores)
      # min_idle_conns: 0        # 0 = go-redis default
  default: web
```

Backs token revocation, rate limiting, and the OBS listing cache. **Every Redis
feature fail-opens** — a Redis outage degrades those features but never blocks
boot or auth. `/readyz` reports Redis status + the fail-open count.

### `ratelimit` — anti-abuse (dark-launched OFF)

```yaml
ratelimit:
  enabled: false # master switch; default OFF (dark launch)
  login: { limit: 60, window: 60s } # per-IP on /auth/sessions
  register: { limit: 10, window: 1h } # per-IP on /auth/registrations
  query: { limit: 30, window: 60s } # per-user on /query
```

Leave `false` for zero behavior change. Redis down ⇒ always allow (auth never
degrades). Flip after confirming limits suit your traffic.

### `obscache` — gene-download listing cache (default ON; fail-open)

```yaml
obscache:
  enabled: true
  ttl: 1h
```

Benign optimization. Cache boundary = security boundary (ownership checked
before the cache; only raw keys cached, never signed URLs; only `SUCCEEDED` +
non-empty results). Set `false` to bypass without affecting revocation/ratelimit.

### `chatlimit` — invitation quota gate (dark-launched OFF)

```yaml
chatlimit:
  enforce: false # ON ⇒ self-registered users (chat_limit=0) blocked from /query
```

`false` = everyone can chat. Flip `true` only when the invitation-quota model is
active. Bypass for `admin`/`super_admin`/`vip_user`; fail-open on DB error.
`guest_default_chat_limit` (default 5) sets the quota for new self-registrations.

### `bot` — Bot relay (critical)

```yaml
bot:
  base_url: "http://<BOT_HOST>:8000"
  user_api_key: "<PTM_WEB_KEY>" # mint/rotate per operations.md §1–3
  # Fallback for uploads, control calls, and background-Agent submission.
  timeout_seconds: 900
  # Per synchronous Agent execution request; keys are canonical Bot slugs.
  agent_timeout_seconds:
    chat: 3000
    knowledge: 15000
    data: 9000
    review: 30000
    brief_gene: 30000
  proxy_enabled: true
  key_audit_redact: true
  expert_enabled: false # dark-launch: Expert routing (operations.md §11.1)
  stream_enabled: false # dark-launch: AG-UI SSE streaming (operations.md §11.2)
  a2ui_actions_enabled: false # dark-launch: A2UI action relay; owner/run checks stay dormant
  interop_enabled: false # dark-launch: sanitized capability/provenance discovery
  research_enabled: false # dark-launch: remote Research product surface
  design_enabled: false # dark-launch: remote Design product surface
  network_enabled: false # dark-launch: remote Network product surface
  history_dual_read: false # observation path; legacy/projection fallback remains primary
  max_upload_file_bytes: 26214400 # 25 MiB per file (matches Bot /v1/files 413)
  max_upload_file_count: 10
  max_upload_total_bytes: 52428800 # 50 MiB per request
```

`agent_timeout_seconds` overrides the compiled defaults entry by entry for one
Web Go-to-Bot synchronous Agent request. Instant uses `chat`; forced Expert
uses the selected Agent; autonomous Expert uses the maximum configured value
among the server-resolved allowed synchronous Agents. Uploads, run polling,
A2UI, interop, OBS relay, and background-Agent submission use
`timeout_seconds`. These settings do not change Bot-internal dependency
timeouts.

The `ptm_<web>` key must carry the `agents` and `relay:obs` scopes; the Bot must
run with `RELAY_ENABLED=true` or relay downloads 404. See
[`operations.md`](operations.md).

The remote-product switches (`research_enabled`, `design_enabled`, and
`network_enabled`) plus `a2ui_actions_enabled` are default-off capability gates.
They remain off until the corresponding Bot-owner, security, staging, and live
acceptance evidence is reviewed. `interop_enabled` follows the same rule and
must additionally keep capability/provenance output allowlisted, owner-scoped,
bounded, and redacted.

`history_dual_read` is also false by default. When enabled by an authorized
operator, it is an observation/compatibility read path layered on top of the
sanitized projection and legacy fallback; it does not replace the projection
migration or permit older revisions to overwrite visible reports. Keep it false
until the RC-WEB-007 and RC-LIVE-001 acceptance rows are complete.

### `gene_obsfs_path` — gene-example serving

```yaml
gene_obsfs_path: "" # obsfs FUSE mount root; empty ⇒ Bot relay fallback
```

Set to the mount root (e.g. `/obs/<bucket>/.../gene-examples`) to serve gene
list/detail/images from obsfs (`0.1.3`); empty falls back to the Bot relay.

### Other keys

- `bcrypt_cost: 10` — allowed range `[10,31]`; the server refuses to boot outside
  it. Do not raise without measuring login p99 on production hardware.
- `app.trusted_proxies`, `http.{gzip,maintenance,switch}`, `cron.switch`,
  `log.outputs`, `debug` — operational tuning; defaults are safe.

### Orphan blocks — `email:` and `huawei:` (no consumer; safe to delete)

As of `0.1.3` **neither block has a live consumer**:

- **`email:`** — the SMTP package (`common/email/`) was removed in `0.1.1` (zero
  importers). The block is dead config.
- **`huawei:`** — the Web side no longer talks to Huawei IAM/EIHealth directly
  (async reconciliation goes through the Bot). Dead config on the Web side. (The
  Bot still holds Huawei OBS credentials — unchanged.)

Both are **safe to leave** (nothing reads them) or delete for a clean config. No
behavioral impact either way.
