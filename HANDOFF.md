# Handoff — resume here

Status snapshot for picking this build back up in a fresh session. Read `CLAUDE.md` alongside this for durable
conventions. The full approved architecture plan (data pipeline design, CSS architecture, hydration pattern, canvas
perf discipline, workflow shape, build order) lives at
`C:\Users\bornt\.claude\plans\you-are-claude-code-sequential-clock.md` on this machine — this file is the
self-contained summary in case that path isn't available.

## What this project is

Full rebuild of `arctanmyangle.github.io` from a placeholder Tailwind bento-grid site into a Y2K chrome/blue
futurism portfolio (deep indigo-black backdrop, glossy Windows XP Luna / Mac OS Aqua-style chrome UI, electric
blue/cyan/magenta holographic accents), built with Astro 7 + TypeScript + Bun, showcasing arcTanMyAngle's real
GitHub projects. Multi-page, static-first, no heavy frameworks. The Astro project lives at the **repo root**.

**Design history**: the site was originally built (phases 1–14 below) with a late-90s/early-00s CRT-terminal/arcade
aesthetic. After that build was complete, deployed, and verified, the user shared a Y2K/"frutiger aero" reference
collage (chrome, glossy blue-silver gradients, holographic, iPod/Xbox-era tech optimism) and asked for a full pivot
to that look — see "Design pivot session" below for exactly what changed and why. Don't be confused if you find
references to the old CRT direction in git history or in your own memory of this project; the Y2K chrome/blue
direction described above is current.

## Deploy status (as of the pivot session)

- GitHub Pages Source has been switched from "Deploy from a branch" to **"GitHub Actions"** (user did this in the
  repo Settings UI). The new `.github/workflows/deploy.yml` has run successfully at least once.
- A stray root-level `index.html` ("Lured by Curiousity" — unrelated content from an earlier course assignment,
  different persona/author) was what got served under the *old* branch-based Pages source. It is **not** included
  in the new Actions-based deploy (that workflow uploads only `dist/`, Astro's own build output) — it's inert now,
  just sitting in the repo. Per the locked-in decision below, leave it alone; it's not this project's file to
  delete.
- Local `main` and `origin/main` are in sync — the two build-session commits were rebased onto a small unrelated
  assignment commit (`fancifymytext.html/js`) that existed upstream, then pushed successfully.

## Build order status

## Build order status

All 14 phases from the original plan are now complete. The site is fully built out: 25 static pages, zero
`tsc`/`astro build` errors, dev-server smoke-tested.

1. ✅ **Scaffolding.**
2. ✅ **Tokens + layout shell.**
3. ✅ **Data pipeline.**
4. ✅ **Canvas infra + toy modules** (Radar/Spectrogram/SignalMap/Reaction/Terminal).
5. ✅ **`registerProjectCommands()` wired** — done from `BaseLayout.astro`'s existing palette-mount script (not a
   separate page), since it's global chrome that needs project data on every page anyway. Adds "Open project: X"
   for each of the 6 featured projects plus "Open a random project" to the command palette.
6. ✅ **Projects listing + detail pages.**
   `src/components/{ProjectCard,ProjectGrid}.astro` + `ProjectFilters.ts` (search/category/status/sort, all
   client-side over the server-rendered card DOM — no re-fetch, no client data model) → `src/pages/projects/
   index.astro` → `src/pages/projects/[slug].astro` (`getStaticPaths` over `getAllProjects()`; full 6-section layout
   + demo toy when `detailSections` is present, condensed card otherwise). `src/components/ArcadeCabinet.astro` was
   built here (not deferred to phase 9) since the `arcade` project's detail page needs it — it's a
   variant=`"compact"|"full"` component with its own scoped insert-coin/select/start state machine, reused as-is by
   `/arcade.astro`. Foliage's "scanner" demo is a small inline CSS sweep-bar effect, single-use as planned, no
   separate module.
7. ✅ **Real home page** (`src/pages/index.astro`): hero with an eager `HeroCanvas.ts` background (pixel starfield +
   a slow radar-style searchlight sweep, built on the shared `canvasLoop.ts`), the three entry buttons (Enter the
   Lab / Browse Projects / Insert Coin), and a featured-projects grid below the fold reusing `ProjectGrid.astro`.
8. ✅ **`/lab.astro`** — all 5 toys in `WindowFrame`s, each lazy-mounted via `lazyMount.ts` + dynamic `import()`.
9. ✅ **`/arcade.astro`** — full-variant `ArcadeCabinet` with keyboard hints, links to the arcade project's detail
   page.
10. ✅ **`/about.astro`** (skill matrix grouped by category, "currently exploring" log, honest tone — no invented
    credentials) + **`/contact.astro`** (terminal-readout-styled panel that explicitly enumerates why there's no
    email/social listed and links to GitHub as the one real channel).
11. ✅ **Field notes.** `src/content.config.ts` (Content Layer API, `glob` loader over `src/content/notes/*.md`) + 3
    seed notes (`real-time-visual-systems.md`, `games-are-good-interfaces.md`, `edge-ml-on-cheap-hardware.md`, each
    grounded in specifics from a real flagship project, not generic takes) + `src/pages/field-notes/{index,[slug]}
    .astro` using `render()` from `astro:content` (Astro 7's replacement for `entry.render()`).
12. ✅ **Polish.** `public/og-default.png` generated (1200×630 PNG via a one-off Python/Pillow script — no image
    tooling exists in the JS toolchain, so this was produced out-of-band and committed as a static asset, not by any
    build step; regenerated again during the Y2K pivot, see below) + `public/robots.txt`. `astro.config.mjs` sitemap
    integration confirmed already correct from phase 1.
13. ✅ **Deploy workflow + README.** `.github/workflows/deploy.yml` (bun setup → install → `sync:github` with
    `GITHUB_TOKEN` → build → `actions/deploy-pages`) + root `README.md` rewritten with real project docs (stack,
    data-pipeline explanation, local dev commands, deploy notes).
    **Manual step the user still needs to do**: repo Settings → Pages → Source → switch to "GitHub Actions". Cannot
    be done from the workflow file itself.
14. ⚠️ **Final verification — machine-checked thoroughly, but no real screenshot was ever produced.** What *was*
    done: `bunx tsc --noEmit` clean, `bun run build` clean (25 pages), and a live dev-server pass — started
    `bun run dev`, curled all 14 top-level routes (200s, sane byte sizes, no server errors in the astro log), and
    grep-verified the expected interactive markup (`data-toy` mounts, `.arcade-cabinet`, `#project-filters` control
    IDs, hero canvas) is present in the actual rendered HTML. A genuine headless-browser attempt was also made this
    session: no `chromium-cli` exists in this sandbox, so Playwright's Chromium (~184MB) was downloaded via
    `bunx playwright install chromium` (took several minutes, eventually succeeded — files live at
    `~/AppData/Local/ms-playwright/chromium-1228`, outside the repo, not committed anywhere). A driver script was
    written against `playwright-core` to screenshot every page and drive two interactions (arcade cabinet
    insert-coin→select→start, project search filter). **The browser process launched (got a real pid) but the
    Playwright↔Chromium CDP handshake over the debugging pipe hung and timed out at 180s** — most likely this
    sandbox blocks whatever OS-level IPC primitive `--remote-debugging-pipe` needs for a child process it spawns.
    Don't re-attempt the same approach expecting a different result unless something about the sandbox's process
    isolation has changed; if a real screenshot is needed, either try `--remote-debugging-port` (TCP instead of a
    pipe) as a workaround, or hand this off to the user's own machine / an environment with working `chromium-cli`.
    **Net effect: canvas animation, click-driven toy state, and CRT/motion visual correctness are still only
    verified by code review and structural HTML checks, not by watching them run.** Do one real click-through pass
    in an actual browser — `bun run dev` and manually visit `/`, `/lab/`, `/arcade/`, and one flagship project page
    — before calling this fully shipped.

## Design pivot session: CRT-terminal → Y2K chrome/blue futurism

Full design-system reskin, done in one session after the initial 14-phase build was already deployed. Every visual
file changed; page structure/routes/data model did not.

- **`src/styles/tokens.css`** — full rewrite. New palette: `--color-bg` shifted from near-black to deep indigo-black
  (`#050912`), `--color-green`/`--color-green-dim` **removed** (replaced by `--color-blue`/`--color-blue-dim`,
  `#4fb2ff`/`#2f6fb8`), `--color-cyan`/`--color-amber`/`--color-magenta` **kept their names** but got retuned hex
  values (brighter/more holographic). New chrome-gradient tokens: `--chrome-titlebar`, `--chrome-button`,
  `--chrome-button-hover`, `--chrome-button-active` (Aqua/Luna-style glossy gradients), `--holo-gradient` (an
  animated blue→cyan→magenta→blue band used for the marquee-header "holographic foil" treatment). Radius scale went
  from sharp/pixel (`2px`/`4px`) to rounded/glossy (`6px`/`12px`) plus a new `--radius-pill` (`999px`) for buttons
  and chips. `--scanline-opacity`/`--z-scanline` renamed to fold into the new shine-overlay design (see effects.css).
- **`src/styles/effects.css`** — the CRT scanline-overlay + `crt-flicker` keyframe were replaced with a
  `.shine-overlay` + `shine-sweep` keyframe (a soft diagonal holographic sheen that drifts across the viewport).
  `data-crt` attribute renamed to **`data-shine`** throughout. Attract-mode (Konami easter egg) and the reduced-
  motion kill switch were left untouched — both are already palette-agnostic (`filter: hue-rotate/brightness`,
  `animation-duration: 0.001ms !important`) and needed zero changes to keep working under the new theme.
- **`src/styles/global.css`** — full rewrite. Body/heading font-family moved from `--font-mono` to `--font-sans`
  (Y2K poster typography, not terminal typography) — `--font-mono` is now deliberately reserved for the parts that
  are still conceptually a technical readout: `.toy-stat-row`, `.terminal-toy`, `.palette` (command palette). Window
  titlebars now use `--chrome-titlebar` with colored traffic-light dots (red/amber/green, Mac-style). Buttons
  (`.beveled-button`) became glossy chrome pill buttons with a `::after` shine-highlight overlay instead of flat
  bordered ghost-buttons. `.pixel-border` renamed to **`.chrome-border`** (glossy inset-bevel look). `.marquee-header`
  now uses `--holo-gradient` as an animated "holographic foil banner" instead of a diagonal-stripe pattern. Chips
  became pill-shaped. Every remaining `--color-green`/`--glow-green` reference was migrated — mostly to
  `--color-blue`/`--glow-blue` (site accents, chip--status-active, status-dot--on, palette selected-item, toy-stat
  emphasis), with a couple of deliberate exceptions where cyan reads better contextually (site-logo, terminal-toy
  output text, reaction-game "go" flash state).
- **Renamed across the codebase** (mechanical, not just cosmetic — grep confirmed zero leftover references):
  `data-crt` → `data-shine`, `atma:crt-mode` → `atma:shine-mode`, `crtMode` → `shineMode`, `getCrtMode`/`setCrtMode`
  → `getShineMode`/`setShineMode` (in `src/lib/clientState.ts`), the command-palette toggle command
  (`toggle-crt`/"Toggle CRT mode" → `toggle-shine`/"Toggle chrome shine" in `src/components/CommandPalette.ts`), and
  the `<html>` attribute + blocking FOUC script in `src/layouts/BaseLayout.astro`.
- **Canvas toy color literals** — `RadarToy.ts`, `SpectrogramToy.ts`, `SignalMapToy.ts`, `HeroCanvas.ts` all had
  hardcoded hex/rgba color strings (canvas can't read CSS custom properties), so each one was hand-updated to match
  the new tokens: old green `rgb(60,255,122)` → new blue `rgb(79,178,255)`, old amber `rgb(255,176,0)` → new amber
  `rgb(255,207,92)`, old magenta `rgb(225,75,255)` → new magenta `rgb(210,104,255)`, old bg `#05070a` → new bg
  `#050912`. If you add a new canvas toy, pull the current hex values from `tokens.css` rather than re-deriving
  them, since these can't be kept in sync automatically.
- **`public/og-default.png`** regenerated from scratch with the new palette (glossy blue Aqua-style titlebar with
  traffic-light dots, holographic foil band, blue/cyan/magenta text) — same one-off Python/Pillow approach as
  before, script not committed to the repo.
- **`CLAUDE.md`** updated: aesthetic description, `data-shine` attribute name, `shineMode` key name.
- Verified after the pivot: `bunx tsc --noEmit` clean, `bun run build` clean (still 25 pages), grep-confirmed zero
  leftover `color-green`/`glow-green`/`data-crt`/`crt-mode`/`pixel-border`/`scanline` references anywhere in `src/`.
  **No new browser-visual verification was done this pivot session** (see phase 14 above for why headless-Chromium
  doesn't work in this sandbox) — the same caveat applies: do a real click-through before calling the redesign done.

## A real bug caught and fixed this session

The first draft of `/projects/[slug].astro`'s demo-toy mounting script used `<script define:vars={{ demoType }}>`
with a relative `import(...)` inside. **`define:vars` forces Astro to treat the script as inline/unprocessed** — it
is never passed through Vite, so relative import specifiers are never bundled/resolved and would 404 in the
browser. Caught by inspecting the actual built `dist/` HTML (the script tag stayed a plain inline `<script>` instead
of becoming `<script type="module" src="/_astro/...">`), not by `tsc` or `astro build`, since neither one type-checks
or resolves specifiers inside `define:vars` script bodies. Fixed by reading `demoType` from the mounted element's
`data-toy` attribute instead of via `define:vars`, so the script could go back to being a normal processed module
script. **Lesson for future toy-mounting scripts on this site: never combine `define:vars` with `import()` or static
`import` — pass data through the DOM (data attributes) instead, and keep the script a plain module.**

## Decisions already locked in (don't re-litigate)

- Full replace of the old placeholder design; nothing preserved from it.
- Astro project at repo root, not a subfolder.
- Root `index.html` (unrelated course-assignment page, different author) stays **completely untouched**.
- Bun everywhere, no npm.
- `src/data/github-repos.generated.json` is **committed to git**, not gitignored (CI fallback needs it in a fresh
  checkout).
- `registerProjectCommands()` is called from `BaseLayout.astro`, not from individual pages — it's global chrome that
  needs the same featured/random-project commands on every page, so centralizing it there avoids repeating the same
  wiring on every page's script block.

## Verified facts worth not re-deriving

- 19 real repos on `github.com/arcTanMyAngle`; the 6 flagship slugs are `look-above`, `global_unrest`,
  `bird_acoustics`, `arcade`, `real-timereaction`, `foliage_disease_classification`.
- All 25 static routes build clean: `/`, `/projects/`, `/projects/<15 slugs>/`, `/lab/`, `/arcade/`, `/about/`,
  `/contact/`, `/field-notes/`, `/field-notes/<3 slugs>/`.
- `public/og-default.png` was generated by a throwaway Python/Pillow script (not committed to the repo, it lived in
  the session scratchpad) — if the OG image ever needs regenerating, it'll need to be rebuilt from scratch the same
  way (or hand-designed properly); there's no script in this repo that produces it.
- Nothing in this repo touches Tailwind, React/Vue/Svelte, or a remote font — grep for those before assuming a
  dependency was quietly reintroduced.
