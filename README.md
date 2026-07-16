# arctanmyangle.github.io

Personal portfolio for [arcTanMyAngle](https://github.com/arcTanMyAngle) — a late-90s/early-00s CRT-terminal/arcade
aesthetic showcasing real GitHub projects: real-time systems, Rust/C++ tools, edge ML, and handmade games.

Built with [Astro](https://astro.build) (static output) + TypeScript, using [Bun](https://bun.sh) as the package
manager and runtime. No UI framework, no Tailwind, no remote font loading, no runtime GitHub API calls in the
deployed site.

## Stack

- **Astro 7** — static site generation, multi-page.
- **Bun** — install/run/build.
- **Plain/scoped CSS** — design tokens in `src/styles/tokens.css`, global chrome in `src/styles/global.css`, motion
  and CRT effects in `src/styles/effects.css`.
- **Vanilla TypeScript "toys"** — interactive canvas/DOM widgets (radar scope, spectrogram, signal map, reaction-time
  trainer, terminal) under `src/components/*.ts`.

## Project data

Real repo metadata (stars, language, license, last-pushed date) is fetched once from the GitHub API by
`scripts/sync-github.mjs` and committed to `src/data/github-repos.generated.json`. The site itself never calls the
GitHub API at runtime — every page reads the committed JSON, merged at build time with hand-authored copy in
`src/data/project-overrides.ts` (categories, featured status, and the full write-ups for the flagship projects).

## Running locally

```sh
bun install
bun run dev       # dev server
bun run build     # production build to dist/
bun run preview   # preview the production build
bun run sync:github  # re-fetch live repo metadata (falls back to the committed cache on failure)
```

## Deployment

Pushes to `main` run [`.github/workflows/deploy.yml`](.github/workflows/deploy.yml): install, re-sync GitHub project
data, build, and deploy to GitHub Pages via Actions. The repo's Settings → Pages → Source must be set to
"GitHub Actions" for this to take effect.
