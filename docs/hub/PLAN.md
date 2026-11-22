<!-- Approved 2026-10-17. Source of truth for the hub rebuild. Copied from the approved plan file; edit here, not there. -->

# Hub rebuild plan: arcTanMyAngle

## Context

The site (`arctanmyangle.github.io`) is an Astro 7 + Bun static portfolio. It has a dark "instrument panel" look aimed at recruiters, and it is hosted on GitHub Pages. The owner dislikes the design and isn't job hunting. They want a fast, joyful hub for themselves and friends, with:

- quick access to real games;
- a Lab for experiments they will keep improving;
- a chess opening explorer;
- guitar tabs;
- a small about/contact page;
- an owner-only admin to publish content without editing code.

**Quality bar, from the owner:** nothing goes on the site that "isn't good by any means or standards." Every published item passes the Quality Gate (QG, §6). That rules out fake demos, dead cards, source-link-only projects and simulated persistence.

This is a plan only. Nothing is implemented, installed, provisioned or deployed until the plan is approved. Each milestone has its own stop condition.

---

## 1. Facts, decisions, defaults, open questions

### 1.1 Verified facts (M0 re-checks these)

**Stack.** Astro `^7.0.9` (static output), `motion@^13.1.1`, `@astrojs/sitemap`, TypeScript 5.7. `bun.lock` is present.

**Deploy.** `.github/workflows/deploy.yml` deploys to GitHub Pages.
- Bun version is not pinned.
- `sync:github` runs at build time.
- GitHub Pages limits: no custom headers, gzip only, `max-age=600`, and only meta-refresh redirects.
- A second Pages site on the same account shares the `*.github.io` origin.

**Games run unsandboxed on the main origin.** `ArcadeCabinet.astro` sets `frame.src = '/games/<file>'` on an iframe with no `sandbox` attribute. Any admin token stored on that origin would be readable by game code. **This must change before any admin exists.**

**Game files in `public/games/`:**
- `mario.html` ("Super Mario World"), `dk64.html` ("DONKEY KONG 64", uses Three.js r128 under MIT), `tetris.html`, `kaboom.html` ("Kaboom! by Activision"), `stacker.html`.
- The first four carry trademark or trade-dress risk. Kaboom also misattributes authorship.

**`stacker.html` (539 lines):**
- Difficulty tiers top out at `insane` (`mult: 2.00`); `MINOR_ROW=12`, `MAJOR_ROW=15`.
- Fixed layout (`width:320px`, panel `180px`, `max-content`) and no touch/pointer handlers. That is why it fails on phones.

**Catalogue entries that can't run in a browser.** `ArcadeCabinet` lists Wii Kart (Rust), Uncanny Carnival and Galaga. They don't qualify.

**Project URLs (live probes):**
- `real-time-reaction.vercel.app` → **404**, so it doesn't qualify.
- `roomies4sac.vercel.app` → 200; still needs an ownership and quality review.

**Headers.** The live site sends no CSP or `X-Frame-Options`.

**Supabase.** The account's only project is "Chemclicks" (unrelated). A new free project is needed; the free tier allows 2 active projects.

**Lab sources:**
- `look-above` is native Rust: tokio, rayon, wgpu, SQLite, crossbeam.
- `global_unrest` is Rust + DuckDB + Parquet + H3.

### 1.2 Owner decisions (from answers)

| ID | Decision |
|---|---|
| D-01 | Public site, catalogue only. No visitor accounts, rooms, scores or multiplayer. Only the owner signs in. |
| D-02 | Hosting: **Cloudflare Pages** (main site plus a separate games/lab origin) and a **new free Supabase project** for owner auth (GitHub OAuth), drafts and storage. Budget is $0. |
| D-03 | The four trademark-named games (Mario, DK64, Tetris, Kaboom) are **dropped from launch**. They return later only as original rebrands that pass the QG. |
| D-04 | `look-above` (plane tracker) and `global_unrest` (live global signals) get browser-launchable versions in the **Lab**, labelled "Experiment". |
| D-05 | Stacker gets a tier harder than `insane` and must work properly on phones. |
| D-06 | Visual direction: **Clean zine**, meaning editorial, calm, strong type, whitespace and hand-drawn accents. |
| D-07 | Chess repertoire, with variations chosen by popularity on Lichess (see §5.4): Italian Game, Giuoco Piano, London System, Vienna Gambit, Berlin Defence, Accelerated Dragon. |

### 1.3 Proposed defaults (adopted unless the owner objects)

**Launch arcade:**
- Stacker, after the new tier, the mobile fix and the QG.
- Reaction (`src/components/ReactionMiniGame.ts`, first-party), after the QG.

**Chess sides:**
- White: Italian, Giuoco Piano, London, Vienna Gambit.
- Black: Berlin, Accelerated Dragon.
- That makes 6 openings × 2 variations = 12 lines. This supersedes the "2+2" default.

**Contact.** The GitHub profile `https://github.com/arcTanMyAngle`, which already works. Email stays off unless the owner adds it.

**Retiring the old site:**
- Simulated toys (`RadarToy`, `SignalMapToy`, `SpectrogramToy`, `TerminalToy`) are retired from public pages unless the M0 audit shows they render real data (rule: no fake demos).
- Recruiter copy (the availability line in `src/data/contact.ts`) is removed.
- The 13 project pages that are only source links are removed. Their old URLs get a 301 to `/projects/` (or `/lab/<slug>/` for the two Lab ports).

**Hiding sections.** Any section with zero published items is left out of the navigation and its route isn't generated, so it returns a real 404. No empty shelves.

### 1.4 Open questions (non-blocking until the milestone named)

| ID | Question | Blocks | Fallback |
|---|---|---|---|
| Q-01 | Guitar tabs: which 3 tabs, and do you hold the rights to them? (not answered yet) | Tab content in M5 | The `/tabs/` pipeline is built but stays unpublished. |
| Q-02 | Does `roomies4sac` qualify? Is it yours, and is it good enough? Should Real-TimeReaction be redeployed? | Projects content in M3 | Projects stays hidden until one item passes the QG. |
| Q-03 | About page facts (owner-written) and keep/drop for the 3 field notes | M5 | A minimal about page with GitHub contact only; field notes get a 301 to `/about/`. |
| Q-04 | Should Italian/Giuoco Piano also be tagged for Black? | M4 | White only. |

---

## 2. Stack: retain vs one alternative

| | **Retain: Astro 7 static + vanilla TS + Bun** (recommended) | Alternative: Vite multi-page app + vanilla TS |
|---|---|---|
| Route-level code splitting | Built in; zero JS by default | Manual multi-page config |
| Reuse | Layouts, `canvasLoop.ts`, `lazyMount.ts`, `clientState.ts`, `CommandPalette.ts`, `sync-github.mjs`, `projects.ts` | Would mean porting all of it |
| Static deep links, real 404s | Yes (`404.html`, directory format) | Manual |
| Risk | Low | Rewrite cost with no user-visible gain |

**Decision D-08:** retain Astro. Keep output static; no SSR adapter.

**Thin adapters only:**
- `src/lib/content/*`: snapshot reader and validators.
- `src/lib/players/*`: one adapter per game kind.
- `src/lib/chess/*`: a wrapper around chess.js.
- `src/admin/*`: a wrapper around supabase-js.

**Libraries (verify licence, version and size, one decision at a time, max 2 candidates each):**
- **Chess rules, FEN, PGN:** chess.js (BSD-2).
- **Board:** cm-chessboard (MIT) vs a static SVG renderer. Avoid chessground (GPL-3).
- **Auth:** supabase-js, loaded on `/admin/` only.
- **Schema validation:** ajv + JSON Schema in the admin and at build; `pg_jsonschema` in the database (check the extension is available).
- **Tests:** `bun test` (unit), Playwright + `@axe-core/playwright` (end-to-end and accessibility), Lighthouse CI (performance).
- **Explicitly not:** a handwritten chess engine, auth, crypto or PGN parser; Tailwind; any UI framework.

---

## 3. Architecture

### 3.1 Origins and isolation

| Origin | Serves | Notes |
|---|---|---|
| `A` = main Pages project (`<name>.pages.dev`) | Shell, catalogue, chess, tabs, about, `/admin/` | First-party code only. Strict CSP. Admin session lives here. |
| `G` = games/lab Pages project (`<name>-play.pages.dev`) | Vetted game bundles `/g/<slug>/`, Lab apps `/lab/<slug>/`, Pages Functions for Lab data proxies | Never holds credentials for `A`. |
| Supabase | Auth (GitHub OAuth), Postgres + RLS, Storage (images only) | Public pages never call it at runtime. |
| `arctanmyangle.github.io` | Redirect stubs only, after cut-over (M6) | GitHub Pages can't send a true 301, so stubs use meta-refresh + canonical + `location.replace`, preserving the path. That is a single hop. The repo-root `index.html` (course assignment) stays untouched. |

**Game frame:**
```
<iframe src="https://G/g/<slug>/" sandbox="allow-scripts allow-same-origin allow-pointer-lock" allow="fullscreen; gamepad" referrerpolicy="no-referrer">
```
- `allow-same-origin` is safe here only because `G` ≠ `A`. It lets games keep their own localStorage, such as Stacker high scores.
- No `allow-top-navigation`, `allow-popups` or `allow-forms`.

**`postMessage` contract `play/v1`:**
- The host accepts a message only if `event.origin === G` and `event.source === frame.contentWindow`, and the payload matches the schema `{v:1, type:'ready'|'error'|'exit', detail?}`.
- Anything else is dropped and counted in a debug log.
- The host may send `{v:1,type:'pause'|'resume'}` to `G` only.
- Game bundles add a 15-line `play-bridge.js`.

**Load and failure UX:**
- The game page shows a still and a **Play** button. Before click, no iframe or game bytes are fetched, so Welcome never loads a game.
- After Play: the frame loads with a visible "Loading…" state, and a 10 s timeout waits for `ready`.
- On timeout or error: "Couldn't start. Retry / Open in new tab / Back to arcade".
- Exit returns focus to the Play button.

### 3.2 Headers (`public/_headers` per project)

**Origin A:**
- `/_astro/*` → `Cache-Control: public, max-age=31536000, immutable`.
- HTML → `public, max-age=0, must-revalidate`.
- `Content-Security-Policy`:
  - `default-src 'self'`
  - `script-src 'self'` plus hashes for inline scripts. Use Astro's built-in CSP hashing if the installed version supports it; otherwise a post-build hash script.
  - `frame-src https://G` plus the allowlisted embed hosts
  - `connect-src 'self' https://<supabase-ref>.supabase.co`
  - `img-src 'self' https://<supabase-ref>.supabase.co data:`
  - `frame-ancestors 'none'`
  - `base-uri 'none'`
  - `form-action 'self'`
- Also: `X-Content-Type-Options: nosniff`, `Referrer-Policy: strict-origin-when-cross-origin`, and a `Permissions-Policy` that denies camera, mic and geolocation.

**Origin G:**
- `frame-ancestors https://A`.
- A per-bundle CSP: `connect-src 'self'` only, unless a bundle declares a Lab proxy.
- `Cross-Origin-Resource-Policy: same-site`.
- Lab apps that need WASM threads add COOP/COEP on their path only.

**Compression:** Cloudflare serves Brotli/gzip automatically. Verified in M1 (A-OPS-02).

**Routing rules:**
- 404: `404.html` must exist at the root of each project. Without it, Pages falls back to an SPA-style 200.
- Trailing slashes: Astro `build.format:'directory'`, and every internal link ends in `/`. That allows at most one redirect, which `_redirects` returns as a 301.

### 3.3 Data model (Supabase, new project)

| Object | Access (RLS) | Purpose |
|---|---|---|
| `owners(user_id uuid pk)` | No client access | Allowlist. `is_owner()` is a `security definer` function. |
| `drafts(id, kind, slug, data jsonb, qa jsonb, updated_at)` | Owner only (select/insert/update/delete) | Private working copies. `data` is checked by `pg_jsonschema` against `contracts/<kind>.schema.json`. |
| `published(id, kind, slug, sort_order, data jsonb, published_at)` | `anon` select; **no client writes** | Public metadata |
| `audit_log(at, actor, action, entry_id, diff)` | Owner select; insert only via RPC | Durable history |
| RPCs `publish(id)`, `unpublish(id)`, `reorder(kind, ids[])` | `security definer`; check `is_owner()` | `publish` re-validates the schema, requires `qa.passed=true` (QG sign-off), checks URLs against the allowlist, and writes the audit log. |
| Storage bucket `images` | Public read; owner write | MIME `image/png\|jpeg\|webp`, ≤1 MB. **No SVG or HTML.** |

**Kinds and adapters (adding content needs no code edits):**
- `game`:
  - `bundle`: a path from the `G` manifest `games-manifest.json`. Bundles reach `G` by a content commit to `play/`.
  - `site-module`: a registered first-party module id, e.g. `reaction`.
  - `embed`: an https URL whose host is in `contracts/allowed-embed-hosts.json`. Its `frame-ancestors`/`X-Frame-Options` are checked at publish; if framing is blocked, it becomes an "Opens in new tab ↗" launch, clearly marked.
- `lab`: like a `bundle` game, plus `experiment:true` and `updatedAt`.
- `project`: a runnable URL or a viewable output (screenshots/video), plus an optional source link. A source link alone fails validation.
- `opening`: PGN per variation, validated by chess.js at publish and at build.
- `tab`: text, title, tuning, source/rights.
- `about`: a single row.

**URL validator:**
- https only; reject `javascript:`/`data:`/`blob:`, credentials in the URL, IP-literal hosts and punycode lookalikes.
- The host must be on the allowlist for `embed`.
- Shared by the admin (ajv) and the RPC (SQL).

**Sign-up lockdown.** After the owner's first GitHub sign-in, turn off "Allow new users to sign up". A stray GitHub account still can't write, because RLS checks `is_owner()`.

### 3.4 Publish → static site flow

1. The owner publishes on `/admin/`.
2. A row change in `published` fires a Supabase Database Webhook (`pg_net`) to the **Cloudflare Pages deploy hook** for `A`. The hook URL is stored as a secret in Supabase only.
3. The Cloudflare build runs `bun run sync:github` and `bun run snapshot:content`. The new `scripts/snapshot-content.mjs` fetches `published` via PostgREST with the anon key and writes `src/data/published.snapshot.json`. On any failure it falls back to the committed snapshot, the same pattern as `sync-github.mjs`. Then the build runs.
4. Static pages are generated per published item, so deep links are real and unpublished items get a real 404. Target: live in ≤5 min (A-ADMIN-06).

**Admin preview.** `/admin/preview/?id=` renders a draft client-side through the same components, fetched with the owner's session. It is never statically generated.

**Weekly refresh.** A GitHub Actions cron, `refresh-snapshot.yml`, refreshes and commits the snapshot. That keeps the fallback current and also counts as Supabase activity against the ~7-day free-tier pause. If Supabase is paused, the public site is unaffected; only the admin needs a dashboard restore (runbook in M6).

**CI split:**
- GitHub Actions runs checks on PRs and main: typecheck, build, unit, e2e, axe, Lighthouse CI, budgets, RLS tests via `supabase start` (Docker on ubuntu runners).
- Cloudflare Pages Git integration does the production builds (`BUN_VERSION` pinned).
- Runtime GitHub API calls stay limited to `sync-github.mjs`.

### 3.5 Routes (origin A)

| Route | Content |
|---|---|
| `/` | Welcome: a one-line hello; a **Play Stacker** primary button; shelves for Arcade, Lab, Chess, Tabs and Projects (published only). No intro, no audio. |
| `/arcade/`, `/arcade/<slug>/` | Catalogue; game page with player, controls, supported devices, attribution |
| `/lab/`, `/lab/<slug>/` | Experiments with "Experiment · updated <date>" labels and launch |
| `/chess/`, `/chess/<opening>/<variation>/` | Opening explorer; each line is deep-linkable |
| `/tabs/`, `/tabs/<slug>/` | Text tabs |
| `/projects/`, `/projects/<slug>/` | Real runnable tools or outputs |
| `/about/` | Owner facts plus contact. `/contact/` gets a 301 to `/about/#contact`. |
| `/admin/`, `/admin/preview/` | `noindex`, excluded from the sitemap, loads supabase-js |
| `/404` | Real 404 |

**Removed modules.** `BeamBackground`, `WindowFrame`, `StatusLight` and the shine toggle in `DisplayControls` belong to the old aesthetic. `DisplayControls` shrinks to theme + reduced-motion.

**Kept modules:**
- The blocking init script in `BaseLayout.astro`. Attributes become `data-theme` and `data-motion`. `data-shine` is removed. `data-reveal-state` stays only if the chosen prototype uses reveal.
- `canvasLoop.ts`, `lazyMount.ts`, `clientState.ts` (`STORAGE_KEYS`).
- `CommandPalette.ts`, with commands re-pointed: "play stacker", "open chess", and so on.

---

## 4. Budgets (to be confirmed against the M0 baseline)

| ID | Budget |
|---|---|
| A-PERF-01 | ≤150 KiB compressed first-party JS per route (`/admin/` included). Third-party Lab runtimes (e.g. DuckDB-WASM) load only after an explicit "Launch" with a progress indicator. They are recorded as an exception in DECISIONS, never on Welcome. |
| A-PERF-02 | ≤500 KiB initial page weight (compressed). Welcome target ≤150 KiB. |
| A-PERF-03 | Controls show visible acknowledgement within 100 ms (pressed state, measured with Event Timing in Playwright). |
| A-PERF-04 | Lab p75 LCP ≤2.5 s, INP ≤200 ms, CLS ≤0.1. Field p75 needs real-user monitoring, which isn't set up; Cloudflare Web Analytics is free and cookieless if the owner wants it (DECISIONS). |
| A-PERF-05 | Median mobile Lighthouse ≥90 over 3 cold runs on `/`, `/arcade/`, `/arcade/stacker/`, `/chess/`, `/tabs/<slug>/` |
| A-OPS-01 | Correct cache headers (§3.2) |
| A-OPS-02 | Brotli or gzip on HTML/CSS/JS |
| A-OPS-03 | Every old URL reaches its final page in ≤1 redirect |
| A-OPS-04 | Removed pages return a real 404 status |
| A-A11Y-* | WCAG 2.2 AA: target size ≥24 px (game controls ≥44 px), focus visible and not obscured, keyboard everywhere, reduced motion honoured via `data-motion`, 200%/400% zoom reflow |

---

## 5. Feature specs

### 5.1 Stacker (`stacker.html` → `play/stacker/` on G)

**Timing.** Audit whether movement is frame-based. If it is, convert it to `dt`-based so speed is the same at 60/120/144 Hz. This is a prerequisite for a fair hard tier.

**New tier "Impossible" above `insane`:**
- Higher `mult`; the starting width drops to 2 from row 1; the rig offset begins earlier.
- Exact values come from playtesting, not guessed.

**Acceptance (A-ARC-05):**
- A frame-perfect scripted bot can clear it at 60 Hz and 120 Hz. That proves it is winnable, not random.
- The owner or a tester confirms it is harder than `insane`.
- Its best score is stored separately.

**Mobile (A-ARC-06):**
- Responsive canvas: CSS `width:min(100%, …)`, `aspect-ratio`, internal resolution fixed and scaled by DPR.
- The panel stacks below the board at <560 px.
- `pointerdown` anywhere on the board, or on a large Stop button (≥44 px), triggers the drop.
- `touch-action: manipulation`, no double-tap zoom, no page scroll while playing; `env(safe-area-inset-*)`.
- Works from 320 px wide, in portrait and landscape.
- Keyboard: Space/Enter. Restart: R.

### 5.2 Reaction

`ReactionMiniGame.ts` is registered as `site-module:reaction`. Its QG review checks:
- timing honesty, using `performance.now()`;
- false-start handling;
- touch and keyboard input;
- reduced motion.

### 5.3 Lab ports (track L, runs alongside M3–M4)

Each port follows the same steps:

1. Feasibility spike (≤3 days, with a stop condition).
2. Data-rights check, recorded in `evidence/rights/<slug>.md`.
3. Proxy and credential design.
4. Build on G.
5. QG.
6. Published with the "Experiment" label and a changelog.

If the spike's stop condition fires, nothing is published for that item and the owner is told.

**L1 `look-above` (plane tracker).**
- **Spike question:** WASM build of the Rust core (wgpu → WebGPU/WebGL2; replace tokio/rayon/SQLite with browser equivalents) vs a thin TS/canvas viewer over the same data. Pick by bundle size and effort.
- **Stop condition:** WASM is over 3 MiB compressed, or more than 2 weeks of work → TS viewer.
- **Data:** live positions come through a **Pages Function proxy on G** (`/api/flights?bbox=`). It caches 10–15 s and enforces bbox size limits plus per-IP rate limits. Any API credentials are Cloudflare secrets, never sent to the browser.
- **Source candidates (pick 1 after checking terms):** OpenSky (now OAuth2 client credentials; non-commercial terms) vs adsb.lol (open data, ODbL). Attribution is shown in the UI.

**L2 `global_unrest` (live global signals).**
- **Spike question:** DuckDB-WASM + h3-js querying a Parquet snapshot vs pre-aggregated H3-binned JSON plus h3-js. Prefer the lighter option if it can answer the app's queries.
- **Pipeline:** a scheduled GitHub Action (daily) runs the existing Rust pipeline, publishes the snapshot to G, and shows "data as of <timestamp>".
- **Rights:** verify every source. GDELT allows reuse with attribution. ACLED restricts redistribution, so exclude ACLED unless its terms permit this use.
- **Stop condition:** a source can't legally be redistributed, or the snapshot is over 5 MiB compressed with no viable aggregation → publish without that source, or don't publish.

### 5.4 Chess explorer

**Content rule (D-07): choosing variations by popularity**

1. At M4 start, query the Lichess opening explorer for the Lichess games database. Parameters, all recorded:
   - rating band 1800–2200;
   - speeds rapid + classical;
   - date window = last 12 months.
2. At each opening's branch point, take the **two most-played continuations by game count**. Exclude lines owned by another entry: the Italian excludes `3…Bc5`, which belongs to Giuoco Piano.
3. Extend each line to 10–14 plies by following the most-played move at each ply.
4. Record the query, date and counts in `evidence/chess/popularity.md`.

If the explorer API needs authentication, use the owner's personal token locally (never committed), or read the web explorer and save screenshots as evidence. chess.com has no public explorer API, so Lichess is the source.

**No game counts are written anywhere until they are measured.** The provisional branch points below are factual move orders; their popularity is not yet verified.

| Opening (side) | Moves to branch point | Branch candidates to test |
|---|---|---|
| Italian Game (W) | 1.e4 e5 2.Nf3 Nc6 3.Bc4 | Black's 3rd move, excluding 3…Bc5 (e.g. 3…Nf6, 3…Be7) |
| Giuoco Piano (W) | …3.Bc4 Bc5 | White's 4th move (e.g. 4.c3, 4.d3, 4.O-O) |
| London System (W) | 1.d4 … 2.Bf4 | Black's 1st reply (e.g. 1…d5, 1…Nf6) |
| Vienna Gambit (W) | 1.e4 e5 2.Nc3 Nf6 3.f4 | 3…d5, 3…exf4 |
| Berlin Defence (B) | 1.e4 e5 2.Nf3 Nc6 3.Bb5 Nf6 | White's 4th move (e.g. 4.O-O, 4.d3) |
| Accelerated Dragon (B) | 1.e4 c5 2.Nf3 Nc6 3.d4 cxd4 4.Nxd4 g6 | 5.Nc3, 5.c4 |

**Behaviour:**
- **Filters.** White / Black / All. The repertoire side is independent of the **board orientation** toggle (A-CHESS-02).
- **Previews.** Static and server-rendered: a key position as a static board, built at build time from FEN via chess.js. A variation `<select>` sits on each card.
- **Untouched preview.** Changing the variation updates the still and does not animate (A-CHESS-03).
- **Activation.** Clicking Play or pressing Enter on a card lazy-loads the board module and starts the chosen line from move 0. Changing the variation on an activated opening resets and starts that line (A-CHESS-04).
- **Controls:**
  - Play/Pause, Previous, Next, Reset (≥44 px);
  - Speed: 0.5×, 1×, 2×;
  - a move list as an ordered list of SAN plus an expanded text form, where the current move has `aria-current`;
  - keyboard: ←/→, Space, Home;
  - an `aria-live=polite` announcement such as "Move 7, White: knight to f3".

**Playback controller (`src/lib/chess/playback.ts`):**
- A single state machine with one timer handle and a `generation` counter.
- Every scheduled step checks the generation. Any switch, reset, unmount or `visibilitychange`→hidden clears the timer and bumps the generation.
- Positions are derived from the move index and never mutated incrementally. As a result, rapid switching can't interleave moves (A-CHESS-06).

**Reduced motion (`data-motion=reduced`).** No autoplay and no sliding animation. Play turns into discrete Next steps the user controls (A-CHESS-07).

**Rules and notation.** chess.js only. Unit tests cover FEN round-trip, PGN parsing, castling, en passant, promotion, check/checkmate, illegal-move rejection, and every repertoire line replaying legally.

### 5.5 Guitar tabs

- Text-first `<pre>` in system monospace, with a header: title, artist/composer, tuning, capo, source and rights statement.
- Narrow screens: horizontal scroll inside a labelled, focusable region (`role=region`, `tabindex=0`) — never page-level horizontal scroll. Plus a font-size control and an optional line-wrap at measure bars.
- Only content with rights confirmed by the owner (Q-01) is published.

### 5.6 Projects

- Runnable URL or viewable output only, checked by validation plus the QG.
- External launches are marked "Opens <host> ↗".
- Candidates depend on Q-02.

---

## 6. Quality Gate (QG). Required for every published item; enforced by the `publish` RPC through `qa.passed`

Recorded in `docs/hub/evidence/quality/<kind>-<slug>.md` with commit, environment, steps and evidence path. The checks:

1. **Works:** the full loop (start → play/use → restart → exit) on desktop Chrome, Firefox, Safari (WebKit) and on a phone viewport (Android Chrome and iOS Safari emulation, plus one real device if available). Desktop-only items must say so and are hidden from mobile shelves.
2. **No console errors.** Failure recovery is shown.
3. **Within budget** (§4).
4. **Accessible:** keyboard path, names and roles, contrast AA, targets, zoom, reduced motion. axe shows 0 serious or critical issues.
5. **Honest:** no fake data or simulated output passed off as real, accurate attribution, no third-party trademarks or trade dress, rights recorded.
6. **Owner sign-off:** "this is good". This is the owner's call.

---

## 7. Milestones

All effort figures are focused working days for one implementer and the coordinator; confidence is shown in brackets.

Every test below is **PLANNED** until it is executed. An executed test records its result, commit SHA, environment, steps and evidence path in `docs/hub/TASKS.md`.

### M0: Audit, inventory, baseline, decisions (1–2 d [high])

**Purpose:** freeze facts before building.
**Prerequisites:** plan approved.

**Scope:**
- Create `docs/hub/{PLAN,TASKS,DECISIONS,STATE}.md` and `docs/hub/evidence/`.
- Point `HANDOFF.md` to `docs/hub/STATE.md` (its "nothing committed" note is stale).
- Route and asset inventory.
- Baseline on the live site: 3 cold mobile Lighthouse runs per key route; per-route JS bytes from `dist/`; response headers.
- Audit the toys: real data or simulated?
- Stacker timing audit (frame vs `dt`).
- Licence checks for chess.js and cm-chessboard.
- Confirm `pg_jsonschema` is available on the Supabase free tier.
- Confirm the installed Astro version's CSP support.

**Artifacts:** the docs above; `evidence/baseline/*`; `evidence/inventory.md`.
**Owner:** coordinator, plus 1 read-only Explore agent for the toy audit.
**Acceptance IDs:** A-M0-01 (docs exist; STATE under 80 lines), A-M0-02 (baseline recorded), A-M0-03 (open questions listed with owners).
**Tests:** T-M0-01 baseline reproducible (rerun gives a median within ±5 points).
**Risks:** Lighthouse noise. Mitigation: median of 3 cold runs, throttling recorded.
**Stop condition:** baseline and inventory are committed, and every §1.4 question has an owner and a due milestone.

### M1: Visual direction, shell, routing, contracts, lazy boundaries, CI (4–6 d [medium])

**Prerequisites:** M0.

**Scope:**
- **Two Clean-zine prototypes**, as static `/proto/a/` and `/proto/b/` pages that aren't deployed publicly:
  - (a) "paper & ink", light-first;
  - (b) "night zine", dark-first.
  Both use system fonts only: `ui-serif, Charter, "Iowan Old Style", Georgia, serif` for headings, `system-ui` for body, `ui-monospace` for notation and tabs. Accents are hand-drawn inline SVG. No gradients. The owner picks one.
- Rewrite `tokens.css`/`global.css`/`effects.css` for the chosen direction.
- **Update `CLAUDE.md`:** aesthetic, hosting, the Supabase/admin exceptions, the attribute names. Its one-gradient rule is retired with the old aesthetic.
- New `BaseLayout` and routes per §3.5, with empty sections gated off.
- JSON Schemas in `contracts/` plus generated TS types.
- `snapshot-content.mjs` with a committed empty snapshot.
- Player adapter interfaces, the `play/v1` bridge, the lazy boundaries (no game, chess or admin code on `/`).
- `_headers` / `_redirects` / `404.html`.
- Create the two Cloudflare Pages projects (owner approval needed). Production builds run from Git with `BUN_VERSION` pinned.
- GitHub Actions CI: typecheck (`bunx tsc --noEmit`), `astro check`, build, `bun test`, Playwright + axe, Lighthouse CI, a bundle-budget script.
- Add devDependencies. The coordinator owns `bun.lock`.

**Artifacts:** `contracts/*.schema.json`, `src/lib/content/*`, `src/lib/players/*`, `play/` (G source), `.github/workflows/ci.yml`, the Cloudflare projects, `evidence/m1/*`.

**Acceptance IDs:**
- A-SHELL-01: Welcome has no forced intro, no autoplay audio, a Play entry in the first viewport, and zero game/chess/admin JS.
- A-SHELL-02: every route deep-links and reloads correctly; back/forward work.
- A-OPS-01..04.
- A-PERF-01/02 on the shell.
- A-A11Y-01: skip link, landmarks, focus order.

**Tests:**
- T-M1-01 network log on `/` has no `G`, chess or supabase requests.
- T-M1-02 direct reload of every route returns 200; an unknown path returns 404 status.
- T-M1-03 headers and compression via `curl -I` on both origins.
- T-M1-04 axe on all shell routes.
- T-M1-05 budget script fails CI when the threshold is exceeded (seeded failure).
- T-M1-06 a trailing-slash miss gives a single 301.

**Risks:**
- Cloudflare builds with Bun. Fallback: `wrangler pages deploy` from Actions.
- CSP hashing for inline scripts.

**Stop condition:** a prototype is chosen, the shell is deployed to `*.pages.dev`, and CI is green. GitHub Pages stays live until M6.

### M2: Owner-to-player slice. Architecture gate (4–7 d [medium-low])

**Prerequisites:** M1, plus owner approval to create the Supabase project and the GitHub OAuth app.

**Scope:**
- New Supabase project; migrations in `supabase/migrations/` owned by the coordinator. Tables, RLS, RPCs and the webhook as in §3.3–3.4.
- `/admin/`: GitHub sign-in, list/add/edit drafts per kind (schema-driven form), preview, QG checklist, publish, reorder, unpublish, sign out, and a session-expiry banner.
- One game adapter end-to-end: `bundle`, with Stacker moved as-is onto G, unpublished. Stacker improvements come in M3.

**Acceptance IDs:**
- A-ADMIN-01: the owner signs in with GitHub. A non-owner GitHub account signs in but every write is denied.
- A-ADMIN-02: draft → preview → publish → a **fresh guest browser** sees and plays the game at `/arcade/<slug>/`.
- A-ADMIN-03: unpublish → the route returns 404 after the rebuild; the draft is kept.
- A-ADMIN-04: edits, ordering and audit entries survive reload, sign-out and a new device.
- A-ADMIN-05: no admin token is reachable from `G`.
- A-ADMIN-06: publish to live in ≤5 min.
- A-SEC-01..06 (tests below).

**Tests:**
- T-M2-01 the full slice in Playwright with two browser contexts (owner, guest).
- T-M2-02 a guest/anon REST insert, update or delete on `drafts`/`published` → denied.
- T-M2-03 a non-owner JWT calling `publish` → denied.
- T-M2-04 an expired or tampered JWT → 401, and the admin UI shows a re-auth prompt without losing form state.
- T-M2-05 anon `select` on `drafts` → 0 rows (draft privacy).
- T-M2-06 invalid content (schema violations, a source-link-only project, `javascript:`/`data:`/credentialed/IP/non-allowlisted URLs, `qa.passed=false`) → rejected by the RPC, not just the UI.
- T-M2-07 a framed game reading `parent.localStorage`/`document.cookie` of A → SecurityError.
- T-M2-08 `postMessage` from the wrong origin, the wrong source, or with a malformed payload → ignored.
- T-M2-09 a blocked-embed URL → falls back to an "Opens in new tab" launch.
- T-M2-10 an RLS test suite (pgTAP or SQL asserts) runs in CI against `supabase start`.

**Risks:**
- Webhook or deploy-hook reliability. Mitigation: a "Rebuild now" admin button calls the same hook through an owner-only RPC.
- Free-tier pause. Mitigation: §3.4.

**Stop condition:** all A-ADMIN and A-SEC items pass. **If the slice can't meet A-ADMIN-02/03/05, stop and revisit D-02** (fallback recorded: Cloudflare D1 + Cloudflare Access) before M3.

### M3: Arcade and real projects; Lab spikes start (4–8 d [medium])

**Prerequisites:** M2 gate passed.

**Scope:**
- Stacker hard tier, `dt` timing and the mobile rework (§5.1).
- Reaction as `site-module`.
- Game page: controls, supported devices, attribution, restart/exit.
- QG run on both games.
- Projects per Q-02.
- Delete `mario/dk64/tetris/kaboom` and the Three.js vendor file from deploy output (they stay in git history).
- Rewrite `ArcadeCabinet` as a catalogue grid.
- **Track L:** L1 and L2 spikes (≤3 d each), in parallel, by implementer B.

**Acceptance IDs:** A-ARC-01 (play, restart, exit, focus return), A-ARC-02 (loading and failure recovery), A-ARC-03 (controls and devices listed), A-ARC-04 (attribution), A-ARC-05/06 (§5.1), A-PROJ-01 (every project runnable or viewable; external launches marked), A-LAB-00 (spike reports with go/no-go).

**Tests:**
- T-M3-01 gameplay smoke per game on Chromium, Firefox and WebKit, plus Pixel 7 and iPhone 14 emulation.
- T-M3-02 Stacker bot at 60/120 Hz.
- T-M3-03 a 320 px portrait layout with no horizontal scroll and targets ≥44 px.
- T-M3-04 a killed G load → timeout UI → retry works.
- T-M3-05 project URLs return 200 and render (Playwright).
- T-M3-06 the 100 ms acknowledgement on Play/Stop.

**Risks:** Stacker tuning is subjective. Mitigation: the bot proves the tier is winnable; the owner judges "fun".
**Stop condition:** 2 games pass the QG and are published. Projects are published or hidden per QG. Both spike reports are filed.

### Track L: Lab ports (L1, L2) (each 1–3 wk after a "go" [low])

**Prerequisites:** a "go" from the spike; rights recorded.

**Scope:** §5.3. This track continues after launch, since the owner will keep improving these.

**Acceptance IDs:**
- A-LAB-01: launches from a browser on G with no install.
- A-LAB-02: credentials are never in client code or network responses.
- A-LAB-03: "Experiment" label plus data-freshness timestamp.
- A-LAB-04: attribution and licence shown.
- A-LAB-05: graceful states for proxy down, rate-limited and empty.
- A-LAB-06: QG.

**Tests:**
- T-L-01 grep the bundle and HAR for secrets.
- T-L-02 the proxy's bbox and rate limits.
- T-L-03 proxy-offline UI.
- T-L-04 snapshot cron produces a fresh timestamp.
- T-L-05 the 3rd-party runtime loads only after Launch.

**Stop condition:** published, or a documented no-go.

### M4: Chess (4–6 d [medium])

**Prerequisites:** M1 contracts; M0 library licence decision.

**Scope:** §5.4, popularity research first, then data via `opening` entries seeded through the admin.

**Acceptance IDs:** A-CHESS-01 (filters), 02 (side vs orientation), 03 (still previews), 04 (activation semantics), 05 (controls, move list, keyboard, text alternative), 06 (no timer races), 07 (reduced motion), 08 (all 12 lines legal and sourced).

**Tests:**
- T-M4-01 chess.js unit suite: FEN, PGN, castling, en passant, promotion, mate, illegal moves.
- T-M4-02 every line replays legally.
- T-M4-03 rapid switching: 50 random variation/opening changes in 2 s. The final board equals the expected position for the last selection, with exactly one live timer (instrumented).
- T-M4-04 unmount and a hidden tab mid-playback leave no timers.
- T-M4-05 a screen reader pass (NVDA + Firefox, VoiceOver + Safari) announces moves.
- T-M4-06 `data-motion=reduced`: no autoplay; Next steps work.
- T-M4-07 board JS isn't loaded until activation.

**Stop condition:** all A-CHESS items pass, and the popularity evidence is filed.

### M5: Tabs and About/contact (2–4 d [medium]; content blocked on Q-01/Q-03)

**Scope:** §5.5; About from owner-approved text; contact via GitHub, plus email if the owner adds it.

**Acceptance IDs:** A-TAB-01 (title, tuning and rights shown), A-TAB-02 (320 px: no page-level horizontal scroll; region scrolls by keyboard), A-TAB-03 (200%/400% zoom), A-ABOUT-01 (only owner-approved facts), A-ABOUT-02 (contact link works).

**Tests:**
- T-M5-01 narrow viewports 320/375/414 px.
- T-M5-02 keyboard scroll of the tab region.
- T-M5-03 screen reader reads the header metadata.
- T-M5-04 contact link returns 200.

**Stop condition:** published, or explicitly deferred with the section hidden.

### M6: Release verification, backups/restore, redirects, rollback (2–3 d [medium])

**Scope:**
- Full regression across mobile and browser coverage.
- Lighthouse 3-run medians against budgets.
- **Backups:** a weekly `pg_dump` via a GitHub Action to an encrypted artifact (the free tier has no PITR); Storage images are mirrored. Restore rehearsed into local `supabase start`.
- **Redirect map:** every old route (26 + `/games/*.html`) → its new home, via `_redirects` (301) on A and stubs on github.io.
- **Rollback runbook:** Cloudflare Pages "rollback to deployment"; DB migration down-scripts; unpause-Supabase steps.
- Cut-over: replace `deploy.yml` with the github.io stub deploy.

**Acceptance IDs:** A-OPS-03/04, A-REL-01 (restore rehearsed and timed), A-REL-02 (rollback rehearsed), A-REL-03 (clean build from a fresh clone with `bun install --frozen-lockfile`), A-PERF-05.

**Tests:**
- T-M6-01 a redirect crawler checks every old URL: one hop, final 200.
- T-M6-02 restore drill.
- T-M6-03 rollback drill.
- T-M6-04 fresh-clone build.
- T-M6-05 final budget and Lighthouse report.

**Stop condition:** all pass. The owner approves go-live.

---

## 8. Agent and ownership rules

- **Coordinator (main session)** owns:
  - `contracts/`, routing (`src/pages/**` structure), `bun.lock`/`package.json`, `supabase/migrations/`;
  - `_headers`/`_redirects`, `CLAUDE.md`, `docs/hub/*`.
- **At most 2 implementers at once.** Each gets a brief naming its files. No two write the same files.
- **Reads:** targeted, 3–5 files and ≈600 lines per batch.
- **Research:** one decision at a time, 2 candidates max.
- **Typical pairs:**
  - M3: A = Stacker/arcade, B = Lab spikes.
  - M4: A = chess UI, B = tabs pipeline (content-blocked).

**Missing skills/tooling note:**
- No Supabase agent skill is installed. Suggested by Supabase: `npx skills add supabase/agent-skills`; the owner decides.
- Playwright is a devDependency (`bun run e2e`; locally it drives the installed Edge via `PW_CHANNEL=msedge`, CI installs Chromium). No Lighthouse CI or Supabase CLI is installed locally.
- Docker on this Windows machine is unconfirmed. RLS tests therefore run in GitHub Actions if Docker isn't available locally.
- The in-app Browser pane can't screenshot. Use Playwright traces for visual evidence.

---

## 9. Proposed handoff doc contents (written in M0, not now)

**`docs/hub/PLAN.md`:** this plan, condensed (§1–§7 headings and IDs).

**`docs/hub/DECISIONS.md`:** D-01…D-08 above, plus these, each with the date, the alternative considered and the reason:
- D-09: separate games origin + sandbox;
- D-10: static snapshot + deploy hook, with no runtime Supabase reads on public pages;
- D-11: Lab third-party runtime budget exception;
- D-12: trademark games removed;
- D-13: toys retired unless they use real data.

**`docs/hub/TASKS.md`:** a table with columns `ID | Milestone | Task | Owner | Status | Acceptance IDs | Test IDs | Evidence`. Tests start as `PLANNED`.

**`docs/hub/STATE.md` (<80 lines):**
```
# STATE (updated <date>, commit <sha>)
Milestone: M0 in progress
Done: plan approved (<date>)
Next exact task: see "Next session" below
Blocked: Q-01 tabs content (M5), Q-02 projects (M3), Q-03 about (M5)
Live: GitHub Pages (old site) until M6 cut-over
Budgets: see PLAN §4; baseline: evidence/baseline/ (pending)
Risks top-3: Supabase pause; Lab data rights; Stacker tuning
```

**Handoffs** (<250 words each) are appended to STATE under "Last handoff" and replace the previous one.

---

## 10. Next session

**Exact first task (M0.1):** create `docs/hub/{PLAN,TASKS,DECISIONS,STATE}.md` + `docs/hub/evidence/` from §9, and update `HANDOFF.md`/`CLAUDE.md` pointers. Then capture the baseline:
- run `bun run build` and record per-route JS from `dist/`;
- run 3 cold mobile Lighthouse runs each on live `/`, `/arcade/`, `/projects/` (via `bunx lighthouse`, nothing installed);
- record `curl -I` headers.

**Scoped agents (both read-only in M0):**
- **Explore A:** audit `src/components/{RadarToy,SignalMapToy,SpectrogramToy,TerminalToy,ReactionMiniGame}.ts`. Report real vs simulated data and Reaction QG gaps. ≤5 files.
- **Explore B:** audit `public/games/stacker.html`. Report the timing model (frame vs `dt`), input handlers, layout constants, and where a new tier plugs in. 1 file.

---

## 11. Verification (how the finished rebuild is proven)

1. **CI on main is green:** typecheck, `astro check`, build, `bun test` (chess, validators, playback), Playwright e2e across Chromium/Firefox/WebKit plus mobile emulation, axe, RLS suite, budget script, Lighthouse CI.
2. **Manual owner slice on production URLs:**
   - sign in → create a draft → preview → QG sign-off → publish;
   - a guest in a private window plays it via deep link and reloads;
   - unpublish → 404.
3. **Security spot checks:**
   - from a game frame, try to read A's storage → blocked;
   - forged REST writes with the anon key → denied;
   - a bad `postMessage` → ignored.
4. **Headers, compression and redirects:** a `curl -I` matrix plus the redirect crawler.
5. **Real-device pass:** Stacker and chess on one Android and one iOS phone if available, otherwise emulation, recorded as such.
6. **Evidence:** every test row in TASKS.md has a result, commit, environment, steps and evidence path. Anything not run stays `PLANNED` and is reported as not verified.
