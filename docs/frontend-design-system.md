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

| Concern | Source | Rule |
|---|---|---|
| Semantic colors, geometry, type, motion, and layer order | `apps/web/src/styles/tokens.css` | Add or change a token before adding a repeated literal. |
| Global focus, reduced motion, and forced colors | `apps/web/src/assets/main.css` | Preserve visible `:focus-visible`; never use a global outline reset. |
| Element Plus theme bridge | `tokens.css` plus the root `el-config-provider` in `App.vue` | `app.use(ElementPlus)` has no boot-time locale. |
| Locale UI copy | `apps/web/src/locales/langs/{en-US,zh-CN}.ts` | Keep keys in parity; Chinese belongs in `zh-CN.ts`. |
| Full legal prose | `apps/web/src/legal/*.md` | Do not move legal bodies into locale packs. |
| Route/layout ownership | `apps/web/src/router/index.ts` and route archetype tests | Update the owner test when adding a routed component. |
| Frontend test gate | `scripts/validate_web_local.sh` | Run the repository gate before handoff. |
| Visual contract gate | `scripts/check_brand_colors.py` | Keep the scanner narrow; do not add whole-file exceptions. |

## Token contract

The values below are the review-facing contract. The complete token set,
including compatibility aliases and Element Plus bridges, is in
`apps/web/src/styles/tokens.css`.

| Role | Light | Dark |
|---|---|---|
| Page background | `#f7f9fc` | `#101815` |
| Elevated surface | `#ffffff` | `#17221d` |
| Sidebar surface | `#f5f7fa` | `#121d19` |
| Primary text | `#14201b` | `#f2f7f4` |
| Secondary text | `#5b6b63` | `#b7c5be` |
| Muted text | `#65736b` | `#9aaba2` |
| Control border | `#6f7d75` | `#71857a` |
| Action fill | `#2f6fd4` | `#2f6fd4` |
| Action fill hover | `#255eb8` | `#255eb8` |
| Action text/focus | `#2f6fd4` | `#8cb8ff` |
| Brand blue | `#3a83f7` | `#3a83f7` |
| Accent green | `#14644a` | `#2b7a59` |
| Accent text | `#14644a` | `#7fd0ae` |
| User bubble | `#eaf6f1` | `#17352a` |
| Assistant bubble | `#eaf2fe` | `#182d49` |

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

The global `App.vue` does not render a compatibility Footer. A route or shell
owns the Footer exactly where its scroll root and page composition require it.

## Route archetypes

The route inventory test is `apps/web/tests/component/RouteArchetypes.spec.ts`.
When a route changes, update its owner and behavior test together.

| Archetype | Representative routes | Primary owner |
|---|---|---|
| Auth | `/login`, `/register`, `/forgot-password`, `/change-password` | `PhyAuthLayout` and auth view |
| Legal/document | `/terms`, `/privacy`, `/help` | route document shell and local scroll root |
| Recovery | `/401`, unmatched routes | recovery page and local scroll root |
| Adaptive chat | `/chat` | `PhyAdaptiveShell`, adaptive sidebar, chat composer |
| Static agent demo | `/knowledge-agent`, `/data-agent`, `/analyst-agent`, `/brief-gene-agent`, `/gene-network-agent`, `/deep-genome-agent`, `/digital-design-agent`, `/design` | `AgentDemoShell` or the route's documented demo shell |
| Workspace/data | `/history`, `/favorites`, `/profile`, `/cloud-storage`, `/feedback`, `/task-management`, `/log-list`, `/user-list`, `/permi-manage`, `/global-config`, `/admin-management` | `PhyWorkspaceShell` or the route's existing owner |
| Dormant dynamic | `/system/user-auth` | no active component; do not count as a live visual surface |

`layout: "nolayout"` and `hideSidebar` are route metadata contracts, not
visual guesses. Public legal pages remain available to authenticated users;
legal access is not a guest-only rule.

## State, progress, and feedback

Every async surface exposes one of loading, empty, error, or ready/populated
states. Loading uses `PhySkeleton`; empty uses `PhyEmptyState`; recoverable
errors use `PhyErrorState` with an explicit retry action. Keep error copy
localized and avoid exposing internal request details.

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

Static demo downloads only communicate that a download has started. They do not
claim backend completion, persistence, or measured transfer progress.

## Artifact and citation behavior

An artifact is eligible only for a completed assistant message with a non-empty
server id, non-empty content, and a recognized tool mapping in
`views/chat/utils/artifact-policy.ts`. Server ids are normalized to strings and
must identify exactly one eligible message in the current dialogue. Artifact
selection and open state are per dialogue.

The chat transcript keeps the preview; the Artifact surface owns the complete
report body. Auto-open is limited to the explicitly configured research tools.
Cited families render through `CitedAnswer`/`MarkdownViewer` and must pass a
page-unique citation namespace (`m<index>` in chat, or a stable demo namespace),
so `[N]` links target only the matching reference list.

Agent-influenced content reaches `v-html` only through the escape-first
pipeline. Resurrected anchor attributes use `sanitizeAnchorAttributes`; URLs
interpolated into fixed links use `sanitizeHref` (or its escaped equivalent).
Do not add a raw `v-html` sink, bypass the sanitizer, or give a cited renderer
an empty namespace.

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

| Dimension | Values |
|---|---|
| Viewport | `1440x900`, `1024x768`, `768x1024`, `390x844` |
| Locale | `en-US`, `zh-CN` |
| Theme | light, dark, system-following |
| Route states | loading, empty, error/retry, populated; chat also sending, streaming, artifact split, artifact fullscreen |
| Input/accessibility | keyboard-only, 200% zoom, reduced motion, forced colors |

For each route archetype, verify one representative route first, then sample
the changed routes. Check that the intended element is the only scroll root,
Footer is visible but does not cover content, text does not clip after locale
switching, and focus remains visible after every open/close transition.

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
