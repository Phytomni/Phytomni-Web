# Phytomni Web — `0.1.1` → `0.1.2` Upgrade Runbook

**This is the only document ops needs to upgrade a production already on `0.1.1`.**
It is self-contained: every step, SQL statement, config key, smoke check, and
rollback is here. You do **not** need to read the `repo-reorg` manual (that one
records how production *reached* `0.1.1`, and is now historical).

> **Are you on `0.1.1`?** Confirm the running stack has: `apps/`-layout binary
> `phytomni-server` on `:8080`, the `phytomni` MySQL database with unprefixed
> plural tables (`users`, `question_agent_logs`, …), and `/api/v1/*` routes. If
> any of those are missing, production is **not** on `0.1.1` — do the
> [`history/repo-reorg-cutover.md`](history/repo-reorg-cutover.md) cutover
> first, then return here. See [`README.md`](README.md) for the version map.

**Nature of this release.** `0.1.2` is a **feature + hardening** release. Unlike
`0.1.1`, it needs **no database/table rename and no port move**. Everything is
**additive or dark-launched** — with no operator action beyond the deploy, the
runtime behavior is byte-identical to `0.1.1`. There is exactly **one required
data migration** (the permission-key rename, §3.1) and it must ship *with* the
frontend or the admin UI breaks. Full commit-level detail:
[`CHANGELOG.md`](../../CHANGELOG.md) under `0.1.2`.

---

## 0. Conventions

- **Secrets are placeholders** (`<JWT_SECRET>`, `<REDIS_PASSWORD>`, …) —
  substitute out-of-band on the server; never commit or paste real values.
- **(verify on-server)** marks facts that live only on the production host.
- **Wording.** "the current stack" = `0.1.1` running today; "this release" =
  `0.1.2`.

**Contents.**
1. [What changed](#1-what-changed-vs-011)
2. [Configuration surface](#2-configuration-surface-appyml--env)
3. [Operator actions (DB + coordination)](#3-operator-actions-db--coordination)
4. [Deploy sequence](#4-deploy-sequence)
5. [Verification & smoke](#5-verification--smoke)
6. [Rollback](#6-rollback)
7. [Dark-launch activation gates](#7-dark-launch-activation-gates-later--when-bot-is-ready)

---

## 1. What changed vs `0.1.1`

| Area | `0.1.1` | `0.1.2` | Operator action |
|---|---|---|---|
| Permission-gate identifiers | `tool_names` rows hold Chinese labels | Frontend matches **English** identifiers | **REQUIRED** — 8-row `UPDATE`, ship with frontend (§3.1) |
| Expert chat mode | not present | Selector + `mode` column, **dark** (`bot.expert_enabled=false`) | Optional — column + flag only when enabling (§3.2) |
| Chat streaming | blocking only | AG-UI SSE spine, **dark** (`bot.stream_enabled=false`) | None at deploy; gated flip later (§7) |
| Secrets | in `app.yml` | may inject `PHYTOMNI_JWT_SECRET` / `_DB_DSN` / `_REDIS_PASSWORD` from env | Optional (§2) |
| Redis pool | go-redis defaults | `pool_size` / `min_idle_conns` tunable | Optional (§2) |
| Gene-example serving | Bot relay | obsfs FUSE mount (`gene_obsfs_path`) + new public image route | None if `gene_obsfs_path` already set; else relay fallback (§2) |
| Server-task HTTP surface | present (unused) | **removed** | Ops drops the nginx `/v1/nky/server/` block on next window |
| Email download link | live | returns **410 Gone** (authed relay intact) | None — verify in smoke |
| Cron reconcilers | plain | panic-recovery + overlap-guard; admin `cron-entries` endpoint | None |
| JWT verification | HS256 | HS256 **pinned** (alg-confusion blocked) | None — existing tokens still valid |
| Auth revocation reads | two Redis calls | pipelined into one round-trip | None — fail-open unchanged |
| i18n | partial | backend messages + templates routed through i18n; G13 gate | None |

None of the "None" rows change runtime behavior at deploy — they are code-internal
or dark-launched. The only rows that gate the deploy are §3.1 (required) and, if
you choose to turn Expert on, §3.2.

---

## 2. Configuration surface (`app.yml` + env)

All new keys are **defaulted safe** — an unchanged `0.1.1` `app.yml` boots `0.1.2`
with identical behavior. The full current-state reference for **every** key is
[`configuration.md`](configuration.md); this section covers only the `0.1.2`
*additions*.

### 2.1 Environment-variable secret injection (optional)

Three secrets may be injected from the environment instead of `app.yml`:

| Env var | Overrides | Mechanism |
|---|---|---|
| `PHYTOMNI_JWT_SECRET` | `jwt.secret_key` | `viper.BindEnv` |
| `PHYTOMNI_DB_DSN` | the `db.<key>.dsn` | explicit `os.Getenv` |
| `PHYTOMNI_REDIS_PASSWORD` | `redis.clients.<name>.password` | explicit `os.Getenv` |

**Unset ⇒ the `app.yml` value wins ⇒ behavior byte-identical.** Set these only to
keep secrets out of the file. Do **not** set an empty value — an empty
`PHYTOMNI_JWT_SECRET` overrides the file with a blank secret.

### 2.2 Redis connection-pool knobs (optional)

```yaml
redis:
  clients:
    web:
      # pool_size: 0        # 0 = go-redis default (10 * CPU cores)
      # min_idle_conns: 0   # 0 = go-redis default
```

Leave unset (or `0`) for the go-redis defaults — no behavior change.

### 2.3 `gene_obsfs_path` (verify)

```yaml
gene_obsfs_path: ""   # obsfs FUSE mount root for gene-example data; empty ⇒ Bot relay fallback
```

If your `0.1.1` config already sets this (the obsfs migration predates `0.1.2`
in some deploys), no action. If empty, gene list/detail/images fall back to the
Bot relay (unchanged behavior). Set it to the mount root (e.g.
`/obs/<bucket>/.../gene-examples`) to serve from obsfs.

### 2.4 Dark-launch flags (leave OFF at deploy)

```yaml
bot:
  expert_enabled: false    # Expert routing mode — see §3.2 / §7.1
  stream_enabled: false    # AG-UI SSE streaming — see §7.2
```

Both default `false`. Keep them off for the `0.1.2` deploy — flipping them is a
**separate, Bot-coordinated** step (§7), not part of this upgrade.

---

## 3. Operator actions (DB + coordination)

### 3.1 Permission-key rename — REQUIRED, ship WITH the frontend

> **⚠️ Operator-only, and the local gate cannot catch a mistake here.** `0.1.2`
> translated the 8 UI permission **identifiers** from Chinese to English. These
> are **not** display copy — the SPA matches them verbatim against the
> backend-supplied `permission_list` (built from the `tool_names` table via
> `hasPermission(p) === permission_list.includes(p)`). If the new frontend is
> deployed while the `tool_names` rows still hold the Chinese values, **every
> `includes()` check returns `false` → all permission-gated admin/nav menu items
> silently disappear for every user.** The vitest fixtures were updated in
> lockstep, so the gate is green regardless of production data.

Run this `UPDATE` against the production `phytomni` DB **in the same window as the
`0.1.2` frontend deploy** (idempotent — the `WHERE` clause no-ops once renamed):

```sql
USE phytomni;
UPDATE tool_names SET tool_name = 'User management'            WHERE tool_name = '用户管理';
UPDATE tool_names SET tool_name = 'System monitor'             WHERE tool_name = '系统监控';
UPDATE tool_names SET tool_name = 'Role permission assignment' WHERE tool_name = '角色权限分配';
UPDATE tool_names SET tool_name = 'Global config'             WHERE tool_name = '全局策略配置';
UPDATE tool_names SET tool_name = 'Admin management'          WHERE tool_name = '管理员管理';
UPDATE tool_names SET tool_name = 'History'                   WHERE tool_name = '历史记录';
UPDATE tool_names SET tool_name = 'Profile management'        WHERE tool_name = '个人资料管理';
UPDATE tool_names SET tool_name = 'Cloud storage'             WHERE tool_name = '网盘空间';
```

**Rollback:** if you must serve the pre-`0.1.2` frontend again, reverse the
mapping (English → Chinese) in the same table. Frontend and this data always move
together.

### 3.2 Expert `mode` column — only if enabling Expert now

Expert ships **dark**; Instant works with no action. Skip this section unless you
are turning Expert on in the same window (and only after the Bot endpoint is
ready — §7.1). Adding the column early is harmless (additive, default-covered):

```sql
ALTER TABLE question_agent_logs
  ADD COLUMN mode VARCHAR(20) NOT NULL DEFAULT 'instant';
```

Existing rows get `'instant'`. Until Expert is fully activated (§7.1), the SPA
disables the Expert pill and the gateway returns **503** for any `mode=expert`
request — no Bot call.

---

## 4. Deploy sequence

`0.1.2` is a rebuild + redeploy — **no DB/table rename, no port change**. The
frontend and backend ship together (the frontend's English permission identifiers
require §3.1 in the same window).

1. **Back up** — MySQL dump of `phytomni`, the live `dist`, and `config/app.yml`.
2. **Build** the new Go binary and frontend `dist`:

   ```bash
   cd apps/server && GOTOOLCHAIN=auto go build -o phytomni-server .
   cd ../web && npm run build
   ```

3. **Apply §3.1** (the `tool_names` `UPDATE`) against production `phytomni`.
   If enabling Expert, also apply §3.2.
4. **Deploy** the new binary (restart the `phytomni-server` service) and copy the
   new `dist` into the nginx web root; `nginx -t && systemctl reload nginx`.
   Config additions from §2 are optional — an unchanged `app.yml` is fine.
5. **Smoke** (§5). If green, done.

> **Order note.** §3.1 and the frontend deploy belong in the **same window**.
> Applying the `UPDATE` a little early is safe (the old frontend sends Chinese
> identifiers, which still match until you swap `dist`); the failure mode is
> deploying the new `dist` *without* the `UPDATE`.

---

## 5. Verification & smoke

Baseline (unchanged from `0.1.1`): `GET /readyz` 200; login via
`POST /api/v1/auth/sessions`; a chat round-trip through
`POST /api/v1/conversations/0/messages`. Then the `0.1.2` additions:

- **Permission gate** — a permission-gated nav item (e.g. **User management**) is
  visible for an admin **after** the §3.1 `UPDATE`. If it is missing, the rename
  did not run — this is the one failure that the local gate cannot catch.
- **Gene images** — `GET /api/v1/gene-images/<gene>/<file>` returns a `200` image
  when `gene_obsfs_path` is mounted; a traversal attempt (`..%2F…`) returns
  `400`/`404`.
- **Cron inspection** — `GET /api/v1/admin/cron-entries` returns `200` for an
  admin, `403` for a non-admin.
- **Email download** — the legacy unauthenticated email download URL returns
  `410 Gone`; authenticated relay downloads still work.
- **Expert stays dark** (if not enabled) — the Expert pill is disabled and any
  `mode=expert` request returns `503`.
- **Streaming stays dark** — chat uses the blocking path; no SSE frames.

---

## 6. Rollback

`0.1.2` has **no irreversible step** (no table rename). To roll back to `0.1.1`:

1. Redeploy the previous `phytomni-server` binary and the previous `dist`;
   reload nginx.
2. **Reverse §3.1** — flip the `tool_names` rows English → Chinese (the previous
   frontend matches the Chinese identifiers). Frontend and this data always move
   together.
3. The `mode` column (if added in §3.2), the unique/pipelined Redis changes, and
   the JWT alg-pin are all additive/harmless to the `0.1.1` binary — leave them.
   Drop the `mode` column only if you want the schema pristine:
   `ALTER TABLE question_agent_logs DROP COLUMN mode;`.

**Frontend-only rollback:** restore the previous `dist` **and** reverse §3.1
together, then reload nginx.

---

## 7. Dark-launch activation gates (later — when Bot is ready)

Expert and streaming ship dark in `0.1.2`. Turning either on is a **separate,
Bot-coordinated** operation — not part of this upgrade. Each flip needs a Bot-side
capability **first**, documented authoritatively in
[`operations.md`](operations.md) §11. Summary:

### 7.1 Expert routing (`bot.expert_enabled`)

Order: (1) Bot serves `POST /v1/query/route`; (2) add the `mode` column (§3.2);
(3) set `bot.expert_enabled=true` and restart. Rollback = flip the flag back
(instant). Expert is blocking — it never streams.

### 7.2 AG-UI SSE streaming (`bot.stream_enabled` + `VITE_STREAM_ENABLED`)

> **⚠️ Load-bearing precondition.** The Bot must persist the **real accumulated
> answer** in its run record (not the `"[streamed]"` placeholder) **before** the
> flag flips, or reloading a streamed conversation overwrites the real answer.

Order: (1) Bot ships real-answer persistence; (2) flip `bot.stream_enabled=true`
**and** the frontend `VITE_STREAM_ENABLED` in lockstep; (3) smoke a streamed chat
+ reload to confirm the persisted answer survives. Rollback = flip both flags back
(instant; the blocking path is unchanged underneath). Streaming is Instant×chat
only — Expert and analyst/deep_genome async stay non-streaming.
