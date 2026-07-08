# Design: MySQL history → Bot run-registry ETL (Web source contract)

Status: **design only — not implemented.** This note is the Web-side counterpart
to Bot's [`docs/design/etl-web-mysql-history.md`](https://github.com/Phytomni/Phytomni-Bot/blob/main/docs/design/etl-web-mysql-history.md).
That design owns the target (Bot's SQLite `runs` table), the transform, and the
load; it explicitly defers the **source** schema to the Web repo. This document
fills that gap: it pins the authoritative source tables, columns, and row grain
in the current `apps/server` schema, so the ETL — when built on the Bot side —
has a confirmed source contract instead of the stale, pre-`0.1.1` names Bot's
`§3.2 (NEEDS CONFIRMATION)` still references.

There is no Web-side artifact to build here. The ETL script lives in the Bot
repo (`scripts/etl_web_mysql_history.py`, not yet written). Web's only obligation
is to keep this source contract accurate as the schema evolves and to preserve
the JOIN keys the migrated rows depend on.

## 1. Why this document exists

Under the candidate-A consumer model, Bot becomes the single owner of run/turn
history. The Bot `runs` table starts empty at cutover, so a history read for any
conversation predating Bot persistence returns nothing. The ETL backfills that
history. Bot's design correctly refuses to invent the Web source schema — it
names `nky_client_go/model/table.go` and `s_*`-prefixed tables, which are the
**pre-`0.1.1`** layout. After the repo reorg those names are wrong. This note
supplies the current truth.

## 2. Source of truth (current schema)

The Web MySQL schema is owned by
[`apps/server/model/table.go`](../../apps/server/model/table.go). History lives
in **one** table:

| Bot §3.2 asked for                         | Current Web answer                          |
| ------------------------------------------ | ------------------------------------------- |
| History table (was `s_question_agent_logs`)| **`question_agent_logs`** (no `s_` prefix)  |
| Schema owner (was `nky_client_go/...`)     | **`apps/server/model/table.go`** (`QuestionAgentLog`) |
| Per-turn grain                             | one row per turn, keyed by `dialogue_id` + `f_id` (parent id) |
| Cross-service run identifier               | **`bot_run_id`** column (`varchar(64)`, nullable) |

### 2.1 Column map (`question_agent_logs` → Bot `runs`)

Column names are verbatim from `QuestionAgentLog`. Bot's target columns are from
its `_CREATE_RUNS_DDL`.

| Web column (`question_agent_logs`) | → | Bot `runs` column | Notes                                          |
| ---------------------------------- | - | ----------------- | ---------------------------------------------- |
| `bot_run_id`                       | → | `run_id`          | **JOIN key.** Carry verbatim when present (see §3). |
| `dialogue_id`                      | → | `dialogue_id`     | JOIN key for Web Go history reads. Carry verbatim. |
| `query`                            | → | `query`           | User question text.                            |
| `answer`                           | → | `result_json`     | Wrap in Bot's answer envelope; do not clobber if blank. |
| `tool_name`                        | → | `agent`/`tool_name`| Alias → canonical slug via Bot `legacy_aliases`; keep the raw value for display. |
| `mode`                             | → | `request_json`    | `'instant'` / `'expert'`; carry as request metadata. |
| `model`  (n/a — Web does not store)| → | `model`           | Leave NULL; Web has no per-turn model column.  |
| `status`                           | → | `status`          | Map to Bot terminal (`succeeded` / `failed`).  |
| `created_at`                       | → | `created_at`      | Convert MySQL `datetime` → ISO-8601 UTC.       |
| `updated_at`                       | → | `updated_at`      | Same conversion.                               |
| — (constant)                       | → | `origin`          | New value `"web_etl"` (Bot §8 open decision).  |
| — (constant)                       | → | `expires_at`      | **NULL** so TTL GC never reaps backfilled history. |

Rows are soft-deleted via `delete_at` (nullable) — the extract MUST filter
`delete_at IS NULL` so tombstoned turns do not resurface as history.

## 3. The `bot_run_id` gap (the one real open question)

`bot_run_id` is populated only for rows written **after** the Bot relay cutover
(streamed and blocking chat both persist the Bot run-registry id). Rows older
than the cutover have `bot_run_id = ''` / NULL. So:

- **Rows with `bot_run_id`** — map straight onto Bot `runs.run_id`. Idempotent by
  construction (a second ETL run `INSERT OR IGNORE`s the same id).
- **Rows without `bot_run_id`** — the ETL must **synthesize** a deterministic
  `run_id` (Bot §5: an `IdFactory`-formatted hash of a stable Web key). The
  stable key here is `(dialogue_id, f_id)` — both `NOT NULL`, jointly unique per
  turn. This keeps the load idempotent without a real Bot run id.

This is the single mapping decision the Bot-side transform cannot make alone; it
is resolved here.

## 4. What stays out of scope

- **No write-back to MySQL.** The ETL is read-only against
  `question_agent_logs`; the DSN user should have `SELECT`-only grants.
- **No live dual-write / CDC.** An incremental top-up is a bounded
  `--since <created_at watermark>` re-run, not a stream (Bot §2).
- **`task_log` / analyst artifacts** — deferred with the rest of the async-task
  history; the in-scope cut migrates chat turns only.
- **No Web code change.** If the schema gains a per-turn `model` column or the
  history grain changes, update §2 here and notify the Bot maintainer; the
  extract query is authored Bot-side.

## 5. Handoff

The implementable roadmap, idempotency model, `RunRegistry` backfill seam, and
testing strategy are all in Bot's design §4–§7. This document is the prerequisite
its §3.2 asked for. When the ETL is scheduled, the first roadmap gate ("confirm
source schema") reads **this file** instead of reverse-engineering `table.go`.
