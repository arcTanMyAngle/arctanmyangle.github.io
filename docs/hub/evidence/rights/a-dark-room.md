# A Dark Room (origin G, `/g/a-dark-room/`)

- Source: https://github.com/doublespeakgames/adarkroom
- Pinned commit: `1fada4620b6c66bd07bf15a3f1eb8223df8bc1d7`
- Licence: MPL-2.0, full text shipped at `play/g/a-dark-room/LICENSE.md`
- Served from: `https://arctanmyangle-play.pages.dev/g/a-dark-room/`, framed by origin A at `/arcade/a-dark-room/`
- Changes from upstream: English only (`lang/` removed); local jQuery instead of the Google CDN; removed Google Analytics, Dropbox save and the phone redirect; inline scripts moved to `script/boot.js` (the CSP has no `'unsafe-inline'`); added `/play-bridge.js`.
- Otherwise the upstream files are served as they are. The same list is in `play/games-manifest.json` and the dated
  `play/g/a-dark-room/CHANGES.md`; the game's Credits panel on A links to both and to the source.
- MPL-2.0 is per file: changed files stay MPL and are available as served, and this repo holds them under
  `play/g/a-dark-room/`. jQuery is MIT and keeps its header.
- Phone: built for a fixed 700px layout. Portrait at 375px clips and needs a sideways pan; landscape (844x390) fits.
  The page says so (`phoneNote` in `src/data/play.ts`).
