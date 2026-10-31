# Changes from upstream

This copy of T-Rex Runner is modified from https://github.com/wayou/t-rex-runner at commit
`5455bfa408ec6b707c7300ff194b7390733a766d` (BSD-3-Clause; the game code is from Chromium, also BSD-licensed).
Modified 2026-10-30 by arcTanMyAngle for arctanmyangle-play.pages.dev:

- Removed the Google Fonts stylesheet; the start message uses the system font.
- Changed the title to "T-Rex Runner" and the start message to "Tap or press Space to start".
- Replaced the inline `onclick` and `keydown` scripts in `index.html` with `boot.js`, which hides the start message on
  Space, a tap or a click. A left click also jumps, and restarts after a crash, on touch-screen computers too.
- `index.js`: iPads that report a desktop platform are treated as iOS, so they get the touch controls.
- Added `<script src="/play-bridge.js"></script>` so the page can tell arctanmyangle.pages.dev it has loaded.
- Ships only the files the game needs: `index.html`, `index.css`, `index.js`, `assets/` without the README images,
  and `LICENSE`.

Everything else is as upstream.
