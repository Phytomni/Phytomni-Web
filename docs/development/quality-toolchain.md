# Development quality-toolchain approval packet

Status: **Task 60 runners approved; Task 68 gate activation verified locally, pending commit and remote CI** (2026-07-21).

This packet evaluates the tools proposed for the repository-level quality gate
and records the implementation boundary approved by the human reviewer. The
approval covers four checksum-pinned official binaries on Linux amd64; Task 68
now wires them into the local gates, hooks, scoped path, and CI jobs without
changing dependency manifests. The activation is verified locally but remains
uncommitted and has not yet received a remote GitHub Actions run.

## Decision summary

| Tool                  | Requested pin                       | Scope                                                               | Current decision                                                             |
| --------------------- | ----------------------------------- | ------------------------------------------------------------------- | ---------------------------------------------------------------------------- |
| Staticcheck           | release `2025.1.1`, module `v0.6.1` | Go correctness, deprecation, and dead-code analysis beyond `go vet` | Approved official binary; Linux amd64 mapping only; no Go toolchain download |
| ShellCheck            | `0.10.0`                            | Shell semantic and error-path analysis                              | Approved official archive; Linux amd64 mapping only                          |
| shfmt                 | `v3.10.0`                           | Deterministic shell formatting                                      | Approved official binary; Linux amd64 mapping only                           |
| actionlint            | `v1.7.4`                            | GitHub Actions schema, expression, and shell semantics              | Approved official binary; Linux amd64 mapping only                           |
| Prettier              | existing npm package `2.7.1`        | Markdown, YAML, and JSON formatting                                 | Existing dependency; no new approval or lockfile change requested            |
| Python stdlib checker | observed Python `3.12.13`           | Small offline Markdown/JSON/YAML and generated-document contracts   | Existing runtime; no third-party package proposed                            |

The rejected alternatives are intentionally recorded. They are not equivalent
quality gates: `go vet` did not report the measured Staticcheck findings, `sh -n`
only parses shell syntax, manual formatting is not deterministic, and a YAML
parser does not understand GitHub Actions expressions or action metadata.

## Evidence boundary and approval rules

- Approved external tools are installed only in the ignored, versioned cache on
  the captured Linux amd64 checkout. The absence of a binary on another
  platform is evidence about that environment only; it is not evidence that
  the tool is unsuitable.
- Every item marked **Needs Verification** must be resolved from the exact
  installed source or release artifact before it is promoted into CI or a hook.
  The approval record must include the observed command, date, platform, and
  digest; this document must then be updated.
- A warm-cache success does not authorize a network fallback. Runners must
  fail closed when the approved version, platform, digest, or toolchain is not
  available.
- No version floating (`latest`, an unqualified `go install`, or a system PATH
  fallback) is allowed in a gate. Version and platform belong in every cache key.
- The rejected module-install path `GOTOOLCHAIN=auto go install ...` is retained
  in this record as a supply-chain risk; approved runners use release binaries.
- The human approval recorded below authorizes Task 60's four pinned runners;
  Task 68 records the separately approved activation boundary. Commit, push,
  and remote CI execution remain explicit follow-up actions.

## Tool records

### Official metadata collected after the initial packet

The upstream project metadata currently identifies Staticcheck as MIT,
ShellCheck as GPLv3, shfmt as BSD-3-Clause, and actionlint as MIT. The initial
source-level candidates were provisional; the approved Linux amd64 evidence
below supersedes those placeholders for the captured assets. The Staticcheck 2025.1.1 release notes identify its
prebuilt binaries as built with Go 1.24.1; shfmt v3.10.0 identifies binaries
built with Go 1.23.2. This supports choosing checksum-pinned official binaries
when automatic Go toolchain downloads are not approved. The official
ShellCheck v0.10.0 asset listing reports a 2.29 MB Linux x86_64 archive; a
cross-source pinned-tool record reports 2,404,716 bytes and the provisional
SHA-256 `6c881ab0698e4e6ea235245f22832860544f17ba386442fe7e9d629f8cbedf87`
([Pants known versions](https://www.pantsbuild.org/2.28/docs/reference-shellcheck)).
This digest was not treated as approved evidence until it was checked against
the downloaded GitHub asset locally; the check is recorded below.

### Approved Linux amd64 evidence

The approved Linux amd64 assets were downloaded and verified on 2026-07-21;
the files live only in the ignored local cache. The SHA-256 values below match
the official release checksum files where the release publishes one, and the
ShellCheck value was independently matched to the downloaded official asset.

| Tool        | Release asset and SHA-256                                                                                    | Download / installed size    | Version probe                  | License evidence                                                       |
| ----------- | ------------------------------------------------------------------------------------------------------------ | ---------------------------- | ------------------------------ | ---------------------------------------------------------------------- |
| Staticcheck | `staticcheck_linux_amd64.tar.gz`; `ae320e410225295ecb2a2cd406113e3c2fe40521aaed984dd11dc41a0a50b253`         | 8,275,442 / 15,267,095 bytes | `staticcheck 2025.1.1 (0.6.1)` | MIT verified from the extracted `staticcheck/LICENSE`                  |
| ShellCheck  | `shellcheck-v0.10.0.linux.x86_64.tar.xz`; `6c881ab0698e4e6ea235245f22832860544f17ba386442fe7e9d629f8cbedf87` | 2,404,716 / 15,659,432 bytes | `version: 0.10.0`              | GPLv3 verified from the extracted `shellcheck-v0.10.0/LICENSE.txt`     |
| shfmt       | `shfmt_v3.10.0_linux_amd64`; `1f57a384d59542f8fac5f503da1f3ea44242f46dff969569e80b524d64b71dbc`              | 2,850,968 / 2,850,968 bytes  | `v3.10.0`                      | BSD-3-Clause verified from the tagged v3.10.0 source archive `LICENSE` |
| actionlint  | `actionlint_1.7.4_linux_amd64.tar.gz`; `fc0a6886bbb9a23a39eeec4b176193cadb54ddbe77cdbb19b637933919545395`    | 2,068,772 / 5,103,768 bytes  | `1.7.4`                        | MIT verified from the extracted `LICENSE.txt`                          |

These records authorize only the Linux amd64 mappings currently implemented
by the runners. Other platforms fail closed until their official assets and
hashes receive the same evidence treatment.

For Linux amd64, these records supersede the initial per-tool **Needs
Verification** placeholders for license, integrity, and artifact size. **Needs
Verification** remains for unsupported platforms, future asset refreshes, and
cold/warm timing measurements that were not captured during this implementation
run.

### Staticcheck

| Field                                    | Record                                                                                                                                                                                                                                                |
| ---------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Exact version / module                   | Release `2025.1.1`; module `honnef.co/go/tools/cmd/staticcheck@2025.1.1` (module release reports tool version `v0.6.1`)                                                                                                                               |
| Need                                     | Find Go correctness, deprecation, and dead-code issues that the current `go vet` gate does not report; the plan measured 14 such findings.                                                                                                            |
| Upstream URL                             | [release 2025.1.1](https://github.com/dominikh/go-tools/releases/tag/2025.1.1); [module documentation](https://pkg.go.dev/honnef.co/go/tools/cmd/staticcheck)                                                                                         |
| License — verified from installed source | `MIT`, verified from the extracted Linux amd64 release at `staticcheck/LICENSE`; non-Linux assets remain **Needs Verification**.                                                                                                                      |
| Maintainer / release source              | Dominik Honnef's `go-tools` repository and its signed/tagged release page above; verify the tag and source revision during installation.                                                                                                              |
| Install method                           | Download the exact official release archive, verify its SHA-256, extract one binary into the versioned cache, and invoke it only through this runner. The rejected Go-module path would permit a toolchain download.                                  |
| Cryptographic integrity                  | Approved archive SHA-256: `ae320e410225295ecb2a2cd406113e3c2fe40521aaed984dd11dc41a0a50b253`; the runner rejects a mismatch before extraction.                                                                                                        |
| Cached path                              | `.cache/phytomni/staticcheck-2025.1.1/<os>-<arch>/staticcheck`; the cache key includes the exact release and platform.                                                                                                                                |
| Approximate download / install size      | Linux amd64 archive `8,275,442` bytes; extracted binary `15,267,095` bytes. Other platforms remain **Needs Verification**.                                                                                                                            |
| Cold / warm timing                       | **Needs Verification** — exact version probes were run both after download and from the offline cache, but `/usr/bin/time` measurements were not captured.                                                                                            |
| Network behavior                         | Network is needed only on a cache miss. The approved runner never downloads a Go toolchain and warm-cache runs are offline; missing assets fail closed.                                                                                               |
| CI cache key                             | Implemented shared key: `phytomni-web-quality-${{ runner.os }}-${{ runner.arch }}-${{ hashFiles('scripts/*_runner.sh', 'scripts/quality_runner_common.sh') }}` via `actions/cache@v4`; do not key only by branch or `latest`.                         |
| Security implications                    | Static analysis reads source and build metadata. Downloaded binaries are supply-chain inputs; verify the release digest, constrain `PATH`, avoid executing repository-provided code during installation, and do not print credentials in diagnostics. |
| Local failure mode                       | Missing, wrong-version, wrong-platform, or unverified binary fails the gate with an actionable error; there is no silent fallback to `go vet` or PATH.                                                                                                |
| Alternatives                             | Keep `go vet` as a complementary baseline. It is not an equivalent replacement because it missed the measured findings. A checksum-pinned official binary is the preferred alternative to a module build if toolchain download is rejected.           |
| Rollback                                 | Remove the Staticcheck runner/cache and its gate invocation; restore the existing `go vet`-only path. No application or lockfile rollback is required.                                                                                                |

### ShellCheck

| Field                                    | Record                                                                                                                                                                                                |
| ---------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Exact version / module                   | Release `0.10.0` (standalone binary; no Go/npm module)                                                                                                                                                |
| Need                                     | Detect shell quoting, expansion, error-path, and portability defects in tracked scripts and hooks.                                                                                                    |
| Upstream URL                             | [release v0.10.0](https://github.com/koalaman/shellcheck/releases/tag/v0.10.0); [source repository](https://github.com/koalaman/shellcheck)                                                           |
| License — verified from installed source | `GPLv3`, verified from the extracted Linux amd64 release at `shellcheck-v0.10.0/LICENSE.txt`; non-Linux assets remain **Needs Verification**.                                                         |
| Maintainer / release source              | Koalaman/ShellCheck project and the v0.10.0 release assets above; select the asset matching OS and architecture.                                                                                      |
| Install method                           | Download the exact official release archive, verify its SHA-256, extract one binary into the versioned cache, and invoke it only through this runner. Do not use an unpinned package-manager version. |
| Cryptographic integrity                  | Approved archive SHA-256: `6c881ab0698e4e6ea235245f22832860544f17ba386442fe7e9d629f8cbedf87`; the runner rejects a mismatch before extraction.                                                        |
| Cached path                              | `.cache/phytomni/shellcheck-0.10.0/<os>-<arch>/shellcheck`; the cache key includes the exact release and platform.                                                                                    |
| Approximate download / install size      | Linux amd64 archive `2,404,716` bytes; extracted binary `15,659,432` bytes. Other platforms remain **Needs Verification**.                                                                            |
| Cold / warm timing                       | **Needs Verification** — exact version probes were run both after download and from the offline cache, but `/usr/bin/time` measurements were not captured.                                            |
| Network behavior                         | Network is needed only for a cache miss and metadata/artifact retrieval. A warm run must not contact the network; checksum failure or unavailable asset is a hard failure.                            |
| CI cache key                             | Implemented shared key: `phytomni-web-quality-${{ runner.os }}-${{ runner.arch }}-${{ hashFiles('scripts/*_runner.sh', 'scripts/quality_runner_common.sh') }}` via `actions/cache@v4`.                |
| Security implications                    | ShellCheck analyzes scripts but does not need production credentials. Treat the downloaded archive as untrusted until hashed; extract into a non-world-writable cache and invoke by absolute path.    |
| Local failure mode                       | Missing binary, unsupported platform, digest mismatch, or an unapproved version fails closed with the expected asset and verification command.                                                        |
| Alternatives                             | `sh -n` remains useful as a syntax smoke check but cannot replace semantic analysis. A distribution package is acceptable only if it supplies the exact version and independently recorded digest.    |
| Rollback                                 | Remove the ShellCheck runner/cache and its gate invocation; retain `sh -n` and existing tests.                                                                                                        |

### shfmt

| Field                                    | Record                                                                                                                                                                                  |
| ---------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Exact version / module                   | Release/module `mvdan.cc/sh/v3/cmd/shfmt@v3.10.0`                                                                                                                                       |
| Need                                     | Enforce deterministic formatting for tracked shell and hook files so review diffs are stable.                                                                                           |
| Upstream URL                             | [release v3.10.0](https://github.com/mvdan/sh/releases/tag/v3.10.0); [module documentation](https://pkg.go.dev/mvdan.cc/sh/v3/cmd/shfmt)                                                |
| License — verified from installed source | `BSD-3-Clause`, verified from the tagged v3.10.0 source archive `LICENSE`; non-Linux assets remain **Needs Verification**.                                                              |
| Maintainer / release source              | mvdan/sh project and the tagged v3.10.0 release above.                                                                                                                                  |
| Install method                           | Download the exact official release binary, verify its SHA-256, and place it in the versioned cache. The runner does not invoke `go install` or download a toolchain.                   |
| Cryptographic integrity                  | Approved binary SHA-256: `1f57a384d59542f8fac5f503da1f3ea44242f46dff969569e80b524d64b71dbc`; the runner rejects a mismatch before caching.                                              |
| Cached path                              | `.cache/phytomni/shfmt-v3.10.0/<os>-<arch>/shfmt`; the cache key includes the exact release and platform.                                                                               |
| Approximate download / install size      | Linux amd64 binary `2,850,968` bytes. Other platforms remain **Needs Verification**.                                                                                                    |
| Cold / warm timing                       | **Needs Verification** — exact version probes were run both after download and from the offline cache, but `/usr/bin/time` measurements were not captured.                              |
| Network behavior                         | Network is needed only on a cache miss. Warm-cache runs are offline; unsupported platforms and missing assets fail closed.                                                              |
| CI cache key                             | Implemented shared key: `phytomni-web-quality-${{ runner.os }}-${{ runner.arch }}-${{ hashFiles('scripts/*_runner.sh', 'scripts/quality_runner_common.sh') }}` via `actions/cache@v4`.  |
| Security implications                    | Formatting is a write-capable operation; CI should run diff mode, while local write mode must be explicit. Pin the binary and never execute a downloaded formatter from a mutable PATH. |
| Local failure mode                       | Missing/incorrect binary or integrity evidence fails closed; the gate must report the exact cache path and approved pin.                                                                |
| Alternatives                             | Manual formatting is nondeterministic. Prettier owns Markdown/YAML/JSON; shfmt is limited to shell and should not be replaced by a second shell formatter.                              |
| Rollback                                 | Remove the shfmt runner/cache and gate invocation; preserve shell syntax checks and existing source.                                                                                    |

### actionlint

| Field                                    | Record                                                                                                                                                                                         |
| ---------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Exact version / module                   | Release/module `github.com/rhysd/actionlint/cmd/actionlint@v1.7.4`                                                                                                                             |
| Need                                     | Validate GitHub Actions workflow schema, expressions, action metadata, and embedded shell semantics.                                                                                           |
| Upstream URL                             | [release v1.7.4](https://github.com/rhysd/actionlint/releases/tag/v1.7.4); [source repository](https://github.com/rhysd/actionlint)                                                            |
| License — verified from installed source | `MIT`, verified from the extracted Linux amd64 release `LICENSE.txt`; non-Linux assets remain **Needs Verification**.                                                                          |
| Maintainer / release source              | rhysd/actionlint project and the tagged v1.7.4 release above.                                                                                                                                  |
| Install method                           | Download the exact official release archive, verify its SHA-256, extract one binary into the versioned cache, and invoke it only through this runner. The runner does not invoke `go install`. |
| Cryptographic integrity                  | Approved archive SHA-256: `fc0a6886bbb9a23a39eeec4b176193cadb54ddbe77cdbb19b637933919545395`; the runner rejects a mismatch before extraction.                                                 |
| Cached path                              | `.cache/phytomni/actionlint-v1.7.4/<os>-<arch>/actionlint`; the cache key includes the exact release and platform.                                                                             |
| Approximate download / install size      | Linux amd64 archive `2,068,772` bytes; extracted binary `5,103,768` bytes. Other platforms remain **Needs Verification**.                                                                      |
| Cold / warm timing                       | **Needs Verification** — exact version probes were run both after download and from the offline cache, but `/usr/bin/time` measurements were not captured.                                     |
| Network behavior                         | Network is needed only on a cache miss. Warm-cache runs are offline; workflow metadata is parsed without executing arbitrary workflow steps. Unsupported platforms fail closed.                |
| CI cache key                             | Implemented shared key: `phytomni-web-quality-${{ runner.os }}-${{ runner.arch }}-${{ hashFiles('scripts/*_runner.sh', 'scripts/quality_runner_common.sh') }}` via `actions/cache@v4`.         |
| Security implications                    | This tool parses CI configuration that controls secrets and deployments. Pin it, verify integrity, run it before any workflow execution, and treat diagnostics as untrusted text.              |
| Local failure mode                       | Missing/incorrect/unverified tool fails closed and identifies the expected version/cache path. YAML parsing alone remains insufficient.                                                        |
| Alternatives                             | A YAML parser can catch indentation and syntax errors but not Actions expressions, event contexts, or action metadata. Use it only as a complementary check.                                   |
| Rollback                                 | Remove the actionlint runner/cache and gate invocation; retain the existing YAML/CI contract tests.                                                                                            |

### Prettier (existing dependency)

| Field                                    | Record                                                                                                                                                                              |
| ---------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Exact version / package                  | npm package `prettier@2.7.1` already declared in `apps/web/package.json` and locked in `apps/web/package-lock.json`                                                                 |
| Need                                     | Own Markdown, YAML, and JSON formatting without introducing a second formatter.                                                                                                     |
| Upstream URL                             | [release 2.7.1](https://github.com/prettier/prettier/releases/tag/2.7.1); [npm package](https://www.npmjs.com/package/prettier/v/2.7.1)                                             |
| License — verified from installed source | `MIT`, verified in `apps/web/node_modules/prettier/package.json` for the installed 2.7.1 package. Recheck after every lockfile refresh.                                             |
| Maintainer / release source              | Prettier project and npm registry package above.                                                                                                                                    |
| Install method                           | No new installation. Use the lockfile-resolved package and invoke `apps/web/node_modules/.bin/prettier`; CI may use `npm ci` from the existing lockfile.                            |
| Cryptographic integrity                  | Existing lockfile integrity: `sha512-ujppO+MkdPqoVINuDFDRLClm7D78qbDt0/NR+wp5FqEZOoTNAjPHWj17QRhu7geIHJfcNhRk1XVQmF8Bp3ye+g==`. Do not replace it with a floating registry install. |
| Cached path                              | `apps/web/node_modules/prettier` (local dependency cache); CI cache remains keyed by the lockfile hash.                                                                             |
| Approximate download / install size      | Installed tree measured at approximately 16 MiB in this checkout; registry download size is **Needs Verification** for the platform/cache report.                                   |
| Cold / warm timing                       | `prettier --check apps/web/package.json`: approximately 0.21 s first invocation and 0.22 s warm invocation locally; this is a format-check timing, not an npm install benchmark.    |
| Network behavior                         | The existing package is offline-usable after `npm ci` or a populated npm cache. Do not make the quality gate run `npm install` or mutate the lockfile.                              |
| CI cache key                             | Existing npm cache plus lockfile hash; proposed tool-specific suffix `prettier-2.7.1-${hashFiles('apps/web/package-lock.json')}`.                                                   |
| Security implications                    | Formatter executes JavaScript from the locked package. Keep npm audit/lockfile review in dependency maintenance and never pass secrets or production paths to formatter plugins.    |
| Local failure mode                       | Missing `node_modules` or a lockfile/package mismatch fails before formatting; do not silently use a different global Prettier.                                                     |
| Alternatives                             | None requested. Adding another Markdown/YAML/JSON formatter would create conflicting ownership and is rejected.                                                                     |
| Rollback                                 | Revert only the new repository-tool invocation; keep the existing package declaration and lockfile unchanged.                                                                       |

### Python stdlib checker

| Field                                    | Record                                                                                                                                                                         |
| ---------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Exact version / package                  | Observed `Python 3.12.13`; implementation uses the standard library only (`pathlib`, `json`, `re`, and `unittest`/pytest discovery). No third-party package or lockfile entry. |
| Need                                     | Provide small offline contract checks for this document, generated ledgers, and bounded Markdown/JSON/YAML metadata before broader dependencies are approved.                  |
| Upstream URL                             | [Python 3.12 documentation](https://docs.python.org/3.12/); [PSF license](https://docs.python.org/3.12/license.html)                                                           |
| License — verified from installed source | **Needs Verification** for the exact runtime image; verify `sysconfig.get_paths()['stdlib']` and the bundled license during CI image review. The PSF license is linked above.  |
| Maintainer / release source              | Python Software Foundation release and the interpreter image selected by CI.                                                                                                   |
| Install method                           | None. Use the repository's existing Python runtime and `uv run --no-sync` only to invoke the already-declared test environment.                                                |
| Cryptographic integrity                  | No new artifact. Verify the CI base image/runtime through the platform's existing image digest policy.                                                                         |
| Cached path                              | System/CI Python runtime; no project-owned binary cache.                                                                                                                       |
| Approximate download / install size      | No additional download or install; runtime footprint is owned by the base image and is **Needs Verification** per CI image.                                                    |
| Cold / warm timing                       | **Needs Verification** per CI image; local contract tests are expected to remain sub-second once pytest is available.                                                          |
| Network behavior                         | Tests and the checker itself are offline. Dependency resolution must not be triggered by this checker.                                                                         |
| CI cache key                             | N/A for the checker; use the existing Python/uv environment key and invalidate it with the lockfile/config hash.                                                               |
| Security implications                    | Keep parsing bounded and escape-free: never execute Markdown/YAML, load arbitrary modules, or follow remote URLs.                                                              |
| Local failure mode                       | Unsupported Python, malformed input, or a contract mismatch exits non-zero with the path and violated field.                                                                   |
| Alternatives                             | Adding a broad Markdown/YAML dependency is deferred; the stdlib checker covers the narrow contracts needed for this approval packet.                                           |
| Rollback                                 | Remove the checker test and its gate invocation; no runtime or dependency rollback is needed.                                                                                  |

## Approval record and implementation boundary

The human reviewer approved Task 60 on 2026-07-21 with the following scope:

1. Use Staticcheck `2025.1.1` (`0.6.1`), ShellCheck `0.10.0`, shfmt
   `v3.10.0`, and actionlint `v1.7.4`.
2. Use the official checksum-pinned release assets and the versioned cache root
   `.cache/phytomni`, with Linux amd64 as the only currently approved mapping.
3. Reject automatic Go toolchain downloads; no `go install`, floating version,
   arbitrary PATH fallback, or unverified download is allowed.
4. Keep the runners fail closed and forward arguments without `eval`.

This approval allowed implementation and local verification of the runners.
Task 68 activates CI, hooks, and repository gates through the checked-in
scripts, while this worktree intentionally remains uncommitted and unpushed.
Non-Linux assets, CI-image evidence, the remote workflow run, and cold/warm
timing remain follow-up verification items.

## Verification record

Observed on 2026-07-21 in this checkout:

- Python `3.12.13`, Go `1.22.2`, Node `v26.5.0`, Linux `x86_64`.
- The four approved binaries were downloaded from their official release pages,
  checksum-verified, and installed only in the ignored Linux amd64 cache. The
  exact version probes also pass with `QUALITY_RUNNER_OFFLINE=1`.
- Runner resolution locates the repository root without changing the caller's
  working directory, so relative package and file arguments remain valid when a
  runner is invoked from `apps/server` or another subproject.
- Existing Prettier `2.7.1` is present in `apps/web/node_modules` and its npm
  lockfile integrity is recorded above.
- No `go.mod`, `go.sum`, `package.json`, or `package-lock.json` was modified by
  Task 60.

The remaining **Needs Verification** entries are deliberate supply-chain
boundaries for unsupported platforms, future asset refreshes, CI runtime images,
and timing measurements; they are not exemptions from future checks.
