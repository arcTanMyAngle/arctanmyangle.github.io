# Baseline: mobile Lighthouse on the live site (M0.4)

- **Date:** 2026-10-17 (runs started 11:46 UTC)
- **Target:** live `https://arctanmyangle.github.io` (GitHub Pages, old site), routes `/`, `/arcade/`, `/projects/`
- **Tool:** `bunx lighthouse@12.8.2` (Lighthouse 12.8.2), HeadlessChrome 155.0.0.0, Windows 11, `--headless=new`,
  categories performance / accessibility / best-practices / seo. Each run is a fresh Chrome profile (cold cache).
- **Settings (defaults, recorded from the report):** `formFactor: mobile`, screen 412×823 @1.75, throttling method
  `simulate` with `rttMs 150`, `throughputKbps 1638.4`, `cpuSlowdownMultiplier 4`. Host benchmark index 3456.5.
- **Order:** interleaved, `/` → `/arcade/` → `/projects/`, ×3. Script: `lh.sh` (session scratchpad, not committed;
  the command is reproduced above). Raw JSON is not committed (≈5 MB).

## Medians (3 runs)

| Route | Perf | A11y | Best pr. | SEO | FCP ms | LCP ms | TBT ms | CLS | Speed Index ms | Page weight KiB |
|---|---|---|---|---|---|---|---|---|---|---|
| `/` | 100 | 96 | 100 | 100 | 1132 | 1132 | 0 | 0 | 2526 | 46.3 |
| `/arcade/` | 100 | 95 | 100 | 92 | 1059 | 1103 | 40 | 0 | 2446 | 46.6 |
| `/projects/` | 100 | 96 | 100 | 100 | 1059 | 1059 | 0 | 0 | 2483 | 47.9 |

Per-run performance scores: `/` 100/100/100; `/arcade/` 100/**90**/100 (run 2 had a Speed Index of 14.3 s, an outlier
that the median absorbs); `/projects/` 100/100/100.

## Findings

- **A-PERF-05 (≥90 median mobile): passes today** on all three routes. The new site must not regress this; the old
  site is light (≈47 KiB per page, 25 KiB gzip JS).
- **Accessibility is the gap, not speed.** The only failing a11y audit on every route is `color-contrast`: `#5b6688`
  muted text on `#01030a`/`#050912` gives 3.5–3.6:1 against the 4.5:1 AA minimum (e.g. `.arcade-cabinet__keys`,
  `.site-footer__hint`). The redesign replaces this palette; the M1 tokens must meet AA.
- **SEO 92 on `/arcade/`:** `crawlable-anchors`. The "View source & instructions →" `<a>` has no `href` until JS sets
  it. Goes away with the `ArcadeCabinet` rewrite (M3).
- **LCP elements:** the header logo link (`/`), the blinking "insert coin" line (`/arcade/`), a `<select>` (`/projects/`).
  All are text, so LCP is FCP-bound.

## Reproducibility (T-M0-01)

A second set of 3 cold runs per route (runs 4–6), same command, settings and interleaved order, started 11:49 UTC
on 2026-10-17. Host benchmark index 3385.5 (set 1: 3456.5).

| Route | Perf | A11y | Best pr. | SEO | FCP ms | LCP ms | TBT ms | CLS | Speed Index ms | Page weight KiB |
|---|---|---|---|---|---|---|---|---|---|---|
| `/` | 100 | 96 | 100 | 100 | 1074 | 1074 | 0 | 0 | 2510 | 46.2 |
| `/arcade/` | 100 | 95 | 100 | 92 | 1080 | 1080 | 0 | 0 | 2496 | 46.6 |
| `/projects/` | 100 | 96 | 100 | 100 | 1057 | 1057 | 0 | 0 | 2461 | 48.1 |

Per-run performance scores: `/` 100/100/100; `/arcade/` 100/100/98; `/projects/` 100/100/98. Failing audits and LCP
elements are the same as set 1.

**Result: PASS.** Performance medians differ by 0 points on every route (allowed ±5). The other three category
medians are also identical.
