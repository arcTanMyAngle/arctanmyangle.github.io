# TASKS

Status values: `TODO`, `DOING`, `DONE`, `BLOCKED`. Test status stays `PLANNED` until executed; an executed test
records result, commit, environment, steps and evidence path. Anything not run is reported as not verified.

## Tasks

| ID | Milestone | Task | Owner | Status | Acceptance IDs | Test IDs | Evidence |
|---|---|---|---|---|---|---|---|
| M0.1 | M0 | Create `docs/hub/*` + `evidence/`; point HANDOFF/CLAUDE to STATE | coordinator | DONE | A-M0-01 | — | `docs/hub/` |
| M0.2 | M0 | Per-route JS bytes from `dist/` | coordinator | DONE | A-M0-02 | — | `evidence/baseline/js-bytes.md` |
| M0.3 | M0 | Live headers (`curl -I`) | coordinator | DONE | A-M0-02 | — | `evidence/baseline/headers.md` |
| M0.4 | M0 | 3 cold mobile Lighthouse runs on live `/`, `/arcade/`, `/projects/` | coordinator | DONE | A-M0-02 | T-M0-01 | `evidence/baseline/lighthouse.md` |
| M0.5 | M0 | Toy audit (real vs simulated) + Reaction QG gaps | coordinator | DONE | — | — | `evidence/inventory.md` §3 |
| M0.6 | M0 | Stacker audit (timing, input, layout, tier hook) | coordinator | DONE | — | — | `evidence/inventory.md` §4 |
| M0.7 | M0 | Route + asset inventory | coordinator | DONE | A-M0-03 | — | `evidence/inventory.md` §1–2 |
| M0.8 | M0 | Licence check: chess.js, cm-chessboard | coordinator | DONE | — | — | `evidence/inventory.md` §5 |
| M0.9 | M0 | Astro CSP support (confirmed); `pg_jsonschema` documented, live check deferred to M2 | coordinator | DONE | — | — | `evidence/inventory.md` §6 |
| M1.1 | M1 | Dev-only prototypes: `/proto/a/` + `/proto/b/` (rejected, D-14); prototype C `/proto/c/` (pro modern full site, D-14/D-15) | coordinator | DONE (owner OK'd C, 2026-10-18) | A-A11Y-01 | — | deleted in M1.2 (git history) |
| M1.2 | M1 | Promote C to the real site: tokens, `BaseLayout`, pages, toys; delete `src/proto/` + `src/pages/proto/`, old pages/toys, `motion`; `_redirects` (D-16) | coordinator | DONE | A-A11Y-01 | — | `src/layouts/BaseLayout.astro`, `src/pages/` |
| M1.3 | M1 | `_headers` with hashed CSP + `frame-ancestors` (D-17), budget gate, CI, build-time chess plies (D-18), `serve:dist` stand-in | coordinator | DONE (on A's Cloudflare preview since 2026-10-18) | A-OPS-01, A-PERF-01/02 | T-M1-01, T-M1-03, T-M1-05 | `evidence/m1/headers-ci.md` |
| M1.x | M1 | Cloudflare projects (DONE: A + G, D-19; branch preview deployed), CI deploy job for A + G (needs repo secrets), contracts, axe/Playwright, G `play/` (DONE: 2048, Hextris, A Dark Room, Clumsy Bird, Tower Building + Subway Surfers link; T-Rex Runner removed 2026-11-01; both previews deployed) | coordinator + A | DOING | A-SHELL-01/02, A-OPS-01..04, A-PERF-01/02, A-A11Y-01 | T-M1-01..06 | `evidence/m1/` |
| M2.x | M2 | Supabase project, RLS, RPCs, admin, Stacker bundle slice | coordinator + A | TODO | A-ADMIN-01..06, A-SEC-01..06 | T-M2-01..10 | `evidence/m2/` |
| M3.x | M3 | Stacker tier + mobile, Reaction, game page, projects; Lab spikes. Originals Iron Line, Monolith, Lane Rush (DONE 2026-11-01, `tests/games.test.mjs`) | A + B | DOING | A-ARC-01..06, A-PROJ-01, A-LAB-00 | T-M3-01..06 | `evidence/m3/` |
| L.x | Track L | look-above, global_unrest ports | B | TODO | A-LAB-01..06 | T-L-01..05 | `evidence/rights/`, `evidence/lab/` |
| M4.x | M4 | Chess popularity research + explorer | A | TODO | A-CHESS-01..08 | T-M4-01..07 | `evidence/chess/` |
| M5.x | M5 | Tabs + About/contact | B | BLOCKED (Q-01, Q-03 content) | A-TAB-01..03, A-ABOUT-01/02 | T-M5-01..04 | `evidence/m5/` |
| M6.x | M6 | Regression, backups, redirects, rollback, cut-over | coordinator | TODO | A-OPS-03/04, A-REL-01..03, A-PERF-05 | T-M6-01..05 | `evidence/m6/` |

## Tests

| Test | Status | Result | Commit | Environment | Evidence |
|---|---|---|---|---|---|
| T-M0-01 | DONE | PASS: rerun perf medians 100/100/100 vs 100/100/100 (Δ0, allowed ±5) | 74831d2 + uncommitted `docs/hub` | Lighthouse 12.8.2, HeadlessChrome 155, Win 11, mobile `simulate`; live github.io | `evidence/baseline/lighthouse.md` |
| T-M1-01 | PARTIAL | `/` requests no chess.js, no G, no Supabase; still loads the mini-board replay (3.4 KiB) + piece art (2.1 KiB), see STATE | uncommitted | `serve:dist`, in-app browser | `evidence/m1/headers-ci.md` |
| T-M1-02 | PASS | origin A: all 11 routes 200; `/nope/`, `/games/` 404 with the 404 page | uncommitted (dist of 5dbcc9c + CI edits) | A preview `hub-m1-proto-c.arctanmyangle.pages.dev`, curl + in-app browser | `evidence/m1/cloudflare.md` |
| T-M1-03 | PARTIAL | origin A PASS on Cloudflare: CSP byte-identical to `dist/_headers`, br/gzip, immutable `/_astro/*`; origin G built (`play/_headers`, one CSP per game) and deployed to the `hub-m1-proto-c` preview and played there; per-game CSP still needs a curl | uncommitted | A preview, curl, `serve-dist --dir play` | `evidence/m1/cloudflare.md` |
| T-M1-04 | PLANNED | | | | |
| T-M1-05 | PASS | seeded 200 KiB bundle fails A-PERF-01; over-weight `/` fails A-PERF-02; script exits 1 | uncommitted | `bun test` | `tests/budgets.test.mjs` |
| T-M1-06 | PASS | one permanent redirect to the slash URL, then 200; Cloudflare sends 308, not the 301 the test text names (no setting) | uncommitted | A preview, curl | `evidence/m1/cloudflare.md` |
| T-M2-01 … T-M2-10 | PLANNED | | | | |
| T-M3-01 … T-M3-06 | PLANNED | | | | |
| T-L-01 … T-L-05 | PLANNED | | | | |
| T-M4-01 … T-M4-07 | PLANNED | | | | |
| T-M5-01 … T-M5-04 | PLANNED | | | | |
| T-M6-01 … T-M6-05 | PLANNED | | | | |
