# Configuration reference (`app.yml` + environment)

**Evergreen — describes the config surface as of the current release (`0.1.4`).**
This is the single source of truth for _what every key does_. The per-release
[`upgrading.md`](upgrading.md) and the archived cutover manuals under
[`history/`](history/) reference this file instead of re-documenting keys — when a
release adds or changes a key, update it **here**.

The `0.1.4` Research input extension adds `bot.max_query_chars` and requires an
operator-managed storage/proxy preflight. Preserve the existing dark-launch
defaults and use the release-specific upgrade procedure for deployment steps.

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
degrades). Flip after confirming limits suit your traffic. The durable MySQL
registration floor below is independent of this switch.

### `register.durable_floor` — persistent registration floor

```yaml
register:
  durable_floor:
    limit: 30
    window: 1h
```

This floor counts recent `POST /api/v1/auth/registrations` operation-log rows
for the caller IP. It is always active, independent of the Redis rate limiter,
and rejects an over-limit registration with `429`. A database count error is
fail-closed and returns `503`; an unidentifiable client IP is not throttled.
The default is 30 registrations per hour. Tune it only with observed traffic
and keep the operation-log retention and indexes healthy.

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
  max_query_chars: 131072
  # Per synchronous Agent execution request; keys are canonical Bot slugs.
  agent_timeout_seconds:
    chat: 3000
    knowledge: 15000
    data: 9000
    review: 30000
    brief_gene: 30000
  proxy_enabled: true
  key_audit_redact: true
  history_dual_read: false # observation path; legacy/projection fallback remains primary
  upload_public_origin: "http://localhost:8000" # exact browser-reachable Bot origin; never derive from base_url
  max_upload_file_bytes: 26214400 # 25 MiB per file (matches Bot /v1/files 413)
  max_upload_file_count: 10
  max_upload_total_bytes: 52428800 # 50 MiB per request
```

`bot.max_query_chars` counts decoded Unicode code points in the current user
message. The default is `131072`; the hard maximum is `1048576`. Missing values
use the default, invalid values fail configuration loading, and accepted input
is never truncated. Conversation-history entries retain their independent
bound.

Research input compatibility is negotiated through
`research_input_resolution_v1` version `1`. The Bot-advertised attachment
default is `64`; the hard maximum is `256`. The effective request limit is the
compatible advertised value within that bound, not multipart concurrency or a
storage quota. The pasted dataset-path default is `64`; the hard maximum is
`256`. The combined-reference default is `128`; the hard maximum is `256`.
Missing or incompatible Research metadata fails submission closed. This
extension adds no second feature flag or cohort: every user who is already
authorized for Research receives the same negotiated contract.

`agent_timeout_seconds` overrides the compiled defaults entry by entry for one
Web Go-to-Bot synchronous Agent request. Instant uses `chat`; forced Expert
uses the selected Agent; autonomous Expert uses the maximum configured value
among the server-resolved allowed synchronous Agents. Uploads, run polling,
A2UI, interop, OBS relay, and background-Agent submission use
`timeout_seconds`. These settings do not change Bot-internal dependency
timeouts.

Upload enablement is negotiated from the Bot catalog. The browser upload
contract is `enabled` only when Bot advertises protocol `obs-multipart-v2`
version 2 and `upload_public_origin` is a valid scheme-plus-host origin with
no credentials, query, fragment, or path. Per-agent attachment channels are
copied from the Bot descriptor (`document_context` / `datasets`) and are not
gated by a Web-side feature flag. The origin is deliberately separate from the
internal `base_url`: it is the browser-reachable Bot upload origin, not an OBS
endpoint.

The Bot upload origin must allow only the deployed Web origin, the documented
`HEAD`/`PUT`/`POST`/`DELETE` upload methods, and the capability plus checksum
headers required by `obs-multipart-v2`; it must expose only documented
`Upload-*` response headers and must not enable credentialed cross-origin
requests. CORS is a Bot deployment setting, not a reason to place cloud
credentials in Web configuration.

When enabled after the coordinated acceptance, the browser uses `/api/v1/files`
only for bounded JSON create/renew control calls and sends parts directly to
Bot. Huawei AK/SK, account credentials, OBS upload IDs, object keys, and full
file bodies remain outside both the browser and Web Go. The Bot contract owns
the 10 GiB inclusive file limit, part sizing, concurrency, persistence, cleanup,
and Agent resolution; there is no separate small-file API.

The `max_upload_file_bytes`, `max_upload_file_count`, and
`max_upload_total_bytes` keys are legacy synchronous `/query` body limits while
the old relay is still present in this checkout. They do not enable resumable
biological uploads and must not be raised as a substitute for the breaking
protocol cutover. Once the cutover is accepted, the legacy body relay and these
keys are removed together.

The current legacy relay key `ptm_<web>` must carry the `agents` and `relay:obs`
scopes; the Bot must run with `RELAY_ENABLED=true` or relay downloads 404. For
the breaking upload cutover, the Web service principal additionally needs the
Bot-owned `files:delegate` scope for JSON create/renew calls; the browser's
short-lived upload capability is a separate data-plane credential. See
[`operations.md`](operations.md).

Expert routing, AG-UI streaming, A2UI actions, interop discovery,
conversation-context v1, Research, Analyst, Design, and Network are locally
always enabled. Admission still requires the matching Bot contract, the
caller's role grant, and ownership checks. Interop output stays allowlisted,
owner-scoped, bounded, and redacted. There is no Web-side `VITE_STREAM_ENABLED`
switch; the browser streams when Bot advertises a stream-capable agent.

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
