# CLAUDE.md

Project-specific guidance for Claude Code sessions working in this repo.

## What this is

arcTanMyAngle's GitHub Pages portfolio (`arctanmyangle.github.io`). Astro 7 + TypeScript, static output, Bun as the
package manager/runtime. **Dark instrument-panel aesthetic** — deep indigo-black backdrop, hairline-beveled chrome
(titlebars with traffic-light dots), blue/cyan accents, and a single scanner beam sweeping across the viewport
behind everything. Restraint is the point: **exactly one gradient-filled element per view** (the primary CTA,
`--chrome-primary`); every other surface is a flat fill with a `--hairline` bevel. (Design history: a CRT/arcade
build → a glossy Y2K chrome pivot → this de-gradiented pass. Stray "CRT" or "holographic foil" references anywhere
are leftovers from those renames, not intentional.) For current build status and exact next steps, read
`HANDOFF.md` in this repo first.

## Hard conventions — do not deviate without asking

- **Bun, not npm.** `bun install`, `bun run dev/build/preview`, `bun run sync:github`. Never suggest npm/pnpm/yarn.
- **No Tailwind, no UI framework.** Plain/scoped Astro CSS only (`src/styles/tokens.css` → `global.css` →
  `effects.css`). No React/Vue/Svelte.
- **No runtime GitHub API calls.** The only file allowed to call the GitHub API is `scripts/sync-github.mjs`.
  Everything else reads the committed `src/data/github-repos.generated.json`.
- **System fonts only.** No Google Fonts / remote font loading, ever.
- **Motion is attribute-gated, not media-query-gated per component.** Every conditional animation keys off
  `<html data-shine="on|off" data-motion="full|reduced" data-reveal-state="armed|off">`, set once by the blocking
  init script in `src/layouts/BaseLayout.astro`. Don't add a second `prefers-reduced-motion` check elsewhere —
  read `data-motion`. (`data-shine` dims the beam and chrome flourishes; it was called `data-crt` before the Y2K
  redesign. **Never name a state attribute the same as a content hook** — `data-reveal` was briefly both, so
  `querySelectorAll("[data-reveal]")` matched `<html>` itself.)
- **Scroll reveal.** `src/lib/reveal.ts` uses `motion` (bundled, not a CDN) for `[data-reveal]` / `[data-reveal-group]`.
  The CSS that hides those elements applies **only** under `:root[data-reveal-state="armed"]`, and every failure
  path in that module disarms it — so a JS error, a background tab, or a thrown `inView` can never leave content
  permanently invisible. Motion's option is `ease`, not the WAAPI `easing` (the latter is silently ignored).
- **Background tabs are a real case.** A hidden document gets no rAF and unreliable IntersectionObserver callbacks
  — exactly what happens when a recruiter middle-clicks several links at once. `reveal.ts` and `lazyMount.ts` both
  defer on `document.hidden` and resume on `visibilitychange`. Keep that guard in anything new that animates on mount.
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

- Design tokens: `src/styles/tokens.css` (CSS custom properties only, no selectors). Chrome surfaces live here too
  (`--chrome-titlebar`, `--chrome-button*`, `--hairline`). `--chrome-primary` / `--chrome-primary-hover` are the
  **only** gradients in the system — don't add a third.
- Contact routes: `src/data/contact.ts`. `email`, `linkedin`, and `resumeUrl` ship as empty strings and simply
  don't render; filling one in grows the contact page a channel (and a "Download CV" button) automatically.
  Publishing the user's address is their call — don't fill these in unprompted.
- Toy shells: `src/components/ToyMount.astro` server-renders a placeholder with reserved height for every
  client-mounted toy, so nothing shifts on mount and a no-JS visitor sees real copy instead of an empty box.
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
