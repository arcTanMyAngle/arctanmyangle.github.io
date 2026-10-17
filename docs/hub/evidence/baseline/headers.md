# Baseline: live response headers (M0.3)

- **Date:** 2026-10-17
- **Origin:** `https://arctanmyangle.github.io` (GitHub Pages, deployed 2026-08-28 per `Last-Modified`)
- **Method:** `curl -sS -o /dev/null -D - -H 'Accept-Encoding: br, gzip' <url>` from Windows 11 (Git Bash).
  Per-request noise headers (`Date`, `Age`, `Via`, `X-Served-By`, `X-Timer`, `X-GitHub-Request-Id`,
  `X-Fastly-Request-Id`, `X-Cache-Hits`, `X-Proxy-Cache`) are stripped.

## Summary

| URL | Status | Content-Encoding | Cache-Control | CSP | X-Frame-Options | nosniff | Referrer-Policy |
|---|---|---|---|---|---|---|---|
| `/` | 200 | gzip | `max-age=600` | none | none | none | none |
| `/arcade/` | 200 | gzip | `max-age=600` | none | none | none | none |
| `/projects/` | 200 | gzip | `max-age=600` | none | none | none | none |
| `/arcade` (no slash) | 301 → `/arcade/` | — | `max-age=600` | none | none | none | none |
| `/games/stacker.html` | 200 | gzip | `max-age=600` | none | none | none | none |
| `/_astro/BaseLayout.rM2QIUXJ.css` (hashed) | 200 | gzip | `max-age=600` | none | none | none | none |
| `/does-not-exist/` | 404 | gzip | — | none | none | none | none |

## Findings against the plan's budgets

- **A-OPS-01 (cache headers): fails today.** Hashed `/_astro/*` assets get the same `max-age=600` as HTML; GitHub
  Pages can't send `immutable`. Fixed by `_headers` on Cloudflare Pages (M1).
- **A-OPS-02 (compression): partial.** gzip only. Brotli was requested and not served.
- **Security headers: none.** No CSP, `X-Frame-Options`/`frame-ancestors`, `X-Content-Type-Options`,
  `Referrer-Policy` or `Permissions-Policy`. `Access-Control-Allow-Origin: *` is sent on everything.
  `Strict-Transport-Security: max-age=31556952` (no `includeSubDomains`, no `preload`).
- **Game isolation:** `/games/stacker.html` is served from the same origin as the shell, with no CSP. That matches
  the §1.1 finding and is why D-09 moves games to origin G.
- **Trailing slash:** GitHub Pages already returns a single 301 for `/arcade` → `/arcade/`, consistent with
  A-OPS-03's ≤1-redirect target.
- **404:** an unknown path returns a real 404 status (with the site's `404.html`), consistent with A-OPS-04.
