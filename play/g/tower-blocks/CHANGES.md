# Changes from upstream

This copy of Tower Building is modified from https://github.com/iamkun/tower_game at commit
`c6fa84afe179b661fa71cf7cc8788d0c47ca2875` (MIT). Modified 2026-10-30 by arcTanMyAngle for
arctanmyangle-play.pages.dev:

- Removed the Google Analytics (gtag) scripts.
- Removed the "invite" button and the WeChat share overlay from `index.html` and their click handlers.
- Moved the inline start-up script from `index.html` into `boot.js`. In it, the reload button now calls
  `location.reload()`, a failed load shows its message in the loading text instead of `alert()`, and on a
  touch-screen computer a mouse press is passed to the game as a touch (it listens only for touches there).
- Added `<script src="/play-bridge.js"></script>` so the page can tell arctanmyangle.pages.dev it has loaded.
- Ships only the files the game needs: `index.html`, `dist/main.js`, `assets/` (which includes Zepto 1.1.6, MIT) and
  `LICENSE`.

Everything else is as upstream.
