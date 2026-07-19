# Chat visual fixtures

Test-only Vite harness for deterministic Chat transient states. Production source
must never import or register this tree. Authenticated `/chat` remains the
integration authority for login, route guards, and real sidebar flows.

Harness URL shape:

```text
/tests/visual/chat/?state=<key>&locale=<locale>&theme=<theme>
```

Accepted dimensions:

- `state`: `empty` | `empty-cases` | `populated` | `attachment` | `sending` | `picker-open` |
  `picker-search` | `picker-selected` | `sidebar-expanded` | `sidebar-compact` |
  `sidebar-mobile-closed` | `sidebar-mobile-open`
- `locale`: `en-US` | `zh-CN`
- `theme`: `light` | `dark`

Unknown state/locale/theme render a fixture error and make evidence invalid —
there is no silent default.

Harness evidence label: `fixture_source=tests/visual/chat`  
Authenticated evidence label: `fixture_source=authenticated-route`  

Never label harness captures end-to-end. jsdom/Vitest never substitutes for the
browser geometry check below.

## Geometry protocol (two-eval)

`agent-browser eval` cannot both preserve a returned JSON object and throw with
that same stdout. Always:

1. `measure-geometry.js` — scrolls the transcript owner, awaits two animation
   frames, stores `window.__PHY_CHAT_GEOMETRY_RESULT__`, returns the object, and
   does **not** throw solely for `pass=false`.
2. Save that JSON (`tee` + `test -s`).
3. `assert-geometry.js` — reads the stored object and returns `{ "pass": true }`
   only when it exists and passes; otherwise throws (nonzero exit).
4. Screenshot only after assertion exit 0.

### Expected geometry JSON top-level fields

`viewport`, `document`, `root`, `transcript`, `contentStack`, `scrollOwner`,
`emptyScrollPosition`, `primaryAction`, `navigationTrigger`, `composer`,
`headerPreferences`, `quickSelectCount`, `caseRegionCount`, `caseLinkCount`, `lastCase`,
`lastMessage`, `state`, `pass`

`transcript` includes `scrollTop`, `scrollHeight`, `clientHeight`, `clientWidth`,
`scrollWidth`, and `atBottom`. `scrollOwner` reports the state-selected owner,
including `kind`, `scrollTop`, `scrollHeight`, `clientHeight`, `clientWidth`,
`scrollWidth`, `atTop`, and `atBottom`. Rect records include measured edges.
`lastMessage.present=false` is permitted only when `state="empty"`.

### Safe script return shapes

- `redact-identity.js` → `{ "count": 1, "pass": true }` (only permitted
  identity-related terminal output)
- `assert-chat-path.js` → `{ "path_ok": true }` (pathname only; never full URL)
- `assert-geometry.js` → `{ "pass": true }`

### PASS/FAIL recording fields

For each evidence row record at least: viewport, locale, theme, state key,
`fixture_source`, `identity_redaction` (`not-needed-synthetic` for harness;
`dom-only` for authenticated after redaction), geometry `pass`, and screenshot
path. Harness rows do not need live identity redaction when the visible identity
is already exact `Synthetic user`.

## Chat home canonical viewports

| Category | CSS viewport | Review identity |
|---|---:|---|
| Compact phone | `320x568` | iPhone SE / older Android lower bound |
| Modern phone | `390x844` | current iPhone / Android |
| Large phone or small tablet | `480x800` | unfolded phone / small tablet |
| Tablet | `768x1024` | iPad-class portrait |
| Small desktop | `1024x768` | compact laptop lower bound |
| Mainstream laptop | `1366x768` | office notebook |
| Desktop | `1440x900` | standard external display |
| Large desktop | `1920x1080` | full-HD monitor |
| 4K at 150% scaling | `2560x1440` | user's 3840x2160 physical setup expressed in CSS pixels |

The synthetic home matrix is exact:

- `empty` and `empty-cases`: all 9 viewports × 2 locales × 2 themes = 72 images.
- `populated`: `320x568`, `768x1024`, `1024x768`, `1440x900`, and `2560x1440` × 2 locales × 2 themes = 20 images.
- `sidebar-mobile-closed` and `sidebar-mobile-open`: `390x844` × 2 locales × 2 themes = 8 images.
- Total synthetic review set: 100 PNG files and 100 geometry JSON files.

`empty` proves the top composition and visible Composer. `empty-cases` runs the
same page at the bottom of the empty-state scroll owner and proves the seventh
case is reachable. A screenshot is invalid unless its geometry JSON passes
before capture.

Evidence filename matrix:

```text
chat__<state>__<W>x<H>__<locale>__<theme>.png
chat__<state>__<W>x<H>__<locale>__<theme>.geometry.json
```

Closed and open mobile are different exact states — never infer one from the other
(`sidebar-mobile-closed` / `sidebar-mobile-open`).

The harness matrix can be captured in one deterministic run:

```bash
./tests/visual/chat/capture-home-matrix.sh
```

## Terminal A — fixed Vite (hard stop on strict-port failure)

```bash
cd apps/web
npm run dev -- --host 127.0.0.1 --port 5174 --strictPort
```

## Terminal B — harness capture (mkdir hard stop)

Terminal B creates the ignored evidence directories first; inability to create or
verify them is a hard stop. It then captures one deterministic fixture.

```bash
cd apps/web
set -e
set -o pipefail
mkdir -p ../../.codex/evidence/frontend-v2/3A.8 ../../.codex/evidence/frontend-v2/3A.10
test -d ../../.codex/evidence/frontend-v2/3A.8
test -d ../../.codex/evidence/frontend-v2/3A.10
agent-browser --session phy-v2-fixture set viewport 1440 900
agent-browser --session phy-v2-fixture set media light
agent-browser --session phy-v2-fixture open 'http://127.0.0.1:5174/tests/visual/chat/?state=empty&locale=en-US&theme=light'
agent-browser --session phy-v2-fixture wait --fn "document.querySelector('[data-testid=chat-visual-root]')?.dataset.fixtureReady === 'true'"
agent-browser --session phy-v2-fixture snapshot -i -c
agent-browser --session phy-v2-fixture eval --stdin < tests/visual/chat/measure-geometry.js | tee ../../.codex/evidence/frontend-v2/3A.8/chat__empty__1440x900__en-US__light.geometry.json
test -s ../../.codex/evidence/frontend-v2/3A.8/chat__empty__1440x900__en-US__light.geometry.json
agent-browser --session phy-v2-fixture eval --stdin < tests/visual/chat/assert-geometry.js
agent-browser --session phy-v2-fixture screenshot ../../.codex/evidence/frontend-v2/3A.8/chat__empty__1440x900__en-US__light.png
agent-browser --session phy-v2-fixture close
```

### Deterministic mobile navigation pair

```bash
cd apps/web
set -e
set -o pipefail
mkdir -p ../../.codex/evidence/frontend-v2/3A.8
test -d ../../.codex/evidence/frontend-v2/3A.8
agent-browser --session phy-v2-fixture set viewport 390 844
agent-browser --session phy-v2-fixture set media light
agent-browser --session phy-v2-fixture open 'http://127.0.0.1:5174/tests/visual/chat/?state=sidebar-mobile-closed&locale=en-US&theme=light'
agent-browser --session phy-v2-fixture wait --fn "document.querySelector('[data-testid=chat-visual-root]')?.dataset.fixtureReady === 'true'"
agent-browser --session phy-v2-fixture eval --stdin < tests/visual/chat/measure-geometry.js | tee ../../.codex/evidence/frontend-v2/3A.8/chat__sidebar-mobile-closed__390x844__en-US__light.geometry.json
test -s ../../.codex/evidence/frontend-v2/3A.8/chat__sidebar-mobile-closed__390x844__en-US__light.geometry.json
agent-browser --session phy-v2-fixture eval --stdin < tests/visual/chat/assert-geometry.js
agent-browser --session phy-v2-fixture screenshot ../../.codex/evidence/frontend-v2/3A.8/chat__sidebar-mobile-closed__390x844__en-US__light.png
agent-browser --session phy-v2-fixture open 'http://127.0.0.1:5174/tests/visual/chat/?state=sidebar-mobile-open&locale=en-US&theme=light'
agent-browser --session phy-v2-fixture wait --fn "document.querySelector('[data-testid=chat-visual-root]')?.dataset.fixtureReady === 'true'"
agent-browser --session phy-v2-fixture eval --stdin < tests/visual/chat/measure-geometry.js | tee ../../.codex/evidence/frontend-v2/3A.8/chat__sidebar-mobile-open__390x844__en-US__light.geometry.json
test -s ../../.codex/evidence/frontend-v2/3A.8/chat__sidebar-mobile-open__390x844__en-US__light.geometry.json
agent-browser --session phy-v2-fixture eval --stdin < tests/visual/chat/assert-geometry.js
agent-browser --session phy-v2-fixture screenshot ../../.codex/evidence/frontend-v2/3A.8/chat__sidebar-mobile-open__390x844__en-US__light.png
agent-browser --session phy-v2-fixture close
```

## Authenticated `/chat` capture

Uses an already-authenticated isolated session prepared outside the repository —
never credentials or a repo state file. Keep `phy-v2-auth` open until the complete
authenticated matrix finishes; `--session` alone is not a persisted auth profile
after `close`. If the browser must restart, stop until the session owner restores
an approved repository-external profile/state through a private command; do not
place that path/state in this README or evidence. After `open`, redact first and
use the path-only script — never `get url`. Run redaction again after **every**
click, locale/theme change, route change, reload, or other possible render, and
immediately before every snapshot, eval, or screenshot. No raw capture is
permitted.

```bash
cd apps/web
set -e
set -o pipefail
mkdir -p ../../.codex/evidence/frontend-v2/3A.10
test -d ../../.codex/evidence/frontend-v2/3A.10
agent-browser --session phy-v2-auth set viewport 1440 900
agent-browser --session phy-v2-auth open 'http://127.0.0.1:5174/chat'
agent-browser --session phy-v2-auth wait '[data-testid=chat-root]'
agent-browser --session phy-v2-auth eval --stdin < tests/visual/chat/redact-identity.js
agent-browser --session phy-v2-auth eval --stdin < tests/visual/chat/assert-chat-path.js
agent-browser --session phy-v2-auth eval --stdin < tests/visual/chat/redact-identity.js
agent-browser --session phy-v2-auth snapshot -i -c
agent-browser --session phy-v2-auth eval --stdin < tests/visual/chat/redact-identity.js
agent-browser --session phy-v2-auth eval --stdin < tests/visual/chat/measure-geometry.js | tee ../../.codex/evidence/frontend-v2/3A.10/chat__empty__1440x900__en-US__light.geometry.json
test -s ../../.codex/evidence/frontend-v2/3A.10/chat__empty__1440x900__en-US__light.geometry.json
agent-browser --session phy-v2-auth eval --stdin < tests/visual/chat/redact-identity.js
agent-browser --session phy-v2-auth eval --stdin < tests/visual/chat/assert-geometry.js
agent-browser --session phy-v2-auth eval --stdin < tests/visual/chat/redact-identity.js
agent-browser --session phy-v2-auth screenshot ../../.codex/evidence/frontend-v2/3A.10/chat__empty__1440x900__en-US__light.png
agent-browser --session phy-v2-auth reload
agent-browser --session phy-v2-auth wait '[data-testid=chat-root]'
agent-browser --session phy-v2-auth eval --stdin < tests/visual/chat/redact-identity.js
```

### Authenticated closed/open mobile pair

```bash
cd apps/web
set -e
set -o pipefail
mkdir -p ../../.codex/evidence/frontend-v2/3A.10
test -d ../../.codex/evidence/frontend-v2/3A.10
agent-browser --session phy-v2-auth set viewport 390 844
agent-browser --session phy-v2-auth reload
agent-browser --session phy-v2-auth wait '[data-testid=chat-root]'
agent-browser --session phy-v2-auth eval --stdin < tests/visual/chat/redact-identity.js
agent-browser --session phy-v2-auth eval --stdin < tests/visual/chat/assert-chat-path.js
agent-browser --session phy-v2-auth eval --stdin < tests/visual/chat/redact-identity.js
agent-browser --session phy-v2-auth eval --stdin < tests/visual/chat/measure-geometry.js | tee ../../.codex/evidence/frontend-v2/3A.10/chat__sidebar-mobile-closed__390x844__en-US__light.geometry.json
test -s ../../.codex/evidence/frontend-v2/3A.10/chat__sidebar-mobile-closed__390x844__en-US__light.geometry.json
agent-browser --session phy-v2-auth eval --stdin < tests/visual/chat/redact-identity.js
agent-browser --session phy-v2-auth eval --stdin < tests/visual/chat/assert-geometry.js
agent-browser --session phy-v2-auth eval --stdin < tests/visual/chat/redact-identity.js
agent-browser --session phy-v2-auth screenshot ../../.codex/evidence/frontend-v2/3A.10/chat__sidebar-mobile-closed__390x844__en-US__light.png
agent-browser --session phy-v2-auth reload
agent-browser --session phy-v2-auth wait '[data-testid=chat-root]'
agent-browser --session phy-v2-auth eval --stdin < tests/visual/chat/redact-identity.js
agent-browser --session phy-v2-auth eval --stdin < tests/visual/chat/assert-chat-path.js
agent-browser --session phy-v2-auth eval --stdin < tests/visual/chat/redact-identity.js
agent-browser --session phy-v2-auth click '[data-testid=chat-sidebar-trigger]'
agent-browser --session phy-v2-auth wait --fn "(() => { const root = document.querySelector('[data-testid=chat-root]'); const action = document.querySelector('[data-testid=chat-primary-action]'); if (!root || !action || root.dataset.sidebarDrawerState !== 'open') return false; const rect = action.getBoundingClientRect(); const style = getComputedStyle(action); const animations = root.getAnimations ? root.getAnimations({ subtree: true }) : []; return rect.left >= 0 && rect.right <= innerWidth && rect.width > 0 && rect.height > 0 && style.display !== 'none' && style.visibility !== 'hidden' && Number(style.opacity) === 1 && animations.every((item) => item.playState === 'finished'); })()"
agent-browser --session phy-v2-auth eval --stdin < tests/visual/chat/redact-identity.js
agent-browser --session phy-v2-auth eval --stdin < tests/visual/chat/measure-geometry.js | tee ../../.codex/evidence/frontend-v2/3A.10/chat__sidebar-mobile-open__390x844__en-US__light.geometry.json
test -s ../../.codex/evidence/frontend-v2/3A.10/chat__sidebar-mobile-open__390x844__en-US__light.geometry.json
agent-browser --session phy-v2-auth eval --stdin < tests/visual/chat/redact-identity.js
agent-browser --session phy-v2-auth eval --stdin < tests/visual/chat/assert-geometry.js
agent-browser --session phy-v2-auth eval --stdin < tests/visual/chat/redact-identity.js
agent-browser --session phy-v2-auth screenshot ../../.codex/evidence/frontend-v2/3A.10/chat__sidebar-mobile-open__390x844__en-US__light.png
agent-browser --session phy-v2-auth reload
agent-browser --session phy-v2-auth wait '[data-testid=chat-root]'
agent-browser --session phy-v2-auth eval --stdin < tests/visual/chat/redact-identity.js
```

After any visible Language/Theme interaction, wait for the expected safe
`documentElement.lang`/`data-theme`, run redaction again, and restart the exact
snapshot→measure/save→assert→screenshot sequence. Reload and redact after each
image. Only after the entire authenticated matrix and ledger are complete may QA
run:

```bash
agent-browser --session phy-v2-auth close
```

## Boundary geometry matrix (closure)

Run the canonical `measure-geometry.js` → save JSON → `assert-geometry.js`
sequence at every row below. jsdom/Vitest responsive contracts deliberately make
**no** browser geometry claim — only this live two-eval sequence proves overflow,
primary-action visibility, viewport escape, and last-message clearance.

Required viewport pairs (plus the four canonical viewports above):

| Viewport | Route / fixture | Expectation |
|---|---|---|
| `599x900` | auth `/chat` + harness when transient | mobile: closed trigger visible; open drawer primary visible |
| `600x900` | auth `/chat` + harness when transient | same as 599 (still `< 900`) |
| `899x900` | auth `/chat` + harness when transient | mobile boundary below 900 |
| `900x900` | auth `/chat` + harness when transient | compact desktop; primary action visible |
| `1279x900` | auth `/chat` + harness when transient | compact desktop; primary action visible |
| `1280x900` | auth `/chat` + harness when transient | expanded desktop; primary action visible |
| `1440x900` | canonical | desktop |
| `1024x768` | canonical | compact |
| `768x1024` | canonical | mobile pair (closed + open) |
| `390x844` | canonical | mobile pair (closed + open) |

Every PASS row must prove:

- document and transcript `scrollWidth <= clientWidth`
- Composer rect inside the viewport
- `lastMessage.bottom <= composer.top` when a last message exists
- desktop/compact: primary action visible
- closed-mobile: sidebar trigger visible; paired open-drawer: primary visible

### Boundary capture sketch

```bash
cd apps/web
set -e
set -o pipefail
mkdir -p ../../.codex/evidence/frontend-v2/3C.8
test -d ../../.codex/evidence/frontend-v2/3C.8
# Example boundary row (harness). Authenticated rows use phy-v2-auth + redact.
agent-browser --session phy-v2-fixture set viewport 899 900
agent-browser --session phy-v2-fixture set media light
agent-browser --session phy-v2-fixture open 'http://127.0.0.1:5174/tests/visual/chat/?state=sidebar-mobile-closed&locale=en-US&theme=light'
agent-browser --session phy-v2-fixture wait --fn "document.querySelector('[data-testid=chat-visual-root]')?.dataset.fixtureReady === 'true'"
agent-browser --session phy-v2-fixture eval --stdin < tests/visual/chat/measure-geometry.js | tee ../../.codex/evidence/frontend-v2/3C.8/chat__sidebar-mobile-closed__899x900__en-US__light.geometry.json
test -s ../../.codex/evidence/frontend-v2/3C.8/chat__sidebar-mobile-closed__899x900__en-US__light.geometry.json
agent-browser --session phy-v2-fixture eval --stdin < tests/visual/chat/assert-geometry.js
```

### Result-recording table

Record one row per capture. Geometry PASS requires saved measurement JSON plus
`assert-geometry.js` exit 0; Blocked/Not Captured leave the wave FAIL (never a
waiver).

| viewport | locale | theme | state | fixture_source | geometry | identity_redaction | screenshot | notes |
|---|---|---|---|---|---|---|---|---|
| 599x900 | en-US | light | empty | authenticated-route / tests/visual/chat | PASS / FAIL / Blocked / Not Captured | dom-only / not-needed-synthetic | path or — | |
| 600x900 | … | … | … | … | … | … | … | |
| 899x900 | … | … | … | … | … | … | … | |
| 900x900 | … | … | … | … | … | … | … | |
| 1279x900 | … | … | … | … | … | … | … | |
| 1280x900 | … | … | … | … | … | … | … | |
| 1440x900 | … | … | … | … | … | … | … | |
| 1024x768 | … | … | … | … | … | … | … | |
| 768x1024 | … | … | sidebar-mobile-closed / open | … | … | … | … | pair required |
| 390x844 | … | … | sidebar-mobile-closed / open | … | … | … | … | pair required |

Manual assistive / zoom / touch rows (human):

| check | result | notes |
|---|---|---|
| 200% zoom | PASS / FAIL / Not Captured | |
| prefers-reduced-motion | PASS / FAIL / Not Captured | |
| forced colors | PASS / FAIL / Not Captured | |
| keyboard-only operation | PASS / FAIL / Not Captured | |
| screen-reader announcements | PASS / FAIL / Not Captured | |
| touch actions | PASS / FAIL / Not Captured | |
| mobile soft-keyboard safe area | PASS / FAIL / Not Captured | |

When Vite/Go/Bot are unavailable, mark live geometry and authenticated rows
`Blocked: services unavailable` / `Not Captured`. Do not invent PASS.

## Dedicated typecheck

Root `npm run type-check` excludes `tests/**`. Always also run:

```bash
npx vue-tsc --noEmit -p tests/visual/chat/tsconfig.json
```
