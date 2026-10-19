# STATE (updated 2026-10-18, M1.2 prototype C promoted to the real site, proto deleted)

Milestone: M1 in progress (M1.1 and M1.2 done)
Done: M0 (b6df977). M1.1: A/B rejected, C approved (D-14, D-15). M1.2: C is the real site: tokens, `BaseLayout`,
every page on its real route, toys in `src/components/`; `src/proto/`, `src/pages/proto/`, the old pages and toys,
`reveal.ts` and `motion` deleted; `public/_redirects` for retired routes (D-16)
Next exact task: rest of M1 (PLAN §7): the two Cloudflare Pages projects (owner approval), `_headers` with CSP and
`frame-ancestors`, CI running `bun run check` + `bun run build`, then the M1 contracts
Blocked: Cloudflare projects on owner approval; Q-01 tabs content (M5), Q-02 projects (M3), Q-03 about (M5)
Live: GitHub Pages (old site) until M6 cut-over
Budgets: see PLAN §4; baseline: `evidence/baseline/` (recorded; all routes already meet A-PERF-01 and A-PERF-05)
Risks top-3: Supabase pause; Lab data rights; Stacker name/trade dress + "$1/tickets/Jackpot" framing

## Read order for a new session

1. This file. 2. `PLAN.md` (milestone you're on). 3. `TASKS.md` (row status). 4. `DECISIONS.md` before
changing anything a D-entry covers. `HANDOFF.md` at the repo root describes the **old** site and is historical.

## Open questions

| ID | Question | Owner | Due | Fallback if unanswered |
|---|---|---|---|---|
| Q-01 | Which 3 guitar tabs, and do you hold the rights? | site owner | M5 | `/tabs/` pipeline built, unpublished |
| Q-02 | Does `roomies4sac` qualify (yours, good enough)? Redeploy Real-TimeReaction? | site owner | M3 | Projects hidden until one item passes QG |
| Q-03 | About-page facts; keep/drop the 3 field notes | site owner | M5 | Minimal about + GitHub contact; field notes 301 → `/about/` |
| Q-04 | Tag Italian / Giuoco Piano for Black too? | site owner | M4 | White only |

## Approvals still needed (owner)

- Create the new Supabase project (never reuse "Chemclicks") — M2.
- Create the two Cloudflare Pages projects — M1.
- Create the GitHub OAuth app — M2.

## Carry-forward (act on these, don't re-audit)

- C's palette passes AA in both themes: `--text-2`/`--text-3` on every surface ≥ 5.4:1, each section hue on
  `--surface` ≥ 4.99:1. These are now the real tokens; the old muted `#5b6688` (3.5:1) must not come back.
- Stacker is already dt-based (PLAN §5.1 conversion not needed); touch handlers exist (PLAN §1.1 was wrong).
  Remaining: input extrapolation to `e.timeStamp`, DPR canvas, layout, `e.repeat`, visibility. Impossible must not
  use the random `arcadeOffset` rig. See `evidence/inventory.md` §4.
- Reaction needs 6 QG fixes before publishing (`evidence/inventory.md` §3).
- `canvasLoop.ts` and `lazyMount.ts` are kept but unused since M1.2; reuse or delete them when Stacker gets its QG pass.
- `public/games/` (dk64, kaboom, mario, stacker, tetris + three.min.js, from 75d2594) still ships to `dist/games/` but
  nothing links to it since M1.2. Owner decides keep/delete; check rights before keeping any of it.
- Astro CSP meta can't carry `frame-ancestors`: put it in `_headers`.
- Run `list_extensions` for `pg_jsonschema` right after the M2 Supabase project exists.

## Last handoff

M1.2 (2026-10-18). Moved with `git mv` from `src/proto/c/`: `Icon`, `Board`, `GameFrame`, `StackerPreview` and the
toys (`stacker`, `reaction`, `chessLine`, `chessPlay`) → `src/components/`; `pieces.ts` → `src/lib/`; `site.ts` →
`src/data/` (`BASE = ""`); pages → `src/pages/<route>/`. `Shell` became `src/layouts/BaseLayout.astro` (props
`title`, `description`, `section`, `ogImage`, `ogType`; blocking head script sets `data-theme` + `data-motion` from
`atma:theme` / `atma:reduced-effects`). `clientState.ts` STORAGE_KEYS hold every key the toys use. Old `/contact` and
`/field-notes/*` 301 via `public/_redirects` (Cloudflare only). The `#contact` anchor is on `/about/`.
Lesson: TS keeps a guard's narrowing across a call that reassigns the variable; return the value instead
(`chessPlay.ts` `refresh()`).
Checked: `bun run check` 0 errors, build passes; every route 200 with the right title and `aria-current`; 375 px
dark and light, no horizontal scroll; menu, theme, motion and palette toggles; chess move + save; Stacker and
Reaction render; all internal links and assets resolve.
Not checked: screen reader pass, Lighthouse, `_redirects` behaviour (needs Cloudflare).
