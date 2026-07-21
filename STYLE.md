# Phytomni-Web Style Guide

This guide defines the repository style for code, tests, and documentation that
**contributors and CI share**. It is a curated, public subset of the repo-root
`CLAUDE.md`: the security invariants (v-html sanitization, Redis-backed auth,
audit-log redaction), the per-subproject architecture detail, and the
AI-agent-specific workflow rules stay in `CLAUDE.md` and are the authoritative
source. When the two ever disagree, `CLAUDE.md` wins.

## Languages and formatting

- **`apps/web`** — TypeScript and Vue SFCs under `apps/web/src/`. Keep `@/`
  imports (`@/` maps to `apps/web/src/`). Let ESLint + Prettier normalize
  formatting; do not hand-format.
- **`apps/server`** — Go 1.23. Format with `gofmt` (gate check G5). Keep package
  names short and lowercase; the package log alias is `rxLog` (`rxLog.Sugar()`).
- **Python** (scripts) — PEP 8, `snake_case`.

## Single-language policy

Comments, string literals, console/log output, tests, docs, and config/CI/script
text are **English**. Chinese is confined to a small, enforced allow-list:

- `apps/web/src/locales/langs/zh-CN.ts` and
  `apps/server/common/i18n/locales/zh-CN.toml` **values** (the localized UI copy).
- The ICP filing identifier in the Vue footer/chat templates, the `中文` label on
  the language toggle, the agent display names in `constants/agents.ts`, and the
  other documented fixtures.

All other Vue `<template>` display copy routes through i18n `t('key')` calls.
This is enforced by **G13** (`scripts/check_i18n.py`, strict mode) — do not
reintroduce Chinese outside the allow-list, and do not translate the allow-listed
surfaces.

## Naming

- Vue components: `PascalCase.vue`. Composables: `useThing.ts`. Views live under
  `apps/web/src/views/<feature>/`.
- Go: exported identifiers `PascalCase`, unexported `camelCase`; error sentinels
  are `ErrThing` wrapped with `fmt.Errorf("%w …", …)` so callers can `errors.Is`.
- Tests: `*.spec.ts` / `*.test.ts` (frontend), `*_test.go` (Go).

## Adding a Go endpoint

Follow the existing layering top-to-bottom: `http/router` → `http/handler` →
`service/api_service` → `model` (GORM tables) / external integrations. Define the
model in `model/`, business logic in `service/`, the handler in `http/handler/`,
and wire the route in `http/router/`. Cross-cutting code lives in `middleware/`,
`common/`, and `utils/`.

## Adding per-chat UI state

The chat surface keeps every dialogue's state in a single `chatStates` map keyed
by `dialogueId`. **Never add a top-level `ref` for per-chat state** — add a field
to the `chatStates` record and expose it through a `computed` proxy. See
[`apps/web/docs/parallel-chat-state.md`](apps/web/docs/parallel-chat-state.md).

## Commit convention

Subjects are `<emoji> Category: Capitalized imperative` with a **required** `- `
bullet body — first bullet the gap/why, then what changed. English only, **no**
`Co-Authored-By` trailer, **no** local plan/phase/task tokens in messages or
source comments.

| Emoji | Category | Use for                                      |
| ----- | -------- | -------------------------------------------- |
| ✨    | `Add`    | New capability                               |
| 🐛    | `Fix`    | Bug fix                                      |
| 📝    | `Docs`   | Documentation                                |
| 🧪    | `Tests`  | Test-only changes                            |
| ♻️    | `Reorg`  | Behavior-preserving rename/move/refactor     |
| 🎨    | `Style`  | Formatting / re-wrap with no behavior change |

See [CONTRIBUTING.md](CONTRIBUTING.md) for the setup and gate, and the
[CHANGELOG](CHANGELOG.md) for how commits are grouped into releases.

## Change discipline

Prefer the smallest viable change; do not perform unrelated refactors or
reformat adjacent code. Every changed line should trace to the task. Only remove
dead code your change orphans. Judge the risk level before starting: auth,
user-data, DB-schema, audit, and production-config changes are high-risk and
warrant a plan and tests before editing — the full risk ladder is in `CLAUDE.md`.
