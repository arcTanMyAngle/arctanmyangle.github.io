/* Machine-written by scripts/gen-contract-types.mjs from contracts/*.schema.json. Do not hand-edit:
 * change the schema, then run `bun run gen:contracts`. */

/**
 * A game on /arcade/ (PLAN §3.3). `bundle` names a game in play/games-manifest.json (origin G); `site-module` names a first-party module in src/lib/players/registry.ts; `embed` is an https URL whose host is in contracts/allowed-embed-hosts.json.
 */
export type GameEntry = {
  slug: Slug;
  title: Title;
  blurb: Blurb;
  adapter: "bundle" | "site-module" | "embed";
  bundle?: Slug;
  module?: "stacker" | "reaction" | "iron-line" | "monolith" | "lane-rush";
  url?: HttpsUrl;
  /**
   * @maxItems 8
   */
  controls?: string[];
  devices?: ("desktop" | "phone" | "tablet")[];
  credit?: string;
  license?: string;
  sourceUrl?: HttpsUrl;
  poster?: HttpsUrl;
  phoneNote?: string;
} & (
  | {
      adapter?: "bundle";
    }
  | {
      adapter?: "site-module";
    }
  | {
      adapter?: "embed";
    }
);

export type Slug = string;

export type Title = string;

export type Blurb = string;

export type HttpsUrl = string;

export type IsoDate = string;

/**
 * An experiment on /lab/ (PLAN §3.3): played like a `bundle` game from origin G, marked as an experiment, with the date it last changed.
 */
export interface LabEntry {
  slug: Slug;
  title: Title;
  blurb: Blurb;
  bundle: Slug;
  experiment: true;
  updatedAt: IsoDate;
  language?: string;
  sourceUrl?: HttpsUrl;
  poster?: HttpsUrl;
}

/**
 * A project on /projects/ (PLAN §3.3): something you can run (`runUrl`) or look at (`outputs`), with an optional source link. A source link on its own is not a project entry.
 */
export interface ProjectEntry {
  slug: Slug;
  title: Title;
  blurb: Blurb;
  runUrl?: HttpsUrl;
  /**
   * @minItems 1
   * @maxItems 12
   */
  outputs?: [ProjectOutput, ...ProjectOutput[]];
  sourceUrl?: HttpsUrl;
  /**
   * @maxItems 8
   */
  tags?: string[];
}

export interface ProjectOutput {
  type: "image" | "video";
  url: HttpsUrl;
  alt: string;
}

/**
 * A chess opening on /chess/ (PLAN §3.3). Each variation is PGN movetext; src/lib/content/validate.ts replays it with chess.js, at publish and at build.
 */
export interface OpeningEntry {
  slug: Slug;
  name: Title;
  side: "White" | "Black";
  idea?: Blurb;
  /**
   * @minItems 1
   * @maxItems 12
   */
  variations: [OpeningVariation, ...OpeningVariation[]];
}

export interface OpeningVariation {
  name: Title;
  pgn: string;
  note?: Blurb;
}

/**
 * A guitar tab on /tabs/ (PLAN §3.3): plain text, with its tuning and where the right to publish it comes from.
 */
export interface TabEntry {
  slug: Slug;
  title: Title;
  artist?: string;
  tuning: string;
  capo?: number;
  text: string;
  /**
   * own: written by the owner; permission: the author said yes; public-domain; licensed: under the licence named in `credit`.
   */
  rights: "own" | "permission" | "public-domain" | "licensed";
  credit?: string;
  sourceUrl?: HttpsUrl;
}

/**
 * The single /about/ row (PLAN §3.3). Its slug is always `about`.
 */
export interface AboutEntry {
  slug: "about";
  headline: Title;
  /**
   * Paragraphs of plain text.
   *
   * @minItems 1
   * @maxItems 12
   */
  body: [string, ...string[]];
  /**
   * @maxItems 12
   */
  links?: AboutLink[];
}

export interface AboutLink {
  label: string;
  url: HttpsUrl;
}

/**
 * play/v1 (PLAN §3.1): the postMessage contract between a game page on origin G and the play frame on origin A. Up: G to A. Down: A to G. Receivers also check the sender's origin and window.
 */
export type PlayV1 = PlayUpMessage | PlayDownMessage;

export interface PlayUpMessage {
  v: 1;
  type: "ready" | "error" | "exit";
  detail?: unknown;
}

export interface PlayDownMessage {
  v: 1;
  type: "pause" | "resume";
}
