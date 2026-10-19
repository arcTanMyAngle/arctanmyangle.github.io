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
previews only. Origin G has no content to check yet.

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
