// Shared copy for the two M1.1 Clean-zine prototypes (/proto/a/, /proto/b/).
// Dev-only: these pages are never built for production (see src/pages/proto/[variant].astro).
// Only items the plan already commits to appear here: no invented dates, counts or projects.
// Tabs and Projects have zero published items, so (per PLAN §1.3) they get no shelf.

export interface ShelfItem {
  title: string;
  blurb: string;
  meta: string;
  href: string;
}

export interface ChessLine {
  name: string;
  side: "White" | "Black";
  moves: string;
}

export const hello = "Games, experiments and chess lines I keep coming back to.";

export const arcade: ShelfItem[] = [
  {
    title: "Stacker",
    blurb: "Stop the sliding row in time and stack it to the top. Miss and the stack gets narrower.",
    meta: "Keyboard · touch",
    href: "#arcade",
  },
  {
    title: "Reaction",
    blurb: "Wait for the signal, then press. Five rounds, false starts don't count.",
    meta: "Keyboard · pointer",
    href: "#arcade",
  },
];

export const lab: ShelfItem[] = [
  {
    title: "look-above",
    blurb: "A local-first flight radar built on public ADS-B feeds, with a hard privacy line.",
    meta: "Experiment",
    href: "#lab",
  },
  {
    title: "global_unrest",
    blurb: "Media attention kept separate from verified events, with scoring you can inspect.",
    meta: "Experiment",
    href: "#lab",
  },
];

export const chess: ChessLine[] = [
  { name: "Italian Game", side: "White", moves: "1.e4 e5 2.Nf3 Nc6 3.Bc4" },
  { name: "Giuoco Piano", side: "White", moves: "1.e4 e5 2.Nf3 Nc6 3.Bc4 Bc5" },
  { name: "London System", side: "White", moves: "1.d4 d5 2.Bf4" },
  { name: "Vienna Gambit", side: "White", moves: "1.e4 e5 2.Nc3 Nf6 3.f4" },
  { name: "Berlin Defence", side: "Black", moves: "1.e4 e5 2.Nf3 Nc6 3.Bb5 Nf6" },
  { name: "Accelerated Dragon", side: "Black", moves: "1.e4 c5 2.Nf3 Nc6 3.d4 cxd4 4.Nxd4 g6" },
];

export const githubUrl = "https://github.com/arcTanMyAngle";
