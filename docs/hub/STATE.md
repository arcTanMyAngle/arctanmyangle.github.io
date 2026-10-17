# STATE (updated 2026-10-17, M0 commit on main after 74831d2)

Milestone: M0 done (committed); M1 next
Done: plan approved (2026-10-17); `docs/hub/*` created; baseline + inventory + audits recorded (M0.1–M0.9)
Next exact task: M1.1: build two Clean-zine prototypes `/proto/a/` (paper & ink) and
`/proto/b/` (night zine) for the owner to pick from (PLAN §7 M1)
Blocked: Q-01 tabs content (M5), Q-02 projects (M3), Q-03 about (M5)
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

## Carry-forward from M0 (act on these, don't re-audit)

- M1 tokens must meet AA contrast: the old muted `#5b6688` on near-black (3.5:1) is the site's only a11y failure.
- Remove recruiter line `src/data/contact.ts:30` in M1.
- Stacker is already dt-based (PLAN §5.1 conversion not needed); touch handlers exist (PLAN §1.1 was wrong).
  Remaining: input extrapolation to `e.timeStamp`, DPR canvas, layout, `e.repeat`, visibility. Impossible must not
  use the random `arcadeOffset` rig. See `evidence/inventory.md` §4.
- Reaction needs 6 QG fixes before publishing (`evidence/inventory.md` §3).
- Astro CSP meta can't carry `frame-ancestors`: put it in `_headers`.
- Run `list_extensions` for `pg_jsonschema` right after the M2 Supabase project exists.

## Last handoff

M0 finished on 2026-10-17. Evidence: `evidence/baseline/{js-bytes,headers,lighthouse}.md` and
`evidence/inventory.md`. The old site is already fast (Lighthouse mobile perf median 100 on `/`, `/arcade/`,
`/projects/`; ≤25.7 KiB gzip JS per route), so the rebuild's job on performance is not to regress. Gaps are
headers (gzip only, `max-age=600` on hashed assets, no security headers, `ACAO: *`) and contrast. All four
simulated toys are retired; Reaction is kept with fixes. Stacker's two publication risks (LAI Games *Stacker*
name/trade dress, simulated money framing) need an owner call before M3; recommendation is rename + plain scores.
T-M0-01 passed (rerun medians identical). M0 docs are committed; Lighthouse scripts live in the session scratchpad only.
