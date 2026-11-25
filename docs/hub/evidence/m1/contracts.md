# M1 contracts, content snapshot and player adapters (PLAN §3.1, §3.3, §3.4)

Built 2026-11-25 on top of 5abf799. Decisions: D-10 (static snapshot), D-23 (schema format and URL rule).

## What exists

- **Contracts:** `contracts/*.schema.json`, JSON Schema 2020-12.
  - One schema per published kind: `game`, `lab`, `project`, `opening`, `tab` and `about`.
  - `common.schema.json` holds the shared `$defs`: slug, title, blurb, httpsUrl and isoDate.
  - `play-v1.schema.json` covers the G iframe messages: up = ready/error/exit, down = pause/resume.
  - `allowed-embed-hosts.json` is the embed allowlist. It starts empty, so no `embed` game validates yet.
- **Rules beyond shape:** `src/lib/content/validate.ts` runs ajv and then:
  - every URL goes through `isSafeUrl` (`url.ts`);
  - a `bundle` must be in `play/games-manifest.json`;
  - an `embed` host must be on the allowlist;
  - opening PGNs must replay in chess.js;
  - a lab entry needs a shipped bundle.
- **Types:** `bun run gen:contracts` writes `src/lib/content/types.generated.ts`. A test regenerates it in memory and
  fails when the committed file is stale.
- **Snapshot:**
  - `bun run snapshot:content` (`scripts/snapshot-content.mjs`) reads PostgREST `published`.
  - Every row must pass its kind's contract, with the slug matching, no duplicates, an integer `sort_order` and a
    parseable `published_at`. One bad row rejects the whole snapshot.
  - It writes `src/data/published.snapshot.json`, sorted by kind, then `sort_order`, then slug.
  - With no env vars, or on any error, it keeps the committed file and exits 0. The committed file is the empty
    `{ "version": 1, "items": [] }`.
  - CI runs it before Build with the `SUPABASE_URL` / `SUPABASE_ANON_KEY` secrets. Neither secret exists yet, so the
    step does nothing.
- **Loader:** `src/lib/content/index.ts` provides `published(kind)`, `publishedBySlug(kind, slug)` and
  `hasPublished(kind)`. No page uses it yet: nothing is published, and empty sections stay hidden.
- **Players:**
  - `src/lib/players/playV1.ts`: the message types and guards. `playFrame.ts` now imports them, with no change in
    behaviour.
  - `types.ts`: the `PlayerAdapter` interface (`mount(root, entry) → { destroy() }`).
  - `registry.ts`, with three adapters:
    - `site-module`: lazy imports of stacker, reaction, iron-line, monolith and lane-rush;
    - `bundle`: delegates to `playFrame`;
    - `embed`: a new-tab launch link.
  - Existing pages keep their direct imports. The registry is for M2's published `game` entries.

## Tests

`tests/contracts.test.mjs` and `tests/content.test.mjs` run 70 tests, all passing; `bun test` has 194 in total.

- **Schemas:**
  - Every schema compiles under strict ajv.
  - Each schema's copy of the shared `$defs` equals `common.schema.json`.
  - The generated types are fresh.
  - The registry's module ids equal the schema enum.
- **`isSafeUrl`:**
  - Rejected: `http:`, `javascript:`, `data:` and uppercase `HTTPS:`, plus credentials, IPv4/IPv6 literals and
    `xn--` labels.
  - The allowlist matches exact hosts, and `*.` means subdomains only.
- **Contracts:**
  - Adapters are mutually exclusive.
  - An unlisted bundle or embed host fails.
  - A source-link-only project fails.
  - A PGN that doesn't replay fails.
  - A lab entry without `experiment: true` fails.
- **Today's hand-written data validates:**
  - `hostedGames` as bundle games;
  - the first-party games as site-module games;
  - the chess lines as openings;
  - the linked-game URLs as safe URLs.
- **play/v1:** the guards agree with the schema, and up and down messages don't overlap.
- **Snapshot:**
  - The committed file is the empty v1.
  - Valid rows sort the same in either input order.
  - Each bad-row case rejects the whole snapshot: unknown kind, contract break, source-only project, unsafe URL, slug
    mismatch, missing `sort_order`, bad date, null row, duplicate, or a non-array response.
- A run with no env vars printed a warning, left the file unchanged and exited 0.

## Not done here (M2)

- The SQL-side mirror of `isSafeUrl` and the contracts. `pg_jsonschema` can't follow cross-file `$ref`, which is
  why each schema carries its own `$defs` copy.
- The admin UI that writes rows.
- A publish trigger (`repository_dispatch`, D-19).
