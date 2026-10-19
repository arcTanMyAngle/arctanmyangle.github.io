// Site map, section hues and shared copy (the pro-modern design, D-14).
// Every internal link goes through `href()`, so a base path (if the site ever needs one) is a one-line change.
// Only facts the owner gave or the plan commits to appear here: no invented counts, dates or results.

export const BASE = "";

export function href(path = ""): string {
  const clean = path.replace(/^\/+|\/+$/g, "");
  return clean ? `${BASE}/${clean}/` : `${BASE}/`;
}

export type Section = "home" | "arcade" | "chess" | "lab" | "tabs" | "skate" | "projects" | "about";

export interface NavItem {
  section: Section;
  label: string;
  path: string;
}

export const nav: NavItem[] = [
  { section: "arcade", label: "Arcade", path: "arcade" },
  { section: "chess", label: "Chess", path: "chess" },
  { section: "lab", label: "Lab", path: "lab" },
  { section: "tabs", label: "Tabs", path: "tabs" },
  { section: "skate", label: "Skate", path: "skate" },
  { section: "about", label: "About", path: "about" },
];

export const githubUrl = "https://github.com/arcTanMyAngle";

export interface Game {
  slug: string;
  title: string;
  blurb: string;
  controls: string;
}

export const games: Game[] = [
  {
    slug: "stacker",
    title: "Stacker",
    blurb: "Stop the sliding row in time and build to the top. Miss, and the row gets narrower.",
    controls: "Space · tap",
  },
  {
    slug: "reaction",
    title: "Reaction",
    blurb: "Wait for the signal, then hit it. Five rounds, and false starts don't count.",
    controls: "Space · tap",
  },
];

export interface Experiment {
  slug: string;
  title: string;
  blurb: string;
  language: string;
  source: string;
}

// Language comes from the committed GitHub snapshot (src/data/github-repos.generated.json).
export const experiments: Experiment[] = [
  {
    slug: "look-above",
    title: "look-above",
    blurb: "A local-first flight radar built on public ADS-B feeds, with a hard privacy line.",
    language: "Rust",
    source: `${githubUrl}/look-above`,
  },
  {
    slug: "global_unrest",
    title: "global_unrest",
    blurb: "Media attention kept separate from verified events, with scoring you can inspect.",
    language: "Rust",
    source: `${githubUrl}/global_unrest`,
  },
];

export interface ChessLine {
  slug: string;
  name: string;
  side: "White" | "Black";
  /** SAN, space-separated, no move numbers. */
  moves: string[];
  idea: string;
}

export const chessLines: ChessLine[] = [
  {
    slug: "italian",
    name: "Italian Game",
    side: "White",
    moves: ["e4", "e5", "Nf3", "Nc6", "Bc4"],
    idea: "The bishop goes straight at f7, the softest square in Black's camp.",
  },
  {
    slug: "giuoco-piano",
    name: "Giuoco Piano",
    side: "White",
    moves: ["e4", "e5", "Nf3", "Nc6", "Bc4", "Bc5"],
    idea: "Black mirrors the bishop. A quiet centre, and a long game ahead.",
  },
  {
    slug: "london",
    name: "London System",
    side: "White",
    moves: ["d4", "d5", "Bf4"],
    idea: "The bishop comes out before e3 locks it in. Same setup, almost every game.",
  },
  {
    slug: "vienna-gambit",
    name: "Vienna Gambit",
    side: "White",
    moves: ["e4", "e5", "Nc3", "Nf6", "f4"],
    idea: "The knight covers e4, then the f-pawn hits e5 straight away.",
  },
  {
    slug: "berlin",
    name: "Berlin Defence",
    side: "Black",
    moves: ["e4", "e5", "Nf3", "Nc6", "Bb5", "Nf6"],
    idea: "Ignore the pin and counter-attack e4. Solid enough to be called a wall.",
  },
  {
    slug: "accelerated-dragon",
    name: "Accelerated Dragon",
    side: "Black",
    moves: ["e4", "c5", "Nf3", "Nc6", "d4", "cxd4", "Nxd4", "g6"],
    idea: "The bishop goes to g7 before d6, which keeps ...d5 in one move.",
  },
];

/** "1.e4 e5 2.Nf3 Nc6" from a flat SAN list. */
export function numbered(moves: string[]): string {
  return moves.map((m, i) => (i % 2 === 0 ? `${i / 2 + 1}.${m}` : m)).join(" ");
}

export const interests = [
  { section: "arcade", title: "Games", text: "Small arcade games that are fair, quick and work on a phone." },
  { section: "chess", title: "Chess", text: "Italian, Vienna and London with White; Berlin and Dragon with Black." },
  { section: "tabs", title: "Guitar", text: "Tabs you can follow along with, one bar at a time." },
  { section: "skate", title: "Skateboarding", text: "Which is where the skate sim comes from." },
  { section: "lab", title: "Data & maps", text: "Flight radar, event maps, things you can poke at." },
  { section: "projects", title: "Code", text: "Rust, TypeScript and whatever the project needs." },
] as const;
