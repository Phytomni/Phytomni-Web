# Bot Cutover Ops Runbook

Operator procedures for the Web Go ↔ Phytomni-Bot `/query` cutover
(candidate-A: Web Go is the single gateway, Bot is internal-only). All
examples are scrubbed — never paste real keys, tokens, or DSNs into this
file or into commits.

Architecture reference: `1.phytomni/.claude/reference/Web-Bot-目标架构.md`.
The gateway is dormant until `bot.proxy_enabled=true`.

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
   - `git rm -rf nky_client_python/` + remove the Python systemd unit (ops)
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
     as "历史数据已不再提供下载" — expected, forward-only policy.

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
   + soak.
2. **After the delete:** `git revert` the cutover commit to restore the
   Python service from history, redeploy it, repoint `/query` at the Python
   port, restart. The `bot_run_id` column stays (harmless, nullable).
3. `ApiAnswerCheck` serves MySQL legacy fields while the gateway is off, so
   history replay keeps working in either window.

## 9. Degraded mode (Bot unavailable)

- Startup: with `proxy_enabled=true`, Web Go fails fast if Bot `/v1/agents`
  is unreachable or missing a required slug. With `proxy_enabled=false`,
  Web Go boots without contacting Bot.
- Runtime: `/query` returns a 5xx with an operator-actionable log when Bot
  is down; `/v1/answer/check` degrades to MySQL legacy fields rather than
  failing. Web Go itself never crashes on Bot trouble.
