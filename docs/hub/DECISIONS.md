# DECISIONS

Append-only. Each entry: date, decision, alternative considered, reason. Supersede with a new entry; don't edit old ones.

| ID | Date | Decision | Alternative considered | Reason |
|---|---|---|---|---|
| D-01 | 2026-10-17 | Public site, catalogue only. Only the owner signs in. | Friend accounts / rooms / scores | Owner answer; removes visitor auth, moderation and data-retention scope. |
| D-02 | 2026-10-17 | Cloudflare Pages (origin A + games/lab origin G) + a **new** free Supabase project (GitHub OAuth, drafts, storage). $0. | Stay on GitHub Pages; Cloudflare D1 + Access | Owner answer. GitHub Pages can't set headers/CSP, has no real 301s, and a second Pages site shares the `*.github.io` origin. D1 + Access is the recorded fallback if the M2 gate fails. Never reuse the unrelated "Chemclicks" project. |
| D-03 | 2026-10-17 | Drop Mario, DK64, Tetris, Kaboom from launch. | Rebrand now | Owner answer. Trademark/trade-dress risk; Kaboom misattributes authorship. May return as original rebrands that pass the QG. |
| D-04 | 2026-10-17 | `look-above` and `global_unrest` get browser-launchable versions in the Lab, labelled "Experiment". | Leave as source links | Owner answer ("it like goes in the experimentation area"). Source-link-only items fail the QG. |
| D-05 | 2026-10-17 | Stacker gets a tier harder than `insane` and must work on phones. | Ship as-is | Owner answer. |
| D-06 | 2026-10-17 | Visual direction: Clean zine (editorial, calm, strong type, whitespace, hand-drawn accents). | Keep instrument panel; playful arcade | Owner answer. Two prototypes (paper & ink / night zine) in M1; owner picks. |
| D-07 | 2026-10-17 | Chess repertoire: Italian, Giuoco Piano, London, Vienna Gambit (White); Berlin, Accelerated Dragon (Black). Variations chosen by Lichess popularity (PLAN §5.4). | Hand-picked lines | Owner answer. No counts written until measured. |
| D-08 | 2026-10-17 | Retain Astro 7 static + vanilla TS + Bun. No SSR adapter. | Vite multi-page + vanilla TS | Built-in route splitting, reuse of existing libs, real 404s; alternative is rewrite cost with no user-visible gain. |
| D-09 | 2026-10-17 | Games and Lab apps run on separate origin G in a sandboxed iframe (`allow-scripts allow-same-origin allow-pointer-lock`) with validated `play/v1` postMessage. | Same-origin iframe (current) | Today games run unsandboxed on the main origin; any admin token there would be readable by game code. `allow-same-origin` is safe only because G ≠ A. |
| D-10 | 2026-10-17 | Public pages are static, built from a committed content snapshot; publish fires a deploy hook. No runtime Supabase reads on public pages. | Client-side fetch from Supabase | Keeps public pages fast, cacheable and working when the free-tier project is paused. |
| D-11 | 2026-10-17 | Third-party Lab runtimes (e.g. DuckDB-WASM) are exempt from the 150 KiB JS budget, loaded only after an explicit Launch with progress shown, never on Welcome. | No exception (forces lighter ports) | Lab ports may need them; the exception is scoped and visible. |
| D-12 | 2026-10-17 | Trademark game files are removed from deploy output in M3 (kept in git history). | Keep files deployed but unlinked | Unlinked files are still served and indexable. |
| D-13 | 2026-10-17 | Old canvas toys are retired from public pages unless the M0 audit shows they render real data. | Keep as decoration | Owner rule: no fake demos. Audit result: see `evidence/inventory.md`. |
