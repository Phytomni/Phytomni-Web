# AI Operational Authority

AI may inspect, design, edit scoped source, run local offline checks, and
prepare evidence. Explicit human/environment authority is required for secrets,
paid or live-provider calls, production data, destructive migrations, merges,
deployments, feature-flag activation, and releases.

Repository evidence on 2026-08-18 shows workflow `CI` with jobs `hygiene`,
`frontend-static`, `frontend-runtime`, `server-static`, `server-runtime`, and
`contracts`. No `CODEOWNERS` file is present. This does not prove which checks
branch protection currently requires or who may approve; confirm both in
GitHub/operations before merge.

Local `make full` is local evidence only. It does not prove external CI,
staging, production, Bot-owner acceptance, or feature activation.
