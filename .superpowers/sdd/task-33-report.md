# Task 33 remediation report

## Status

Remediated; local focused verification is green. The full service package
still has one pre-existing Task24 compatibility failure documented below.

## Remediation

- The strict Bot projection decoder now requires every `paths` value to remain
  within its validated `output_dir` for both `/obs/...` and `obs://...` forms.
- Download signing validates owner-scoped output/run containment. Bot relay
  listing keys may be relative (for example `user/runs/r1/output.zip`); the
  relative key is checked against a canonical in-memory prefix and the exact
  original key is retained for the signed `/v1/relay/obs/object` request.
- Direct bucket-child run roots (`/obs/bucket/run` and `obs://bucket/run`) no
  longer authorize sibling runs. Deeper run layouts continue to allow their
  existing sibling output directories, with regression fixtures made explicit.
- Vue projection parsing, `BotArtifactList`, and the Research, Gene Network,
  and Digital Design download validators accept both documented OBS forms and
  reject credentials, queries, traversal, malformed segments, and private
  diagnostics. The component keeps the legacy `download(path)` callback and
  `download` event path semantics; no raw path is emitted as a DOM title or
  href.
- Removed the unused `ProjectedArtifact`/`ProjectOwnedArtifacts` DTO and the
  unconnected run/name callback/API alias. A full owner/run/name endpoint is a
  separate scoped handler/store task and was not invented here.

## Files changed

- `apps/server/external/bot/answer_shape.go`
- `apps/server/service/api_service/bot_projection.go`
- `apps/server/service/api_service/gene.go`
- `apps/server/service/api_service/gene_test.go`
- `apps/server/service/api_service/bot_artifact_test.go`
- `apps/web/src/api/chat.ts`
- `apps/web/src/components/research/BotArtifactList.vue`
- `apps/web/src/views/chat/botProjection.ts`
- `apps/web/src/views/research-agent/index.vue`
- `apps/web/src/views/gene-network-agent/index.vue`
- `apps/web/src/views/digital-design-agent/index.vue`
- `apps/web/tests/unit/views/chat/botProjection.spec.ts`
- `apps/web/tests/unit/views/chat/botArtifactSafety.spec.ts`

## Verification

- `GOCACHE=/tmp/phytomni-go-cache go test ./service/api_service ./external/bot -run 'Test(ParseProjectionArtifacts|ArtifactPathWithinPrefix|DownloadAnalystAgentObs(File|Images)|ApiDownloadAnalystObsImages|ObsCache_)' -count=1` — PASS.
- `GOCACHE=/tmp/phytomni-go-cache go test ./external/bot -count=1` — PASS.
- `GOCACHE=/tmp/phytomni-go-cache go test ./service/api_service -count=1` — FAIL only at the known pre-existing `TestQueryRemoteMissingRunIDDoesNotPersistPollableRow` compatibility assertion (`unknown tool: invalid expert response`, expected `ErrMissingBotRunID`); no Task33 test failed.
- `npx --no-install vitest run tests/unit/views/chat/botProjection.spec.ts tests/unit/views/chat/botArtifactSafety.spec.ts tests/component/ResearchAgentView.spec.ts tests/component/GeneNetworkAgentView.spec.ts tests/component/DigitalDesignAgentView.spec.ts tests/component/ChatArtifactIntegration.spec.ts` — PASS (6 files, 52 tests).
- `npm run type-check` — PASS.
- `npm run build` — PASS.
- Scoped ESLint over the changed Web files — PASS with 0 errors (7 existing
  Prettier warnings in the remote-agent view templates/styles).
- `git diff --check` — PASS.

The repository-wide Web gate/build and full cross-package Go gate were not
claimed as green; the unrelated Task24 failure remains outside this fix.

## Follow-up

Implementing a server-issued `(run_id, basename)` owner/run/name download
endpoint requires a separately scoped handler and persistence task.
