# M1 headers, budgets and CI (2026-10-18)

Environment: Win 11, Bun, `bun run build` then `bun run serve:dist` (local Cloudflare stand-in on :4322, reads
`dist/_headers` once at startup). The same checks on Cloudflare are in `cloudflare.md`.

## `dist/_headers` (generated, D-17)

`scripts/build-headers.mjs` runs after `astro build`: 12 pages, 3 inline-script + 11 inline-style sha256 hashes,
CSP 982 chars (Cloudflare limit 2000 per line). One `/*` rule carries every security header so no path gets two
policies joined with a comma; `/_astro/*` adds only `Cache-Control: public, max-age=31536000, immutable`.

```
default-src 'self'
script-src 'self' 'sha256-…' ×3
style-src 'self' 'sha256-…' ×11
style-src-attr 'unsafe-inline'
img-src 'self' data:
font-src 'self'
connect-src 'self'
object-src 'none'
base-uri 'none'
form-action 'self'
frame-ancestors 'none'
```

Plus `X-Content-Type-Options: nosniff`, `Referrer-Policy: strict-origin-when-cross-origin`,
`Permissions-Policy: camera=(), microphone=(), geolocation=()`.

`curl -I` against the stand-in: `/` 200 with the CSP above; `/_astro/*.js` immutable; `/nope/` 404;
`/chess` 308 → `/chess/` (Cloudflare does the same: `cloudflare.md`).

Browser check under the CSP: every route renders; theme, motion, palette, menu; chess move + save; Stacker and
Reaction run; the home and `/chess/` boards animate (32 pieces, positions change). No CSP violations from site code.
`/games/` (legacy, unlinked) does break under the policy and is excluded from it on purpose.

## Budgets (`bun run budgets`, PLAN §4)

| Route | JS (gz) | Page (gz) |
|---|---|---|
| `/` | 5.6 KiB | 17.1 KiB |
| `/chess/` | 5.6 KiB | 17.2 KiB |
| `/chess/play/` | 21.7 KiB | 33.2 KiB |
| `/arcade/stacker/` | 4.2 KiB | 12.7 KiB |
| `/arcade/reaction/` | 4.1 KiB | 12.4 KiB |
| others | ≤ 3.3 KiB | ≤ 12.0 KiB |

Seeded failure (T-M1-05): `tests/budgets.test.mjs` feeds `measurePage` a random 200 KiB bundle and asserts
`overBudget` reports A-PERF-01; a 150 KiB + 1 page on `/` reports A-PERF-02. The script exits 1 on any failure.

## T-M1-01 (`/` network log)

Before: `/` shipped chess.js (16.8 KiB JS) for the mini board. Now plies are worked out at build time
(`src/lib/chessLinePlan.ts`) and the client replays them (`chessLine.ts`, no chess.js import). `/` requests:
BaseLayout script, page script, `clientState`, `chessLine` (3.4 KiB raw), `pieces` (2.1 KiB raw, SVG paths). No
chess.js, no origin G, no Supabase. The replay + piece art are still chess code on Welcome; see STATE.

## CI (`.github/workflows/ci.yml`)

On every push and PR: `bun install --frozen-lockfile`, `bunx tsc --noEmit`, `bun run check`, `bun test`,
`bun run build`, `bun run budgets`. Locally: tsc OK, check 0 errors / 0 warnings, 24/24 tests, build OK, budgets
all within. Not yet run on GitHub (not pushed).

Since D-19 a `deploy` job uploads the verified `dist` to Pages project A on every push (skipped until the repo has
`CLOUDFLARE_API_TOKEN` + `CLOUDFLARE_ACCOUNT_ID`).

Not covered yet: Playwright + axe (T-M1-04), Lighthouse CI, origin G (no content yet).
