# Tower Building (origin G, `/g/tower-blocks/`)

- Source: https://github.com/iamkun/tower_game
- Pinned commit: `c6fa84afe179b661fa71cf7cc8788d0c47ca2875`
- Licence: MIT ("Copyright (c) 2018 BMQB, Inc"), full text shipped at `play/g/tower-blocks/LICENSE`. The bundled
  `assets/zepto-1.1.6.min.js` is Zepto (MIT) and keeps its header.
- Served from: `https://arctanmyangle-play.pages.dev/g/tower-blocks/`, framed by origin A at `/arcade/tower-blocks/`
- Changes from upstream: removed Google Analytics, the invite button and the WeChat share overlay; moved the inline
  start-up script into `boot.js`, which reports a failed load in the loading text instead of `alert()`; added
  `/play-bridge.js`.
- Otherwise the upstream files are served as they are. The same list is in `play/games-manifest.json` and the dated
  `play/g/tower-blocks/CHANGES.md`; the game's Credits panel on A links to both and to the source.
- MIT: the copyright notice and licence text ship with the files.
