/**
 * Content validation (PLAN §3.3): the JSON Schema check plus the rules a schema can't hold. Used by
 * scripts/snapshot-content.mjs on every fetched row and by tests/contracts.test.mjs; the M2 publish RPC applies the
 * same rules server side. Build/test only: pages read the snapshot through ./index.ts and never import this.
 */
import Ajv2020 from "ajv/dist/2020";
import addFormats from "ajv-formats";
import { Chess } from "chess.js";
import about from "../../../contracts/about.schema.json";
import allowedEmbedHosts from "../../../contracts/allowed-embed-hosts.json";
import game from "../../../contracts/game.schema.json";
import lab from "../../../contracts/lab.schema.json";
import opening from "../../../contracts/opening.schema.json";
import playV1 from "../../../contracts/play-v1.schema.json";
import project from "../../../contracts/project.schema.json";
import tab from "../../../contracts/tab.schema.json";
import manifest from "../../../play/games-manifest.json";
import { isSafeUrl } from "./url";

export const KINDS = ["game", "lab", "project", "opening", "tab", "about"] as const;
export type Kind = (typeof KINDS)[number];

export const SCHEMAS = { game, lab, project, opening, tab, about } as const;

export interface ValidateContext {
  /** Bundle slugs origin G serves (play/games-manifest.json). */
  bundles: readonly string[];
  /** Hosts an `embed` game may use (contracts/allowed-embed-hosts.json). */
  embedHosts: readonly string[];
}

export const defaultContext: ValidateContext = {
  bundles: manifest.games.map((g) => g.slug),
  embedHosts: allowedEmbedHosts.hosts,
};

// strictRequired is off: the adapter oneOf branches `require` properties declared at the top level, which ajv only
// finds when they are declared in the same subschema.
const ajv = new Ajv2020({ allErrors: true, strict: true, strictTypes: false, strictRequired: false });
addFormats(ajv);
const validators = Object.fromEntries(KINDS.map((k) => [k, ajv.compile(SCHEMAS[k])])) as Record<
  Kind,
  ReturnType<typeof ajv.compile>
>;
const playValidator = ajv.compile(playV1);

export function isKind(k: unknown): k is Kind {
  return typeof k === "string" && (KINDS as readonly string[]).includes(k);
}

/** Every string under a URL-bearing key, with its path, anywhere in the entry. */
const URL_KEYS = new Set(["url", "runUrl", "sourceUrl", "poster"]);
function urls(value: unknown, path = ""): [string, unknown][] {
  if (Array.isArray(value)) return value.flatMap((v, i) => urls(v, `${path}[${i}]`));
  if (!value || typeof value !== "object") return [];
  return Object.entries(value).flatMap(([k, v]) => {
    const p = path ? `${path}.${k}` : k;
    return URL_KEYS.has(k) ? [[p, v] as [string, unknown]] : urls(v, p);
  });
}

/** Replays PGN movetext; returns an error message or null. An empty game counts as an error. */
export function pgnError(pgn: string): string | null {
  const chess = new Chess();
  try {
    chess.loadPgn(pgn, { strict: false });
  } catch (e) {
    return e instanceof Error ? e.message : String(e);
  }
  return chess.history().length === 0 ? "no moves" : null;
}

/** All problems with `data` as a `kind` entry; an empty list means it may be published. */
export function validateEntry(kind: Kind, data: unknown, ctx: ValidateContext = defaultContext): string[] {
  const validate = validators[kind];
  if (!validate(data)) {
    return (validate.errors ?? []).map((e) => `${kind}${e.instancePath || ""}: ${e.message ?? "invalid"}`);
  }
  const errors: string[] = [];
  const entry = data as Record<string, unknown>;

  for (const [path, value] of urls(entry)) {
    if (!isSafeUrl(value)) errors.push(`${kind}.${path}: not a safe https URL`);
  }

  if ((kind === "game" && entry.adapter === "bundle") || kind === "lab") {
    const bundle = entry.bundle as string;
    if (!ctx.bundles.includes(bundle)) errors.push(`${kind}.bundle: "${bundle}" is not in play/games-manifest.json`);
  }
  if (kind === "game" && entry.adapter === "embed" && isSafeUrl(entry.url)) {
    if (!isSafeUrl(entry.url, { allowHosts: ctx.embedHosts })) {
      errors.push(`game.url: host is not in contracts/allowed-embed-hosts.json`);
    }
  }
  if (kind === "opening") {
    const variations = entry.variations as { name: string; pgn: string }[];
    variations.forEach((v, i) => {
      const err = pgnError(v.pgn);
      if (err) errors.push(`opening.variations[${i}].pgn: ${err}`);
    });
  }
  return errors;
}

/** True when `data` is a play/v1 message (either direction). */
export function isPlayV1(data: unknown): boolean {
  return playValidator(data) as boolean;
}
