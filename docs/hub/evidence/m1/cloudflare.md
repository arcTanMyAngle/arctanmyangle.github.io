# M1 Cloudflare projects and first deploy (2026-10-18)

## Projects (D-19)

| Origin | Project | Production | Kind |
|---|---|---|---|
| A | `arctanmyangle` | `https://arctanmyangle.pages.dev` (no production deploy yet → 404) | Pages, direct upload, branch `main` |
| G | `arctanmyangle-play` | `https://arctanmyangle-play.pages.dev` (empty until `play/` exists) | Pages, direct upload, branch `main` |

Free plan; no paid add-ons turned on. wrangler 4.151.1 hands `pages project create` to Workers ("Missing
entry-point to Worker script or to assets directory"), so each project was created once with `--force`; later
commands run against Pages directly.

## Deploy

`bun run build` (CSP 982 chars, budgets all within), then
`bunx wrangler pages deploy dist --project-name arctanmyangle --branch hub-m1-proto-c` from the owner's machine:
36 files + `_headers` + `_redirects`. Preview: `https://hub-m1-proto-c.arctanmyangle.pages.dev` (deployment
`a4d335da`). The branch-alias certificate took ~1–2 min to issue; `curl` failed with a TLS alert until then.

From now on `ci.yml`'s `deploy` job does this after the gates pass, once the repo has `CLOUDFLARE_API_TOKEN` and
`CLOUDFLARE_ACCOUNT_ID`.

## T-M1-02 (status codes, `curl`)

`/`, `/arcade/`, `/arcade/stacker/`, `/arcade/reaction/`, `/chess/`, `/chess/play/`, `/lab/`, `/tabs/`, `/skate/`,
`/projects/`, `/about/` → 200. `/nope/` and `/games/` → 404 with the site's 404 page.

## T-M1-03 (headers + compression, origin A)

`/`: `Content-Encoding: br` (gzip when only gzip is offered), `Cache-Control: public, max-age=0, must-revalidate`,
CSP byte-identical to `dist/_headers`, `X-Content-Type-Options: nosniff`, `Referrer-Policy:
strict-origin-when-cross-origin`, `Permissions-Policy: camera=(), microphone=(), geolocation=()`.
`/_astro/*.js` and `.css`: `Cache-Control: public, max-age=31536000, immutable`, brotli, same CSP (one policy).
404s carry the CSP and `Cache-Control: no-store`.

Cloudflare adds `Access-Control-Allow-Origin: *` to every response by default, and `X-Robots-Tag: noindex` on
previews only. Origin G: see below.

`frame-ancestors 'none'` is enforced: framing any page, even same-origin, is blocked.

## T-M1-06 (trailing slash)

`/chess`, `/arcade/stacker`, `/about` → one `308 Permanent Redirect` to the slash form, then 200. `/chess/index.html`
→ 308 `/chess/`. Cloudflare Pages uses 308 for these, not the 301 the test names; there's no setting for it.
`_redirects` old routes: `/contact` → 301 `/about/#contact`, `/field-notes/x` → 301 `/about/`.

## Browser (in-app, preview URL)

Every route above loaded with no CSP violations from site code. `/` requests only BaseLayout, page script,
`clientState`, `chessLine`, `pieces` (no chess.js). `/chess/play/` renders its board (32 pieces, controls). The board
animation wasn't re-checked here because the pane was in the background (`document.hidden`, so the board correctly
waits). The same `dist` animated in the local check (`headers-ci.md`).

## T-M1-03 on origin G (local stand-in only, 2026-10-30)

Not yet deployed to `arctanmyangle-play`. Checked with `bun scripts/serve-dist.mjs --dir play --port 4330
--allow-parent http://localhost:4322` against A's `dist` on 4322, phone viewport 375x812:

- `/` and every `/g/<slug>/` get `frame-ancestors https://arctanmyangle.pages.dev https://*.arctanmyangle.pages.dev`
  (plus the local parent); each game also gets its own `default-src 'self'` policy with no other host
  (`tests/play.test.mjs`).
- A's `dist/_headers` has `frame-src https://arctanmyangle-play.pages.dev`, so A can frame G and nothing else.
- In the frame: 2048 starts, takes swipes and Exit returns to the poster; Hextris reaches `gameState 1`; A Dark Room
  plays in landscape (844x390) and clips in portrait as its `phoneNote` says. No CSP violations from game code.
- Still to check on Cloudflare: that `/g/<slug>/*` matches and the two CSP rules are comma-joined as `serve-dist`
  does, and `Content-Type` on `CHANGES.md` / `LICENSE.*`.
