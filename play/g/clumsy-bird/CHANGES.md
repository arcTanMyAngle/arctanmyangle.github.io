# Changes from upstream

This copy of Clumsy Bird is modified from https://github.com/ellisonleao/clumsy-bird at commit
`fae3d487d5102af29fb3f78431cbd45e9b83aed3` (GPL-3.0). Modified 2026-10-30 by arcTanMyAngle for
arctanmyangle-play.pages.dev:

- Removed the Google site-verification tag, the Open Graph and Twitter card tags and the humans.txt link from
  `index.html`.
- `index.css`: the game is centred vertically, so it doesn't sit at the top of a tall phone screen.
- Moved the inline start-up script from `index.html` into `boot.js`, unchanged.
- Added `<script src="/play-bridge.js"></script>` so the page can tell arctanmyangle.pages.dev it has loaded.
- Ships the files the game needs, `index.html`, `index.css`, `js/melonJS-min.js` (melonJS, MIT),
  `build/clumsy-min.js`, `data/` and `LICENSE.md`, plus the source `build/clumsy-min.js` is built from (`js/game.js`,
  `js/entities/`, `js/screens/`, `Gruntfile.js`, `package.json`).

Everything else is as upstream.
