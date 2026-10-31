# Changes from upstream

This copy of A Dark Room is modified from https://github.com/doublespeakgames/adarkroom at commit `1fada4620b6c66bd07bf15a3f1eb8223df8bc1d7`
(MPL-2.0). Modified 2026-10-30 by arcTanMyAngle for arctanmyangle-play.pages.dev:

- English only (lang/ removed)
- local jQuery instead of the Google CDN
- removed Google Analytics, Dropbox save and the phone redirect
- inline scripts moved to script/boot.js
- phones: a viewport tag, css/phone.css (below 940px the notification log moves to a strip above the game) and
  script/fit.js (scales the page down to fit a frame narrower than the layout)
- bridge script

Everything else is as upstream.
