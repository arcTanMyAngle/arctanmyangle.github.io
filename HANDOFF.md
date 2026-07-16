# Handoff — resume here

Status snapshot for picking this build back up in a fresh session. Read `CLAUDE.md` alongside this for durable
conventions. The full approved architecture plan (data pipeline design, CSS architecture, hydration pattern, canvas
perf discipline, workflow shape, build order) lives at
`C:\Users\bornt\.claude\plans\you-are-claude-code-sequential-clock.md` on this machine — this file is the
self-contained summary in case that path isn't available.

## What this project is

Full rebuild of `arctanmyangle.github.io` from a placeholder Tailwind bento-grid site into a late-90s/early-00s
CRT-terminal/arcade-cabinet portfolio, built with Astro 7 + TypeScript + Bun, showcasing arcTanMyAngle's real GitHub
projects. Multi-page, static-first, no heavy frameworks. The Astro project lives at the **repo root**.

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
12. ✅ **Polish.** `public/og-default.png` generated (1200×630 CRT-window-chrome-styled PNG via a one-off Python/
    Pillow script — no image tooling exists in the JS toolchain, so this was produced out-of-band and committed as
    a static asset, not by any build step) + `public/robots.txt`. `astro.config.mjs` sitemap integration confirmed
    already correct from phase 1.
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
