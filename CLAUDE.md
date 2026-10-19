# CLAUDE.md

Project-specific guidance for Claude Code sessions working in this repo.

## What this is

arcTanMyAngle's personal hub (`arctanmyangle.github.io`): games, chess, guitar tabs, data experiments and a skate
sim. Astro 7 + TypeScript, static output, Bun as the package manager/runtime. **Pro-modern aesthetic** (prototype C,
D-14): near-black or near-white flat surfaces, hairline `--line` borders, one accent hue per section (`--arcade`,
`--chess`, `--lab`, `--tabs`, `--skate`, `--projects`, `--about`), dark by default with a light theme. Older "CRT",
"Y2K chrome", "beam" or "one gradient per view" references anywhere are leftovers from retired designs. **The hub
rebuild (Cloudflare Pages, owner admin) is in progress** — for current status and exact next steps, read
`docs/hub/STATE.md` first.

## Hard conventions — do not deviate without asking

- **Bun, not npm.** `bun install`, `bun run dev/build/preview/check`, `bun run sync:github`. Never suggest
  npm/pnpm/yarn.
- **No Tailwind, no UI framework.** Plain/scoped Astro CSS only (`src/styles/tokens.css` → `global.css` →
  `effects.css`, plus `board.css` for chess). No React/Vue/Svelte.
- **No runtime GitHub API calls.** The only file allowed to call the GitHub API is `scripts/sync-github.mjs`.
  Everything else reads the committed `src/data/github-repos.generated.json`.
- **System fonts only.** No Google Fonts / remote font loading, ever.
- **Theme and motion are attribute-gated.** `<html data-theme="dark|light" data-motion="full|reduced">` is set once
  by the blocking inline script in `src/layouts/BaseLayout.astro` (reads `atma:theme` / `atma:reduced-effects`,
  falls back to `prefers-reduced-motion`). Every transition or animation keys off `:root[data-motion="full"]`; don't
  add a second `prefers-reduced-motion` check elsewhere. **Never name a state attribute the same as a content hook**
  (`querySelectorAll("[data-x]")` would match `<html>` itself).
- **Background tabs are a real case.** A hidden document gets no rAF and unreliable IntersectionObserver callbacks.
  Anything that animates on mount must defer on `document.hidden` and resume on `visibilitychange`.
- **Toy/island pattern:** every interactive vanilla-TS module (`src/components/*.ts`) exports
  `mount(root: HTMLElement, options?) => { destroy(): void }`. `src/lib/canvasLoop.ts` (DPR capping, visibility
  pausing, reduced-motion gating) and `src/lib/lazyMount.ts` are kept for canvas/below-the-fold toys; use them rather
  than hand-rolling a second rAF loop.
- **Data model:** `src/lib/projects.ts` merges `src/data/github-repos.generated.json` (machine-written by
  `scripts/sync-github.mjs` — don't hand-edit) with `src/data/project-overrides.ts` (hand-authored, keyed by
  lowercased repo name = slug).
- **Never invent metrics.** Stars/license/etc. come only from the generated JSON. Omit a metric a repo doesn't
  have — don't estimate or invent one.
- **Contrast:** the palette in `tokens.css` passes WCAG AA in both themes. The old muted `#5b6688` must not come back.

## Where things are

- Design tokens: `src/styles/tokens.css` (custom properties only; dark under `:root`, light under
  `[data-theme="light"]`).
- Layout: `src/layouts/BaseLayout.astro` (props `title`, `description`, `section`, `ogImage`, `ogType`): meta,
  head script, header nav, footer, display controls, command palette. `section` marks the nav item and sets
  `body[data-section]` for the page's hue.
- Nav, routes and shared copy: `src/data/site.ts` (`nav`, `href()`, `githubUrl`, chess lines, experiments).
- Routes: `/`, `/arcade/` (+ `stacker/`, `reaction/`), `/chess/` (+ `play/`), `/lab/`, `/tabs/`, `/skate/`,
  `/projects/` (footer only), `/about/` (`#contact`), 404. Retired routes redirect via `public/_redirects`
  (Cloudflare only).
- Toys: `src/components/stacker.ts`, `reaction.ts`, `chessLine.ts`, `chessPlay.ts` (uses `chess.js`); chess
  piece art in `src/lib/pieces.ts`; shared Astro pieces `Icon`, `Board`, `GameFrame`, `StackerPreview`.
- Central localStorage keys: `src/lib/clientState.ts` (`STORAGE_KEYS`). The blocking head script in `BaseLayout.astro`
  duplicates the `theme`/`reducedEffects` key strings inline (must be a classic, non-module script to block before
  paint). Keep them in sync if a key is renamed.
- Display toggles: `src/components/DisplayControls.ts` (header theme button, footer motion button).
- Command palette: `src/components/CommandPalette.ts`, mounted globally (Ctrl/Cmd+K). Its toggles click the visible
  buttons so labels stay in step.

## Running things

- `bun install` — only needed once / after dependency changes.
- `bun run dev` — dev server (prefer `astro dev --background` so it doesn't block the terminal).
- `bun run check` and `bun run build` — both must pass with zero errors before considering any phase done.
- `bun run sync:github` — re-fetches live repo metadata; safe to re-run, falls back to the committed cache on
  failure (rate limit, network down, etc.) rather than failing the build.

## Token-efficiency notes for future sessions

- Read `docs/hub/STATE.md` first — it has current milestone, next exact task and blockers for the hub rebuild
  (plan: `docs/hub/PLAN.md`, tasks: `docs/hub/TASKS.md`, decisions: `docs/hub/DECISIONS.md`). `HANDOFF.md`
  describes the old site only.
- The real GitHub repo data for the flagship projects is already captured in `src/data/project-overrides.ts`. Don't
  re-fetch READMEs or the GitHub API "to verify". Only re-fetch if the user explicitly asks for updated project copy.
- Don't re-explore the whole repo tree at the start of a session by default — `docs/hub/STATE.md` + this file are
  the intended fast-start path.
