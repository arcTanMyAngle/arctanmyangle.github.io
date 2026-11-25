# M1 Lighthouse CI (A-PERF-05)

Run 2026-11-25 on the working tree on top of 5abf799 (contracts, snapshot and players added; there are no page
changes). Local Chrome via `CHROME_PATH`. It will run on GitHub once the branch is pushed.

## What runs

`bun run build && bun run lhci` runs `bunx @lhci/cli@0.15.1 autorun` with `lighthouserc.json`.

- **Version:** pinned through bunx, not a devDependency (D-22), so its ~800 packages stay out of `bun.lock`.
- **Server:** `bun scripts/serve-dist.mjs --port 4360` serves `dist/` with the real `_headers` CSP, which is the policy
  Cloudflare sends. Port 4360 keeps it clear of the e2e server on 4350.
- **Routes:**
  - Now: `/`, `/arcade/`, `/arcade/stacker/`, `/chess/`.
  - Later: `/tabs/<slug>/`, once M5 publishes a tab.
- **Runs:** 3 per route on Lighthouse's default mobile preset (simulated slow 4G, 4× CPU throttle).
- **Assertions:**
  - `categories:performance` ≥ 0.90 on the median run is an **error**.
  - `categories:accessibility` ≥ 0.95 on the median run is a **warning**, because axe in the e2e suite is the
    accessibility gate.
- **Output:** reports go to `.lighthouseci/`, which is git-ignored. CI uploads it as an artifact only on failure.

## Results (Lighthouse 12.6.1, mobile)

| Route | Perf runs | Perf (median) | A11y | Best practices | SEO | LCP | TBT | CLS |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `/` | 99 / 100 / 100 | 100 | 100 | 100 | 100 | 1507 ms | 0 ms | 0.000 |
| `/arcade/` | 100 / 100 / 100 | 100 | 100 | 100 | 100 | 1506 ms | 0 ms | 0.000 |
| `/arcade/stacker/` | 100 / 100 / 100 | 100 | 100 | 100 | 100 | 1505 ms | 0 ms | 0.000 |
| `/chess/` | 98 / 98 / 98 | 98 | 100 | 100 | 100 | 1958 ms | 0 ms | 0.000 |

Every assertion passed. `/chess/` has the most LCP of the four, because its first paint is the board. It still has
8 points of headroom over the gate.
