# Chat visual fixtures

Test-only Vite harness for deterministic Chat transient states. Production source
must never import or register this tree. Authenticated `/chat` remains the
integration authority for login, route guards, and real sidebar flows.

Harness URL shape:

```text
/tests/visual/chat/?state=<key>&locale=<locale>&theme=<theme>
```

Accepted dimensions:

- `state`: `empty` | `populated` | `attachment` | `sending` | `picker-open` |
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

`viewport`, `document`, `root`, `transcript`, `primaryAction`,
`navigationTrigger`, `composer`, `lastMessage`, `state`, `pass`

`transcript` includes `scrollTop`, `scrollHeight`, `clientHeight`, `clientWidth`,
`scrollWidth`, and `atBottom`. Rect records include measured edges.
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

## Canonical viewports

Repeat capture for each pair: `1440 900`, `1024 768`, `768 1024`, `390 844`.
Repeat URL/media/evidence names for both locales and both themes.

Evidence filename matrix:

```text
chat__<state>__<W>x<H>__<locale>__<theme>.png
chat__<state>__<W>x<H>__<locale>__<theme>.geometry.json
```

Closed and open mobile are different exact states — never infer one from the other
(`sidebar-mobile-closed` / `sidebar-mobile-open`).

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

## Dedicated typecheck

Root `npm run type-check` excludes `tests/**`. Always also run:

```bash
npx vue-tsc --noEmit -p tests/visual/chat/tsconfig.json
```
