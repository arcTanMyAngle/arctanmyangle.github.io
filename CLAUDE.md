# CLAUDE.md

Project-specific guidance for Claude Code sessions working in this repo.

## What this is

arcTanMyAngle's GitHub Pages portfolio (`arctanmyangle.github.io`). Astro 7 + TypeScript, static output, Bun as the
package manager/runtime. Y2K chrome/blue futurism aesthetic — deep indigo-black backdrop, glossy Windows XP
Luna / Mac OS Aqua-style chrome UI (gradient-filled pill buttons, glossy titlebars with traffic-light dots),
electric blue/cyan/magenta holographic accents — executed with modern performance discipline. (This replaced an
earlier CRT-terminal/arcade direction; if you see stray references to "CRT" anywhere, they're a miss from that
rename, not intentional.) For current build status and exact next steps, read `HANDOFF.md` in this repo first.

## Hard conventions — do not deviate without asking

- **Bun, not npm.** `bun install`, `bun run dev/build/preview`, `bun run sync:github`. Never suggest npm/pnpm/yarn.
- **No Tailwind, no UI framework.** Plain/scoped Astro CSS only (`src/styles/tokens.css` → `global.css` →
  `effects.css`). No React/Vue/Svelte.
- **No runtime GitHub API calls.** The only file allowed to call the GitHub API is `scripts/sync-github.mjs`.
  Everything else reads the committed `src/data/github-repos.generated.json`.
- **System fonts only.** No Google Fonts / remote font loading, ever.
- **Motion is attribute-gated, not media-query-gated per component.** Every conditional animation keys off
  `<html data-shine="on|off" data-motion="full|reduced">`, set once by the blocking init script in
  `src/layouts/BaseLayout.astro`. Don't add a second `prefers-reduced-motion` check elsewhere — read `data-motion`.
  (`data-shine` toggles the holographic shine-sweep overlay; it was called `data-crt` before the Y2K redesign.)
- **Toy/island pattern:** every interactive vanilla-TS module (`src/components/*.ts`) exports
  `mount(root: HTMLElement, options?) => { destroy(): void }`. Canvas-based toys use the shared
  `src/lib/canvasLoop.ts` (`startCanvasLoop`) for DPR capping / visibility pausing / reduced-motion gating / mobile
  throttling — never hand-roll a second rAF loop. Below-the-fold toys mount via `src/lib/lazyMount.ts`.
- **Data model:** `src/lib/projects.ts` merges `src/data/github-repos.generated.json` (machine-written by
  `scripts/sync-github.mjs` — don't hand-edit) with `src/data/project-overrides.ts` (hand-authored, keyed by
  lowercased repo name = slug). A project gets the full 6-section detail-page layout iff its override has a
  `detailSections` block — presence of that field is the flag, not a separate boolean.
- **Never invent metrics.** Stars/license/etc. come only from the generated JSON. Omit a metric a repo doesn't
  have — don't estimate or invent one.

## Where things are

- Design tokens: `src/styles/tokens.css` (CSS custom properties only, no selectors). Chrome gradients live here too
  (`--chrome-titlebar`, `--chrome-button*`, `--holo-gradient`).
- Global chrome/utility classes: `src/styles/global.css`.
- All motion/shine/attract-mode effects: `src/styles/effects.css`.
- Central localStorage keys: `src/lib/clientState.ts` (`STORAGE_KEYS`) — the blocking FOUC script in
  `BaseLayout.astro`'s `<head>` duplicates the `shineMode`/`reducedEffects` key strings inline (must be a classic,
  non-module script to block before paint). Keep them in sync if a key is renamed.
- Command palette: `src/components/CommandPalette.ts`, mounted globally from `BaseLayout.astro`. The Konami-code
  attract-mode toggle lives inside it too. `registerProjectCommands()` is how page-level code injects the
  "open a featured project" / "random project" commands without this module importing project data itself.

## Running things

- `bun install` — only needed once / after dependency changes.
- `bun run dev` — dev server (prefer `astro dev --background` so it doesn't block the terminal).
- `bun run build` — must pass with zero errors before considering any phase done.
- `bun run sync:github` — re-fetches live repo metadata; safe to re-run, falls back to the committed cache on
  failure (rate limit, network down, etc.) rather than failing the build.

## Token-efficiency notes for future sessions

- Read `HANDOFF.md` first — it has current build status and exact next steps, so `git status`/full-repo exploration
  at session start usually isn't necessary.
- The real GitHub repo data (descriptions, tech stacks, README-derived facts for the 6 flagship projects) is already
  fully captured in `src/data/project-overrides.ts`. Don't re-fetch READMEs or the GitHub API "to verify" — that was
  done once, deliberately, from the live API. Only re-fetch if the user explicitly asks for updated project copy.
- Don't re-explore the whole repo tree at the start of a session by default — `HANDOFF.md` + this file are the
  intended fast-start path.
