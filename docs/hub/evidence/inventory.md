# Inventory and audits (M0.5–M0.9)

- **Date:** 2026-10-17
- **Commit:** 74831d2 (working tree adds only `docs/hub/`)
- **Method:** source read of each file named below; package facts from the npm registry (`registry.npmjs.org/<pkg>/latest`);
  Astro facts from the installed `node_modules/astro` (7.0.9); Supabase facts from the Supabase docs search. No
  project, service or account was created.

## 1. Routes (old site, 26 pages + games)

| Source | Built routes | Fate in the plan |
|---|---|---|
| `src/pages/index.astro` | `/` | Rebuilt as Welcome (M1) |
| `src/pages/arcade.astro` | `/arcade/` | Rebuilt as catalogue (M3) |
| `src/pages/lab.astro` | `/lab/` | Rebuilt for Lab experiments; current toys retired (§3) |
| `src/pages/projects/index.astro` | `/projects/` | Kept only if a project passes the QG (Q-02) |
| `src/pages/projects/[slug].astro` | 16 detail pages (`/projects/<slug>/`, incl. `/projects/arcade/`) | Source-link-only pages removed → 301 to `/projects/`; `look-above` and `global_unrest` → `/lab/<slug>/` |
| `src/pages/about.astro` | `/about/` | Rewritten from owner facts (Q-03) |
| `src/pages/contact.astro` | `/contact/` | 301 → `/about/#contact` |
| `src/pages/field-notes/index.astro`, `[slug].astro` | `/field-notes/` + 3 notes | Keep or drop per Q-03 |
| `src/pages/404.astro` | `/404.html` | Kept |
| `public/games/*.html` | `/games/{mario,dk64,tetris,kaboom,stacker}.html` | Mario/DK64/Tetris/Kaboom dropped (D-03); Stacker moves to origin G |

## 2. Public assets

| File | Bytes | Note |
|---|---|---|
| `public/games/vendor/three.min.js` | 603,445 | Only used by `dk64.html`; removed with it |
| `public/games/mario.html` | 38,853 | Dropped (D-03) |
| `public/games/dk64.html` | 22,034 | Dropped (D-03) |
| `public/games/stacker.html` | 17,320 | Reworked (§4) |
| `public/games/kaboom.html` | 13,989 | Dropped (D-03) |
| `public/games/tetris.html` | 10,742 | Dropped (D-03) |
| `public/og-default.png` | 50,401 | Old aesthetic; replace in M1 |
| `public/favicon.svg`, `favicon.ico`, `robots.txt` | 749 / 655 / 83 | Review in M1 |

Recruiter copy still present: `src/data/contact.ts:30` `availability: "Open to work on …"`. Remove in M1.

## 3. Toy audit (D-13: retire unless real data)

| Module | Lines | Mounted on | Data | Verdict |
|---|---|---|---|---|
| `RadarToy.ts` | 117 | `/lab/`, project pages | Aircraft from `Math.random`; captioned "Synthetic radar scope … not live air-traffic data" | Simulated → **retire** |
| `SignalMapToy.ts` | 107 | `/lab/`, project pages | Local synthetic points, captioned as such | Simulated → **retire** |
| `SpectrogramToy.ts` | 41 | `/lab/`, project pages | Procedural sine/hash bars, no mic or audio; captioned "demo bars" | Simulated → **retire** |
| `TerminalToy.ts` | 145 | `/lab/` | Lookup-table pseudo-terminal: SKILLS list, `open` to old project routes, random project | Recruiter content pointing at removed routes → **retire** |
| `ReactionMiniGame.ts` | 105 | `/lab/`, project pages | Real measurement of the visitor's reaction | **Keep**, fix QG gaps below before publishing |

The captions are honest, so nothing on the live site misleads today. They still fail the new bar ("no fake demos").

### Reaction QG gaps (fix in M3)

How it works now: 5-round sets, false-start detection, best average in localStorage via `clientState`
(`getReactionBestScore`/`setReactionBestScore`). Random delay 800–2600 ms via `setTimeout`. `goAt = performance.now()`
is taken in the timeout callback. Input is the button's `click` only.

1. **Input event adds latency.** `click` fires on release; keyboard Space fires on keyup, adding hold time. Use
   `pointerdown` and `keydown` (Space/Enter, ignore `e.repeat`).
2. **Timestamp source.** RT is `performance.now()` in the handler. Use `event.timeStamp` (same clock, excludes
   handler queueing delay).
3. **Start stamp is pre-paint.** `goAt` is taken before the green frame is painted, overstating RT by up to one frame.
   Stamp in a `requestAnimationFrame` callback after the style change.
4. **No anticipation floor.** A press under ~100 ms after go should count as a false start.
5. **No background-tab handling.** If the tab is hidden mid-wait the timer can fire while hidden and record a huge
   RT. Abort the round on `visibilitychange` (CLAUDE.md background-tab rule).
6. **a11y.** `aria-live` sits on the button whose label changes. Move announcements to a separate live region.

## 4. Stacker audit (`public/games/stacker.html`, 539 lines)

**Timing: already dt-based.** `loop(now)` uses `dt = Math.min(0.05, (now − lastTime)/1000)` and
`pos += dir*speed*dt` (cells/second). Edge bounce clamps `pos` and drops overshoot. So speed is the same at
60/120/144 Hz, and the §5.1 conversion is not needed. Remaining timing issues:
- The 50 ms dt clamp slows play below 20 fps.
- The stop uses the last-frame `pos`, not `pos` extrapolated to `e.timeStamp`: up to one frame of input lag
  (16.7 ms at 60 Hz, 6.9 ms at 144 Hz). This matters for a fair Impossible tier.
- rAF runs continuously, even idle; no `visibilitychange` handling (the dt clamp covers resume).

**Constants.** `COLS=7`, `ROWS=15`, `CELL=40`, `PAD=6` → canvas 292×612, no DPR scaling (blurry on high-DPR
screens). `MINOR_ROW=12`, `MAJOR_ROW=15`. `widthForRow`: 3 for rows 1–3, 2 for 4–9, 1 for 10+.
`speedForRow`: `4.5 + row*0.55`; in "Arcade mode" `6 + row*0.9`, plus `(row − MINOR_ROW + 1)*3.5` at prize rows;
times `speedMult`.

**Random rigging.** With the "Arcade mode" checkbox on, rows ≥12 get a random `arcadeOffset` nudge of
`0.30 + (row − 12)*0.12` cells. That is random, not skill. For A-ARC-05 ("winnable, not random"), Impossible must not
use it, and the bot test runs with it off.

**Where Impossible plugs in.** `DIFFICULTY = {easy .72, normal 1.00, hard 1.45, insane 2.00}` with labels; the
`<select id="difficulty">` options; `startGame` reads `speedMult`. `widthForRow` is global, so Impossible needs a
per-tier width function (start width 2) and an earlier ramp. Stats live in localStorage `stacker-stats`
`{minor, major, tickets}`, not per tier; a separate Impossible best needs a new key.

**Input (corrects plan §1.1, which said "no touch handlers").**
- `document` keydown: Space stops, `e.repeat` not filtered (holding Space auto-stops rows); R restarts; no Enter.
- Board: `mousedown` + `touchstart` (`passive:false`, `preventDefault` while playing). No pointer events, no large
  Stop button, no `touch-action` CSS. Start button uses `onclick`.

**Layout (why it fails on phones).** `body` flex, padding 20px, `min-height:100vh`; `#game-wrapper` flex row, 24px
gap; `#cabinet` fixed 320px; `#board-container` `max-content`; canvas 612px tall; `#side-panel` fixed 180px. Minimum
width ≈544px; too tall for landscape phones; no safe-area handling. A viewport meta is present.

**Honesty and trademark risks (new, for the owner).**
- The name "STACKER" and the orange/yellow striped marquee likely mirror LAI Games' *Stacker* cabinet (name and trade
  dress). Needs a check; probably a rename and restyle before publishing (QG item 5).
- "Play · $1", "— $1.00 PER PLAY —", tickets and "Jackpot" are simulated money/prize framing. Recommend replacing
  with plain score language.

## 5. Library licences (M0.8)

| Package | Latest | Licence | Runtime deps | Unpacked size | Verdict |
|---|---|---|---|---|---|
| `chess.js` | 1.4.0 | BSD-2-Clause | none | 723,850 B | OK (rules, FEN, PGN) |
| `cm-chessboard` | 8.15.3 | MIT | none | 264,242 B | OK (board) |

Unpacked size includes docs and source maps; real bundle cost is measured when they're added in M4.

## 6. Platform checks (M0.9)

**Astro 7.0.9 CSP: supported.** `security.csp` (since 6.0) hashes Astro's bundled and inline scripts and styles,
with `algorithm`, `directives`, `scriptDirective` and `styleDirective` options. Limits that matter here:
- It emits a `<meta http-equiv="content-security-policy">`, which can't carry `frame-ancestors`. That, plus
  nosniff/Referrer-Policy/Permissions-Policy, must go in `_headers`.
- Not active in `astro dev`; test with `build` + `preview`.
- No `<ClientRouter />`, no Shiki (the site uses neither).
- The blocking init script in `BaseLayout.astro` is inline, so it gets a hash automatically. No post-build hash script
  needed.

**Supabase `pg_jsonschema`: documented as an available extension** (`create extension pg_jsonschema with schema
extensions;`, functions `json_matches_schema` / `jsonb_matches_schema`, used in check constraints). The docs page
gives no plan restriction. **Not verified on a live free project** (none exists yet); confirm with `list_extensions`
right after the M2 project is created. Fallback: validate in the `publish` RPC with ajv-equivalent checks in SQL, or
in an Edge Function.
