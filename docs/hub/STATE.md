# STATE (updated 2026-10-18, M1.1 prototype C committed 355af5a, A/B files deleted)

Milestone: M1 in progress (M1.1 prototype C built, waiting on owner)
Done: M0 (committed b6df977). M1.1: prototypes A and B rejected (D-14); prototype C `/proto/c/` built: the full
pro-modern multi-page site (D-14), with pass-and-play chess for two (D-15). Browser-checked and excluded from
`bun run build`
Next exact task: owner reviews `/proto/c/` (`bun run dev`). On OK: M1.2, port C's tokens and `Shell` into
`src/styles/tokens.css` and the real layout, then delete `src/proto/` and `src/pages/proto/` (PLAN §7 M1)
Blocked: M1.2 on owner OK of C; Q-01 tabs content (M5), Q-02 projects (M3), Q-03 about (M5)
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
| Q-05 | Owner OK on prototype C (or named changes)? | site owner | M1.2 | none: M1.2 waits |

## Approvals still needed (owner)

- OK prototype C — M1.2.
- Create the new Supabase project (never reuse "Chemclicks") — M2.
- Create the two Cloudflare Pages projects — M1.
- Create the GitHub OAuth app — M2.

## Carry-forward (act on these, don't re-audit)

- C's palette passes AA in both themes: `--text-2`/`--text-3` on every surface ≥ 5.4:1, each section hue on
  `--surface` ≥ 4.99:1. Reuse C's values in M1.2; the old muted `#5b6688` (3.5:1) must not come back.
- Remove recruiter line `src/data/contact.ts:30` in M1.
- Stacker is already dt-based (PLAN §5.1 conversion not needed); touch handlers exist (PLAN §1.1 was wrong).
  Remaining: input extrapolation to `e.timeStamp`, DPR canvas, layout, `e.repeat`, visibility. Impossible must not
  use the random `arcadeOffset` rig. See `evidence/inventory.md` §4.
- Reaction needs 6 QG fixes before publishing (`evidence/inventory.md` §3).
- Astro CSP meta can't carry `frame-ancestors`: put it in `_headers`.
- Run `list_extensions` for `pg_jsonschema` right after the M2 Supabase project exists.
- Delete `src/proto/` and `src/pages/proto/` once the shell lands (only C remains; A/B deleted 2026-10-18).

## Last handoff

M1.1 C (2026-10-17). Files: `src/proto/c/` (`Shell`, `Icon`, `site.ts` nav and copy, `pages/*.astro` one per
route, toys `stacker.ts`, `reaction.ts`, `chessLine.ts`, `chessPlay.ts` with `pieces.ts` and `board.css`), routed by
`src/pages/proto/c/[...path].astro`. Chess for two: drag or click, keyboard (arrows + Enter, roving tabindex),
promotion picker, undo, flip, optional clocks (3+2, 5+0, 10+0), PGN copy, draw/resign with a two-step confirm,
game saved to localStorage; `?line=<id>` sets up an opening and puts an unfinished game aside (restorable).
Lessons: `getStaticPaths` runs hoisted, so it can't see frontmatter variables — inline the route keys there;
a class that sets `display` beats `[hidden]`, so add an explicit `[hidden]{display:none}`; Astro doesn't rewrite
`:global()` nested inside `:has()` (lightningcss warns), so use a scoped class instead; synthetic
`KeyboardEvent`s don't trigger button clicks, so test keyboard with real key presses.
Checked: all 11 pages at desktop and 375 px (no horizontal scroll), dark and light themes, chess flows above,
Tabs chord picker, Skate trick picker, Reaction round highlight; build 26 pages, no warnings, no `dist/proto`.
Not checked: screen reader pass, Lighthouse on prototype C.
