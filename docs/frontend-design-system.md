# Phytomni-Web frontend visual system

This document is the operational contract for the Vue frontend. It describes
where visual decisions live, which component owns each surface, and how to run
visual QA without relying on an old implementation diff. Runtime source remains
the authority when this document and the code disagree.

## Design principles

- Use calm, opaque surfaces with clear hierarchy rather than decorative glass.
- Use blue for action and brand communication; use green for accent and success
  communication. Do not introduce a competing framework palette in a product
  surface.
- Keep the shell readable at 200% zoom, usable with keyboard only, and robust in
  reduced-motion and forced-colors modes.
- Keep each scroll root, Footer owner, loading state, and per-dialogue state
  explicit. A route should not depend on document scrolling by accident.
- Keep agent content untrusted. Escape first, then sanitize the small set of
  markup and URLs that are intentionally rendered.

## Source of truth

| Concern                                                  | Source                                                       | Rule                                                                 |
| -------------------------------------------------------- | ------------------------------------------------------------ | -------------------------------------------------------------------- |
| Semantic colors, geometry, type, motion, and layer order | `apps/web/src/styles/tokens.css`                             | Add or change a token before adding a repeated literal.              |
| Global focus, reduced motion, and forced colors          | `apps/web/src/assets/main.css`                               | Preserve visible `:focus-visible`; never use a global outline reset. |
| Element Plus theme bridge                                | `tokens.css` plus the root `el-config-provider` in `App.vue` | `app.use(ElementPlus)` has no boot-time locale.                      |
| Locale UI copy                                           | `apps/web/src/locales/langs/{en-US,zh-CN}.ts`                | Keep keys in parity; Chinese belongs in `zh-CN.ts`.                  |
| Full legal prose                                         | `apps/web/src/legal/*.md`                                    | Do not move legal bodies into locale packs.                          |
| Route/layout ownership                                   | `apps/web/src/router/index.ts` and route archetype tests     | Update the owner test when adding a routed component.                |
| Frontend test gate                                       | `scripts/validate_web_local.sh`                              | Run the repository gate before handoff.                              |
| Visual contract gate                                     | `scripts/check_brand_colors.py`                              | Keep the scanner narrow; do not add whole-file exceptions.           |

## Token contract

The values below are the review-facing contract. The complete token set,
including compatibility aliases and Element Plus bridges, is in
`apps/web/src/styles/tokens.css`.

| Role              | Light     | Dark      |
| ----------------- | --------- | --------- |
| Page background   | `#f7f9fc` | `#101815` |
| Elevated surface  | `#ffffff` | `#17221d` |
| Sidebar surface   | `#f5f7fa` | `#121d19` |
| Primary text      | `#14201b` | `#f2f7f4` |
| Secondary text    | `#5b6b63` | `#b7c5be` |
| Muted text        | `#65736b` | `#9aaba2` |
| Control border    | `#6f7d75` | `#71857a` |
| Action fill       | `#2f6fd4` | `#2f6fd4` |
| Action fill hover | `#255eb8` | `#255eb8` |
| Action text/focus | `#2f6fd4` | `#8cb8ff` |
| Brand blue        | `#3a83f7` | `#3a83f7` |
| Accent green      | `#14644a` | `#2b7a59` |
| Accent text       | `#14644a` | `#7fd0ae` |
| User bubble       | `#eaf6f1` | `#17352a` |
| Assistant bubble  | `#eaf2fe` | `#182d49` |

Bubble surfaces are opaque, bordered, and softly shadowed. They must not use
`backdrop-filter`, `color-mix`, or transparent glass treatment. The semantic
classes are `.phy-bubble-user` and `.phy-bubble-assistant`.

### Geometry and type

- Spacing scale: `4`, `8`, `12`, `16`, `20`, `24`, `32`, `40`, `48`, and `64px`.
- Control heights: compact `32px`, default `40px`, primary `48px`.
- Radii: small `8px`, medium `12px`, large `16px`, pill `999px`.
- Shell type: Inter with system fallbacks (`--phy-font-shell`). Reading type is
  the serif `--phy-font-reading`; code uses `--phy-font-mono`.
- Motion: fast `150ms`, normal `220ms`, slow `360ms`; use explicit transitioned
  properties and the shared ease-out curve. Reduced motion changes the token
  durations to zero and the global stylesheet disables animation/scroll motion.
- Layer order: sticky `10`, dropdown `100`, drawer `1000`, modal `2000`, toast
  `3000`, transfer overlay `4000`.

### Layout measures and breakpoints

- Expanded sidebar: `272px`; compact sidebar: `56px`.
- Transcript max width: `clamp(860px, 72vw, 1600px)`.
- Document max width: `clamp(1120px, 78vw, 1600px)`.
- Reading max width: `clamp(760px, 52vw, 1160px)`.
- Artifact wide/document max widths: `clamp(1120px, 72vw, 1600px)` and
  `clamp(760px, 46vw, 1040px)`.
- Small/medium/large reference boundaries: `600px`, `900px`, and `1280px`.
  Media queries use the corresponding `599px`, `899px`, and `1279px` max-width
  cutoffs where a boundary is exclusive.

### Continuous responsive geometry

The default is continuous geometry: use `clamp()`, `min()`, `max()`, flex,
`minmax()`, and container queries so a surface adapts throughout an available
range instead of only at a viewport threshold. The only semantic breakpoints
are `600px`, `900px`, and `1280px`; use them for meaningfully different
information architecture, not routine dimensional adjustment.

Each component declares its scroll root and its narrow replacement. For
example, a desktop split can become one visible surface, a sidebar can become a
drawer, and a wide table can expose its own horizontal scroll frame; it must
not depend on a document-level overflow side effect. Supplied screenshots are
regression examples, not the scope boundary: the visual review includes a
`2560x1440` CSS-pixel viewport as well as the adversarial viewport matrix.

The responsive continuity width matrix is exactly `320`, `390`, `480`, `768`,
`899`, `900`, `1024`, `1199`, `1279`, `1280`, `1366`, `1920`, and `2560` CSS
pixels. The `2560x1440` entry is the 4K@150% scaling interpretation: a physical
4K display inspected at 150% browser/OS scaling still supplies a 2560 CSS-pixel
viewport to the layout. This matrix supplements, rather than replaces, the
semantic boundaries at `600px`, `900px`, and `1280px`.

## Component families and ownership

### Adaptive chat shell

`PhyAdaptiveShell` owns the desktop grid, artifact split/fullscreen boundary,
background inertness, and fullscreen focus trap. `PhyAdaptiveSidebar` owns the
compact/drawer behavior, dialog semantics, Escape handling, and focus restore.
`ChatComposer` owns the input frame and its attachment/action rows. Per-dialogue
state belongs in `chatStates[dialogueId]` through `useChatStates`; do not add a
top-level ref for message input, sending, uploads, logs, artifact state, or
refresh state.

The artifact fullscreen section is a dialog. It must have a labelled heading,
keep background content inert/hidden, trap Tab, close on Escape, and return focus
to the opener. On narrow screens, the artifact split becomes a single visible
surface rather than a squeezed two-column layout.

Chat agent selection has one frontend source: canonical tools granted in
`userStore.roles`, intersected in `CANONICAL_AGENT_DISPLAY_ORDER`. The fixed
product sequence is `ChatAgent → KnowledgeAgent → DataAgent → AnalystAgent → ReviewAgent → InSilicoResearchAgent → GeneNetworkAgent → BriefGeneAgent → DeepGenomeAgent → DigitalDesignAgent`; this display order is intentionally
independent from the Bot capability manifest order. The direct buttons,
searchable picker, mention suggestions, populated dropdown, and `useComposer`
runtime guard consume that same derived collection. Unresolved or failed role
loading is fail-closed; Cases remains permission-independent because
it links to static demonstration routes rather than granting live-agent access;
the eight visible Cases use the same fixed order without applying agent
permissions. Explore Agents is likewise a visible discovery entry for every
user who can open Chat; its destinations are static demos, while live-agent
execution remains protected by route and server authorization.

The approved Case order is Knowledge, Data, Analyst, Review, Gene Network,
BriefGene, DeepGenome, and Digital Design. Case media is an explicit
image-or-monogram union: seven image marks and the `BG` BriefGene monogram.
Workflow preview media is optional; BriefGene deliberately remains text-only.

Chat routing controls remain owned by `ChatComposer`: the empty landing owns
the Instant/Expert presentation selector, Expert empty states own the picker
and quick-select row, and populated Expert states own the compact menu. Their
availability source is the authenticated gateway's effective permission list,
projected through `userStore.roles` and the canonical display order; mode and
tool authorization remain server-enforced. The dedicated product routes own
their own Instant-only submissions and do not inherit a Chat selection. Expert
is not enabled by this visual contract.

The empty Chat landing owns vertical scroll at `chat-content-stack` and orders
Welcome → Composer → Cases. After the first message, that stack stops scrolling,
Cases unmounts, and `message-container` becomes the transcript scroll root while
the singleton Composer remains its flex sibling. Browser geometry evidence must
measure the state-appropriate owner instead of assuming the transcript always
scrolls.

### Workspace and document surfaces

- `PhyWorkspaceShell` owns authenticated data pages with a header, state region,
  content gutter, and page-level scroll behavior.
- `PhyDocLayout` owns document and report widths, with a compact breakpoint at
  the medium boundary.
- `PhyPageHeader`, `PhyDataToolbar`, `PhyTableFrame`, `PhyEmptyState`,
  `PhySkeleton`, `PhyAsyncState`, and `PhyErrorState` provide shared title,
  filter/table, and loading/empty/error primitives.
- `AgentDemoShell` owns static agent demonstrations. It labels the result as a
  static example, owns its own scroll root, and renders the route Footer.
- `PhyAuthLayout` owns auth-page composition and its own viewport boundary.
- Legal pages use `.legal-page` as their scroll root; the fixed Footer must not
  cover the final legal lines.

`App.vue` owns only the Element Plus locale provider and transfer overlay. Its
Element Plus locale is reactive at the App root (`zh-CN` selects `zh-cn`, while
`en-US` selects `en`), and transfer progress is the only root-level visual
overlay. The root does not mount a compatibility Footer or choose a route's
scroll owner; route-owned scroll roots rather than document scrolling contain
each page. Footer ownership stays with the route or shell exactly where its
scroll root and page composition require it.

## Route archetypes

The route inventory test is `apps/web/tests/component/RouteArchetypes.spec.ts`.
When a route changes, update its owner and behavior test together.

| Archetype                | Representative routes                                                                                                                                                                                                    | Route/content owner                               | Scroll root                                                         | Footer owner                    |
| ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------- | ------------------------------------------------------------------- | ------------------------------- |
| Auth                     | `/login`, `/register`, `/forgot-password`, `/change-password`                                                                                                                                                            | `PhyAuthLayout`                                   | `.phy-auth-layout`                                                  | `PhyAuthLayout`                 |
| Legal document           | `/terms`, `/privacy`                                                                                                                                                                                                     | `LegalView`                                       | `.legal-page` (`data-scroll-root="legal"`)                          | `LegalView`                     |
| Help document            | `/help`                                                                                                                                                                                                                  | `HelpView` + `PhyDocLayout`                       | `.help-page` (`data-scroll-root="help"`)                            | `HelpView` slot                 |
| Recovery                 | `/401`, unmatched routes                                                                                                                                                                                                 | `UnauthorizedView`/`NotFoundView`                 | `.phy-recovery-page` (`data-scroll-root="recovery"`)                | recovery view                   |
| Adaptive chat            | `/chat`, `/cases/knowledge-agent`, `/cases/data-agent`, `/cases/analyst-agent`, `/cases/review-agent`, `/cases/brief-gene-agent`, `/cases/deep-genome-agent`, `/cases/gene-network-agent`, `/cases/digital-design-agent` | `ChatView` / `PhyAdaptiveShell`                   | `chat-content-stack` when empty; `message-container` when populated | none; App transfer overlay only |
| Static agent demo        | `/design`                                                                                                                                                                                                                | `AgentDemoShell`                                  | `.agent-demo-shell` (`data-scroll-root="agent-demo"`)               | `AgentDemoShell`                |
| Workspace/data           | `/gene-display`, `/log-list`, `/user-list`, `/permi-manage`, `/favorites`, `/history`, `/profile`, `/cloud-storage`, `/feedback`, `/task-management`, `/global-config`, `/admin-management`                              | `PhyWorkspaceShell`                               | `data-scroll-root="workspace"`                                      | outer `LayoutView` Footer       |
| Gene detail workspace    | `/gene-display/detail`                                                                                                                                                                                                   | `GeneDetailView`                                  | `.gene-detail-route` (`data-scroll-root="gene-detail"`)             | none                            |
| Capability-gated product | `/research-agent`, `/gene-network-agent`, `/digital-design-agent`                                                                                                                                                        | guarded product view + `ResearchArtifactShell`    | route-specific `data-scroll-root`                                   | none                            |
| Dormant dynamic          | `/system/user-auth`                                                                                                                                                                                                      | no active component; hidden dynamic metadata only | none                                                                | none                            |

`layout: "nolayout"` and `hideSidebar` are route metadata contracts, not
visual guesses. Public legal pages remain available to authenticated users;
legal access is not a guest-only rule.

Case cards open ChatView demo mode. `/cases/gene-network-agent` and
`/cases/digital-design-agent` are not live execution surfaces;
`/analyst-agent`, `/gene-network-agent`, `/digital-design-agent`, and
`/research-agent` remain gated product pages. A static Case card is not an
authorization boundary.

### Remote product route ownership and cutover

Research, Digital Design, and Gene Network product pages own their submissions
through `POST /api/v1/agent-products/:tool/runs`; their canonical tools are
`InSilicoResearchAgent`, `DigitalDesignAgent`, and `GeneNetworkAgent`.
`runAgentProductAbortable` is the only product-page transport. It must not fall
back to `getQueryAbortable` or add caller-controlled `tool` and `mode` fields;
the authenticated route owns those values and uses Instant mode.

The cutover order is: deploy the Bot capability support with Expert disabled;
deploy this Web compatibility build; verify the three product-page staging
smokes and sanitized gateway telemetry; then obtain reviewer approval before
removing legacy Chat Instant-plus-tool compatibility. Strict Chat validation is
implemented in this branch; its cross-repository deployment observation and
Expert activation are still pending. Deployment observations, gateway
telemetry, and the agreed no-legacy-traffic observation window are **External
Pending** until an authorized environment supplies evidence.

These capability-gated rows are local Web route contracts only. This document
does not claim Bot deployment, production acceptance, or Expert activation;
those remain external verification boundaries.

## State, progress, and feedback

Every async surface exposes one of loading, empty, error, or ready/populated
states. Loading uses `PhySkeleton`; empty uses `PhyEmptyState`; recoverable
errors use `PhyErrorState` with an explicit retry action. Keep error copy
localized and avoid exposing internal request details.

Chat history recovery has four visual fixture states: `history-title-only`,
`history-loading`, `history-empty`, and `history-error`. The title-only state
recovers a legacy user question without inventing an assistant answer; loading
shows the history skeleton; empty shows the explicit history empty state; and
error shows the retryable error state. These fixture names are visual-state
contracts, while per-dialogue runtime hydration remains `loading`, `ready`,
`history-empty`, or `error` in `ChatUIState`.

There is exactly one simulated percentage surface: `SendProgress` for perceived
agent processing. `progressAt()` is an elapsed-time curve capped at `98%` while
the agent is active and reaches `100%` only when the real completion state is
known. It must never be described as measured backend progress or used for file
transfers.

Real transfer progress uses `TransferSnapshot` and `TransferProgress`:

- upload byte progress lives in `chatStates[dialogueId].uploadTransfer`;
- download byte progress lives in the shared `download-transfers` map;
- unknown totals are indeterminate and must not display a fabricated percentage;
- cancel uses the request abort path and canceled requests do not create a
  global error toast;
- the transfer region has localized phase, byte, percentage, and cancellation
  labels.

Resumable biological attachments use one `obs-multipart-v2` protocol and keep
the trust boundary explicit:

- the browser sends JSON metadata and owner-scoped renewal requests through the
  Web Go control plane (`/api/v1/files`); Go never receives a file body or a
  Huawei credential;
- the browser sends bounded parts directly to the Bot upload origin using the
  short-lived opaque application capability returned by the control plane;
- completed Chat, Research, and Digital Design submissions carry only private
  `asset_id` references; they never put file bytes, OBS paths, or signed cloud
  URLs into message text or history;
- the client validates the exact Bot origin and asset path before every data
  plane request, persists only non-secret recovery metadata, and keeps transfer
  state per dialogue;
- the Bot-owned contract is capable of a 10 GiB file with bounded part
  concurrency. A local visual fixture or the synthetic progress bar does not
  establish live storage, throughput, or 10 GiB acceptance.

The resumable upload flag remains off until the Bot receipt, owner-isolation
evidence, credential-boundary review, and the cross-repository source checker
all pass. The legacy multipart relay is not an allowed fallback after the
breaking cutover is accepted.

### Unified attachment contract

Every production upload surface exposes exactly one Attach action. The user
does not choose a purpose, see a purpose selector/badge, or fill a separate
dataset-description field. The ordinary query is the only place to explain
the intended analysis. Web Go normalizes the bounded filename metadata and
derives `dataset` or `document` before it asks Bot to create an asset; every
archive suffix defaults to `dataset`, while unsupported or ambiguous names are
rejected before a Bot/OBS session is created.

Research accepts the same single-composer interaction in three forms: a short
query with same-turn PDF and uploaded dataset assets; a query with a same-turn
PDF and dataset paths pasted into the query; or a query containing pasted paper
text and pasted dataset paths. The ordinary query remains one field, gives the
resolver the full user text, and does not add a new input control for paths or
descriptions. The attachment count default is 64, subject to the compatible
Bot-advertised limit, and the Web hard maximum is 256.

The current-message character limit is negotiated with
`research_input_resolution_v1` version `1`. Browser validation, Web Go relay,
persistence, and Bot validation count the decoded raw input consistently and
must never silently truncate an accepted query. If the protocol or bounded
descriptor is missing or incompatible, Research fails closed with the existing
error surface rather than shrinking, rewriting, or splitting the user's text.

The attachment control and data boundaries are deliberately narrow:

- **Browser → Web Go:** `/api/v1/files` is a JSON-only control plane for
  create and capability renewal. The browser sends filename/size/type hints
  and receives an opaque, short-lived upload capability; it never sends a
  purpose, file body, Huawei credential, OBS upload id, object key, or signed
  storage URL to Go.
- **Browser → Bot upload origin:** the opaque capability authorizes `HEAD`,
  part uploads, completion, and abort directly at Bot. These data-plane calls
  never pass through Web Go.
- **Web Go → Bot:** trusted Go sends the server-derived class and owner-scoped
  upload coordination data. It does not forward a client-selected class,
  resolve an asset into a path, or relay file parts. The browser sends parts
  directly to Bot's accepted upload origin with the opaque capability.

The attachment portion of a conversation submission contains the raw user
query and completed owner-scoped `asset_id` references only. It must not carry
`purpose`, dataset descriptions, native `data_list`/`obs_file_list` values,
storage coordinates, or capabilities. New browser recovery records are
purpose-free and description-free. A legacy record may be read only for
compatibility, cleanup, or migration; its stored purpose is never trusted for
new classification or submission.

Bot remains the owner of durable asset state, authorization, and final Agent
mapping. After resolving each asset for the authenticated owner, it applies
the Agent's declared channels as follows:

| Agent channels         | Bot mapping                                                    |
| ---------------------- | -------------------------------------------------------------- |
| `document` + `dataset` | Documents → `obs_file_list`; datasets → `data_list`            |
| `document` only        | Every completed asset → `obs_file_list`                        |
| `dataset` only         | Every completed asset → `data_list`                            |
| no attachment channel  | Reject an attachment-bearing run before native tool invocation |

The persisted class is not mutated by single-channel placement. Web may block
an obviously incompatible selection earlier, but Bot is the final authority
for ownership, capability authorization, and native argument construction.

Chat, Research, and Digital Design share `AttachmentChipStrip`. The strip is
a horizontal overflow row that stays inside the composer at every continuous
matrix width, including `320px` and `390px`; its on-demand detail panel is
contained by the strip rather than covering the editor. Long names ellipsize
visually but retain the full accessible name, `+N more` exposes hidden files,
and every action uses the default control height, visible `:focus-visible`,
keyboard order, a single polite live region, reduced-motion behavior, and
forced-colors rules. Per-dialogue upload state remains in `chatStates`.

Web-only classifier, serialization, recovery, chip, and visual evidence must
be labelled `ACCEPTED_WITH_GAPS (WEB-ONLY)`; it does not prove Bot storage or
native mapping. `External Pending`/`Needs Verification` remains the status
until a paired Web → Go → Bot run with a development account proves the Bot
receipt, owner isolation, capability redaction, and dual/single/zero-channel
mapping. This contract does not activate the feature or authorize production
configuration changes.

Static demo downloads only communicate that a download has started. They do not
claim backend completion, persistence, or measured transfer progress.

## Artifact and citation behavior

### One scientific Markdown engine

`ScientificMarkdown` is the only renderer for agent report bodies, including
cited answers, Chat blocks, DeepGenome documents, research reports, and the
streaming typewriter. It passes `allow-html=false` and `sanitize=true` to
XMarkdown, accepts only the citation-only `<sup>` grammar, and owns local table,
code, math, and link overflow; report bodies must not add a `v-html` sink.

Structured images, CIF files, Markdown attachments, and citation rows are
separate authorized resources. A caller passes owner-authorized resource
metadata and a page-unique citation namespace only when matching reference rows
exist; resource activation is emitted as a typed event and never inferred from
an arbitrary report URL.

### Report-backed artifact lifecycle

The Chat artifact policy maps only the supported report tools to `cited-report`,
`research`, or `deep-genome`. Any substantive final, intermediate, or message
report is eligible regardless of lifecycle status, including a retained failed
or timed-out report; status-only placeholders, empty text, and DeepGenome
transport placeholders are not reports. Chat and Data content without a report
stays inline.

Artifact selection is keyed by a stable stream/message/run identity and isolated
per dialogue. Hydrated and background reports are marked handled without taking
focus; a new foreground identity may auto-open once, while manual View always
opens an eligible report and downloads still require a durable row id.

### Citation and HTML safety

Citation links emit typed activation events to the owning reference list and
must use a matching namespace. The only retained HTML sink is the separately
reviewed, escaped reference-row renderer; its text uses `escapeHtml` and fixed
URLs use `sanitizeHref`. Vue-bound resource links use `safeHrefValue`; do not
resurrect report HTML, add raw report-body `v-html`, or bypass these validators.

## Auth, PII, and legal invariants

- Auth and first-login behavior remains server-authorized. `login_status` is
  written only by the existing user store/login surfaces; the change-password
  handoff may start the tutorial but must not add another status writer.
- Login and permission paths must not log token-bearing request, response, or
  error objects. The action observer records only action name and error message.
- PII-watermarked user/admin surfaces preserve their watermark and pointer
  behavior. Visual hiding is not a permission boundary.
- Terms and privacy source Markdown remains bilingual and versioned. The ICP
  filing and operator identity must not drift, and the draft banner remains
  until institute/legal sign-off.

## Visual QA runbook

Run the matrix with sanitized test data only. Do not capture cookies, tokens,
production URLs, real user names, email addresses, gene records, or PII.

### Required matrix

| Dimension           | Values                                                                                                    |
| ------------------- | --------------------------------------------------------------------------------------------------------- |
| Viewport            | `1440x900`, `1024x768`, `768x1024`, `390x844`                                                             |
| Locale              | `en-US`, `zh-CN`                                                                                          |
| Theme               | light, dark, system-following                                                                             |
| Route states        | loading, empty, error/retry, populated; chat also sending, streaming, artifact split, artifact fullscreen |
| Input/accessibility | keyboard-only, 200% zoom, reduced motion, forced colors                                                   |

For each route archetype, verify one representative route first, then sample
the changed routes. Check that the intended element is the only scroll root,
Footer is visible but does not cover content, text does not clip after locale
switching, and focus remains visible after every open/close transition.

### Chat routing fixture matrix

`apps/web/tests/visual/chat/fixture-registry.ts` owns four deterministic,
test-only routing snapshots. Each is captured at `320x568`, `390x844`,
`480x800`, `768x1024`, `1024x768`, `1366x768`, `1440x900`, `1920x1080`, and
`2560x1440`, in `en-US` and `zh-CN`, for both light and dark themes. This is
visual harness evidence only; it does not establish an authenticated
environment conclusion.

| Fixture                     | Mode    | State     | Expected Chat control                                                    |
| --------------------------- | ------- | --------- | ------------------------------------------------------------------------ |
| `instant-empty`             | Instant | empty     | No agent picker, quick-select, or populated-menu control.                |
| `expert-auto-empty`         | Expert  | empty     | Autonomous picker plus permitted quick-select options.                   |
| `expert-selected-empty`     | Expert  | empty     | Selected picker chip and matching quick-select state.                    |
| `expert-selected-populated` | Expert  | populated | Compact permitted-agent menu; no empty-state picker or quick-select row. |

The fixture permission source is the explicit synthetic `allowedTools` list;
the application source remains the authenticated gateway's effective roles.
Capture evidence must be stored below
`.codex/evidence/frontend-v2/instant-expert-routing/`, reviewed PNG by PNG,
and never staged. It does not assert that Expert is enabled.

### Evidence tiers

1. **Automated contract evidence** — focused Vitest tests, scanner tests, type
   check, build, and the canonical repository gate.
2. **Sanitized browser evidence** — screenshots or a non-PNG modality log for
   the required matrix, with route, viewport, locale, theme, state, and result.
3. **Reviewer evidence** — a short sign-off record naming the product design,
   frontend, accessibility, and security/privacy reviewers and recording any
   remaining risk.

Store local evidence below `.codex/evidence/frontend-v2/`; this path is ignored
and must never be staged. The index schema is documented in
`.codex/evidence/frontend-v2/README.md`.

## A2UI interaction lifecycle

The Web activation slice supports three widgets only. The three supported
widgets are `Confirm`, `Form`, and `Choice`. Message-owned state is the rule: a
surface is stored on the
assistant message that introduced it, never in a global or dialogue-wide
singleton. The stable identity tuple is `messageKey + run_id + surface_id`;
reducer updates and action responses must retain all three members.

- A `terminal` response closes the current surface. An `input_required`
  response updates the same message and may open the next review round.
- The pause-round ceiling is `N=2`: after the second input-required round the
  Web surface pauses and waits for a new assistant turn rather than opening a
  third round.
- There is no automatic retry. An `unknown lock` is terminal for the current
  surface; only a deliberate, bounded user action can retry a proven
  pre-dispatch rejection.
- Form/Choice cancellation is an explicit user action and emits a bounded
  cancellation payload; it is not inferred from navigation or a component
  unmount.
- History/reload read-only degradation is intentional. Persisted messages may
  show the last safe surface snapshot, but they must not invent a live action
  transport or replay a stale envelope. The no-blind-replay rule rejects any
  client-side attempt to resend an old envelope, and the reload fail-safe keeps
  the surface read-only when its runtime identity is unavailable.
- Accessibility keeps lifecycle status in a polite live region, focuses a
  freshly opened round without stealing initial focus, preserves visible
  focus, and keeps touch controls at the shared minimum target size.
- Sanitized local evidence belongs under
  `.codex/evidence/a2ui-activation/`; it must contain synthetic identifiers and
  no cookies, tokens, production URLs, or biological/user data.
- A1 activation-ready is not production activation. Full external acceptance,
  operator authorization, and cross-system evidence remain prerequisites for
  changing a dark-launch flag.

## Prohibited patterns

The G14 scanner and contract tests reject the high-signal regressions below:

- page-local `.theme-dark` overrides instead of semantic tokens;
- competing legacy brand hex values;
- `transition: all`, active-source `outline: none|0|unset`, or global wildcard
  motion/position side effects;
- transparent/glass chat bubbles, `backdrop-filter`, or unreviewed decorative
  color mixing on bubble surfaces;
- retired shell/composable names and retired chat selectors;
- unauthorized `100vh` owners, duplicate/fixed compatibility Footers, or a
  second global scroll root;
- fake transfer percentages, fake demo completion, or an unscoped citation
  namespace;
- direct unsafe HTML/URL interpolation into a `v-html` sink.

## Verification commands

From the repository root:

```bash
python3 -m unittest discover -s scripts/tests -p 'test_check_brand_colors.py'
python3 scripts/check_brand_colors.py
cd apps/web
npm run test:run
npm run coverage
npm run type-check
npm run build
cd ../..
./scripts/validate_web_local.sh
git diff --check
```

The commands above are checks to run for the current checkout; record their
actual exit codes and relevant output in the local evidence index before
claiming closure.
