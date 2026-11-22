# M1 end-to-end + accessibility (T-M1-04, A-A11Y-01)

Run 2026-11-22 on the tree committed as f54e8ea (the suite, CI steps and the a11y fixes below). Not yet run on GitHub
(branch not pushed).

## What runs

`bun run build && bun run e2e` (`playwright test`, config `playwright.config.ts`, suite `e2e/shell.e2e.ts`).

- **Server:** `bun scripts/serve-dist.mjs --port 4350` serves `dist/` with the real generated `_headers` CSP, 308
  trailing slash and the 404 page, so every check runs under the policy Cloudflare sends.
- **Routes:** read from `dist/sitemap-0.xml` (19 routes), so a new page is covered without editing the suite. Plus
  one unknown path for the 404 page.
- **Projects:** `desktop` (Desktop Chrome) and `mobile` (Pixel 7), `reducedMotion: "reduce"` so contrast and focus
  are read in their final state.
- **Per route:**
  - **axe, dark and light theme** (light is desktop-only). Tags wcag2a, wcag2aa, wcag21a, wcag21aa, wcag22aa,
    best-practice. Any serious/critical violation fails; lesser ones and "needs review" become annotations.
  - **Shell:** status 200, a CSP header, one `banner`, `main`, `contentinfo`, `nav "Main"` and exactly one `h1`;
    the skip link is the first Tab stop and moves focus to `#main`; no CSP violations, no console errors, no request
    to any other origin.
  - **Focus order (desktop):** Tab through the page, max 400 stops. Every stop must be visible, in view after
    scrolling, not hidden behind the sticky header (WCAG 2.4.11), change its look when focused, and come in landmark
    order (banner → main → contentinfo). No focus trap.
  - **Phone menu (mobile):** opens, Escape closes it and focus returns to the toggle.
- **404:** unknown path returns 404 with the 404 page and the same shell.

192 tests = 19 routes × 5 × 2 projects + 2. The 57 skips are by design: menu on desktop (19), light theme on
mobile (19), Tab walk on mobile (19).

## Environment

Windows 11, Microsoft Edge via `PW_CHANNEL=msedge` (no browser download), Playwright 1.65.1,
`@axe-core/playwright` 4.14.0, Bun 1.3.14. CI uses Playwright's own Chromium (`bunx playwright install --with-deps
chromium`).

## Result: PASS

135 passed, 57 skipped (by design), 0 failed, 0 flaky, 44 s. Zero axe violations of any impact on any route, in
either theme.

Tab stops per route (desktop): `/` 32, `/about/` 30, `/arcade/` 35, game pages 26–30, `/chess/` 55, `/chess/play/`
32, `/lab/` 25, `/projects/` 29, `/skate/` 27, `/tabs/` 23.

Still "needs review" (axe can't decide; not failures):

- `color-contrast` on every route: text over gradients, translucent surfaces or canvas, where axe can't settle the
  background. The tokens themselves are AA in both themes (STATE carry-forward).
- `label-content-name-mismatch` (14 nodes) on `/skate/`: the action-strip tokens. Each visible abbreviation is in
  its accessible name (`tokenName()` in `skate.ts`), but axe only matches whole words, so it can't confirm "TF" in
  "TF, toe flick, decision 3, 41% likely".

## Fixes the suite found

| Route | Problem | Fix |
|---|---|---|
| `/arcade/2048/` | Poster tile numerals 1.6–2.4:1 (white on orange) | Dark numerals on every tile in `PlayPoster.astro`, all ≥ 4.5:1 |
| `/arcade/<slug>/` | Credit links too small a target (2.5.8) | `.pf__fine a { min-height: 1.75rem }` in `[slug].astro` |
| `/chess/` | Current move number under 4.5:1 on the tinted highlight | `.mv.is-current .mv__n` uses `--text-2` |
| `/chess/` | `aria-label` on a `<p>` (aria-prohibited-attr) | Removed; the moves read as text |
| Iron Line, Monolith, Lane Rush | The start overlay took focus on first load, so the skip link wasn't the first Tab stop | `played` flag in `gameShell.ts`: the overlay takes focus only once a game is under way (pause, game over, next mission) |
| `/skate/` | Current-step outline hid the focus ring | `aria-current="step"` gets a hue border + inset underline instead |
| `/skate/` | Token names didn't contain the visible text ("(toe)") | Labels renamed to "toe flick" / "heel flick"; `tokenName()` |
| `/skate/` | Formula `<pre>` blocks were scroll regions with no keyboard access | They wrap (`pre-wrap`, `overflow-wrap: anywhere`) |

## CI

`.github/workflows/ci.yml` runs, after `bun run budgets`: install Chromium, `bun run e2e`, and on failure uploads
`playwright-report/` + `test-results/` (7 days). It runs before the `dist` upload, so the `deploy` job is gated on it.

## Not covered

Screen-reader pass (NVDA/VoiceOver), real-device touch, origin G's games themselves (only A's frame page is
checked), Lighthouse CI.
