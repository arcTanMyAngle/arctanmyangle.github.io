# T-Rex Runner (origin G, `/g/t-rex-runner/`)

- Source: https://github.com/wayou/t-rex-runner (the game code is Chromium's offline dinosaur game)
- Pinned commit: `5455bfa408ec6b707c7300ff194b7390733a766d`
- Licence: BSD-3-Clause, full text shipped at `play/g/t-rex-runner/LICENSE`; `index.js` and `index.css` keep their
  "Copyright 2014 The Chromium Authors" BSD headers.
- Served from: `https://arctanmyangle-play.pages.dev/g/t-rex-runner/`, framed by origin A at `/arcade/t-rex-runner/`
- Changes from upstream: removed Google Fonts; replaced the inline `onclick`/`keydown` scripts with `boot.js` (which
  also lets a click jump); iPadOS counts as iOS for the touch controls; new title and start text; added
  `/play-bridge.js`.
- Otherwise the upstream files are served as they are. The same list is in `play/games-manifest.json` and the dated
  `play/g/t-rex-runner/CHANGES.md`; the game's Credits panel on A links to both and to the source.
- BSD-3-Clause: the copyright notices and licence text stay with the files, and neither the Chromium name nor
  wayou's is used to promote this site.
