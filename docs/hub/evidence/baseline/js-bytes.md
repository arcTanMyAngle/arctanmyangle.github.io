# Baseline: per-route JS bytes (M0.2)

- **Date:** 2026-10-17
- **Commit:** 74831d2 (working tree adds only `docs/hub/`)
- **Environment:** Windows 11, Bun 1.3.14, `bun run build` (Astro 7, static). Build: 26 pages, 0 errors.
- **Method:** for each `dist/**/*.html`, collect `<script src>` entries plus their static `import` graph under
  `_astro/`, and add inline `<script>` bodies. Sizes are raw and compressed locally (gzip -9, Brotli default). Real CDN
  compression levels differ slightly. Script: `jsbytes.mjs` (session scratchpad, not committed; the logic is
  reproduced in this description).
- **Excluded:** dynamically imported toy chunks. They load on demand via `lazyMount`; their raw sizes appear in the
  asset list. Also excluded: `games/vendor/three.min.js`, loaded only by `dk64.html` (603,445 B raw, 148,737 B gzip -9).
- **Budget reference:** A-PERF-01 is ≤150 KiB compressed first-party JS per route. **Every current route passes**
  (max 25.7 KiB gzip). The largest single chunk is the BaseLayout script (63.5 KiB raw), which includes `motion`
  and the command palette.

| Route | JS files | Inline JS raw KiB | Eager JS raw KiB | gzip KiB | brotli KiB | HTML gzip KiB |
|---|---|---|---|---|---|---|
| `/arcade/` | 3 | 5.0 | 73.2 | 25.7 | 23.3 | 5.2 |
| `/projects/arcade/` | 3 | 5.0 | 73.2 | 25.7 | 23.3 | 6.3 |
| `/projects/` | 4 | 1.8 | 72.0 | 25.4 | 22.9 | 5.4 |
| `/lab/` | 4 | 1.8 | 70.8 | 25.2 | 22.7 | 3.0 |
| `/projects/bird_acoustics/` | 4 | 1.8 | 70.7 | 25.2 | 22.7 | 5.0 |
| `/projects/global_unrest/` | 4 | 1.8 | 70.7 | 25.2 | 22.7 | 4.8 |
| `/projects/look-above/` | 4 | 1.8 | 70.7 | 25.2 | 22.7 | 5.0 |
| `/projects/real-timereaction/` | 4 | 1.8 | 70.7 | 25.2 | 22.7 | 4.6 |
| `/404.html` | 3 | 1.8 | 70.0 | 24.9 | 22.4 | 2.9 |
| `/about/` | 3 | 1.8 | 70.0 | 24.9 | 22.4 | 3.4 |
| `/contact/` | 3 | 1.8 | 70.0 | 24.9 | 22.4 | 3.1 |
| `/field-notes/edge-ml-on-cheap-hardware/` | 3 | 1.8 | 70.0 | 24.9 | 22.4 | 3.3 |
| `/field-notes/games-are-good-interfaces/` | 3 | 1.8 | 70.0 | 24.9 | 22.4 | 3.3 |
| `/field-notes/` | 3 | 1.8 | 70.0 | 24.9 | 22.4 | 3.1 |
| `/field-notes/real-time-visual-systems/` | 3 | 1.8 | 70.0 | 24.9 | 22.4 | 3.3 |
| `/` | 3 | 1.8 | 70.0 | 24.9 | 22.4 | 4.8 |
| `/projects/aiagenttradingsystem/` | 3 | 1.8 | 70.0 | 24.9 | 22.4 | 3.4 |
| `/projects/check_your_heart/` | 3 | 1.8 | 70.0 | 24.9 | 22.4 | 3.5 |
| `/projects/drive-tutorial/` | 3 | 1.8 | 70.0 | 24.9 | 22.4 | 3.4 |
| `/projects/foliage_disease_classification/` | 3 | 1.8 | 70.0 | 24.9 | 22.4 | 4.6 |
| `/projects/leetcode-solutions/` | 3 | 1.8 | 70.0 | 24.9 | 22.4 | 3.4 |
| `/projects/my_port/` | 3 | 1.8 | 70.0 | 24.9 | 22.4 | 3.4 |
| `/projects/predictive-heart-disease-model/` | 3 | 1.8 | 70.0 | 24.9 | 22.4 | 3.5 |
| `/projects/project/` | 3 | 1.8 | 70.0 | 24.9 | 22.4 | 3.4 |
| `/projects/roomies4sac/` | 3 | 1.8 | 70.0 | 24.9 | 22.4 | 3.4 |
| `/projects/roomies_webpage/` | 3 | 1.8 | 70.0 | 24.9 | 22.4 | 3.4 |
| `/games/mario.html` | 0 | 33.3 | 35.4 | 8.6 | 7.7 | 9.6 |
| `/games/dk64.html` | 0 | 18.7 | 18.7 | 6.9 | 6.2 | 8.1 |
| `/games/stacker.html` | 0 | 10.6 | 10.6 | 3.7 | 3.2 | 5.6 |
| `/games/kaboom.html` | 0 | 11.4 | 11.4 | 3.6 | 3.2 | 4.4 |
| `/games/tetris.html` | 0 | 7.4 | 7.4 | 2.3 | 2.0 | 3.3 |

_astro assets (raw):
- `_astro/BaseLayout.astro_astro_type_script_index_0_lang.Bzu5MLhq.js` 63.5 KiB
- `_astro/projects.CCqqDEmk.js` 21.9 KiB
- `_astro/BaseLayout.rM2QIUXJ.css` 16.4 KiB
- `_astro/BaseLayout.astro_astro_type_script_index_1_lang.B6I212yn.js` 3.9 KiB
- `_astro/TerminalToy.Cy4pMOV0.js` 2.6 KiB
- `_astro/index.astro_astro_type_script_index_0_lang.PhjnMNGr.js` 2.0 KiB
- `_astro/SignalMapToy.CXuRXYWQ.js` 1.9 KiB
- `_astro/RadarToy.CKNMPSk-.js` 1.8 KiB
- `_astro/preload-helper.Ew2snbf4.js` 1.7 KiB
- `_astro/ReactionMiniGame.BbMiKIke.js` 1.6 KiB
- `_astro/canvasLoop.CwIW-SwS.js` 1.3 KiB
- `_astro/clientState.DOVM2zI2.js` 0.9 KiB
- `_astro/lab.astro_astro_type_script_index_0_lang.gkL8p3a7.js` 0.9 KiB
- `_astro/SiteFooter.astro_astro_type_script_index_0_lang.DZspYnnv.js` 0.8 KiB
- `_astro/SpectrogramToy.CfSZ-QrB.js` 0.8 KiB
- `_astro/_slug_.astro_astro_type_script_index_0_lang.BKHXmpZZ.js` 0.7 KiB
