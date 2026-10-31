# Clumsy Bird (origin G, `/g/clumsy-bird/`)

- Source: https://github.com/ellisonleao/clumsy-bird
- Pinned commit: `fae3d487d5102af29fb3f78431cbd45e9b83aed3`
- Licence: GPL-3.0, full text shipped at `play/g/clumsy-bird/LICENSE.md`. The bundled engine, `js/melonJS-min.js`,
  is melonJS (MIT) and keeps its header.
- Served from: `https://arctanmyangle-play.pages.dev/g/clumsy-bird/`, framed by origin A at `/arcade/clumsy-bird/`
- Changes from upstream: removed the site-verification, Open Graph and Twitter tags and the humans.txt link; moved
  the inline start-up script into `boot.js`; added `/play-bridge.js`.
- Otherwise the upstream files are served as they are. The same list is in `play/games-manifest.json` and the dated
  `play/g/clumsy-bird/CHANGES.md`; the game's Credits panel on A links to both and to the source.
- GPL-3.0: `build/clumsy-min.js` is upstream's own minified build, unchanged. Its source ships beside it on G
  (`js/game.js`, `js/entities/`, `js/screens/`, `Gruntfile.js`) and in this repo under `play/g/clumsy-bird/`.
  `CHANGES.md` next to the game is the dated modification notice (§5a).
