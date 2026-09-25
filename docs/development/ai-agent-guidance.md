# AI Development Guidance

Read the applicable OpenSpec change before editing. This repository owns
authentication, permissions, dialogue and visible-history persistence, the Go
gateway's finite Bot projection, and Vue presentation. Prompts, routing,
schemas, LangGraph orchestration, task execution, and artifact production stay
in `Phytomni-Bot`.

The pinned Bot export is `docs/reference/bot-public-agent-catalog.v1.json`.
Run `python scripts/check_public_agent_catalog.py` and the existing Bot/Web
compatibility gates after changing agent maps. A Web consumer of a new Bot
contract must preserve disabled/legacy behavior and deploy after Bot.

Use `make scoped` while iterating and `make full` for the complete local gate.
Frontend changes require guarded type-check, unit, build, and applicable visual
checks. Never infer GitHub required checks, production activation, deployment
approval, secrets, or live-provider behavior from local evidence.

Keep generated state in the path-scoped ignored roots `.gocache/`,
`.codex-test-cache/`, `.codex-runtime/`, `coverage/`, `test-results/`, or the
tool-owned `node_modules/.vite/` subtree. Run
`python scripts/check_generated_artifacts.py --check` before handoff. The
inventory separates ignored/generated violations from
`untracked_business_source`; the latter always remains reviewable and must not
be cleaned automatically. Report all dirty paths and identify pre-existing
user changes. If cleanup is authorized, resolve and inspect the exact ignored
directory first; never use `git clean`, reset, checkout, a broad recursive
glob, or a repository-root deletion as a validation step.

Read `operational-authority.md` and
`cross-repository-handoff-template.md` before cross-repository work.
