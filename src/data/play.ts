// Games hosted on origin G (arctanmyangle-play.pages.dev) and played here through a sandboxed frame (PLAN §3.1).
// The game files live in play/g/<slug>/ and deploy as their own Pages project, so their scripts never run on this
// origin. Credits and licences come from each project's own repository (play/games-manifest.json pins the commits).

export const PLAY_ORIGIN: string = import.meta.env.PUBLIC_PLAY_ORIGIN || "https://arctanmyangle-play.pages.dev";

export interface HostedGame {
  slug: string;
  title: string;
  blurb: string;
  controls: string;
  /** What to press, shown in the side panel. */
  howto: { key: string; text: string }[];
  credit: string;
  license: string;
  source: string;
  /** Short note for the side panel when the game is awkward on a phone. */
  phoneNote?: string;
}

export const hostedGames: HostedGame[] = [
  {
    slug: "2048",
    title: "2048",
    blurb: "Slide the tiles, merge the matching numbers, and try to reach 2048 before the board fills up.",
    controls: "Arrows · swipe",
    howto: [
      { key: "←↑→↓", text: "Slide every tile that way. Matching tiles merge." },
      { key: "Swipe", text: "On a phone, swipe on the board." },
    ],
    credit: "Gabriele Cirulli",
    license: "MIT",
    source: "https://github.com/gabrielecirulli/2048",
  },
  {
    slug: "hextris",
    title: "Hextris",
    blurb: "Blocks fall towards a spinning hexagon. Turn it so three of a colour line up and clear.",
    controls: "Arrows · tap",
    howto: [
      { key: "← →", text: "Rotate the hexagon." },
      { key: "Tap", text: "On a phone, tap the left or right half of the screen." },
      { key: "P", text: "Pause." },
    ],
    credit: "Logan Engstrom, Garrett Finucane, Noah Moroze and Michael Yang",
    license: "GPL-3.0",
    source: "https://github.com/Hextris/hextris",
  },
  {
    slug: "a-dark-room",
    title: "A Dark Room",
    blurb: "A text adventure that starts with a cold room and a fire. It grows from there. Slow, and worth it.",
    controls: "Click · tap",
    howto: [
      { key: "Click", text: "Press the buttons. That's the whole interface, at first." },
      { key: "Save", text: "Progress saves in this browser as you play." },
    ],
    credit: "Doublespeak Games and contributors",
    license: "MPL-2.0",
    source: "https://github.com/doublespeakgames/adarkroom",
    phoneNote: "Built for a wide screen. On a phone, turn it sideways or use Open in new tab.",
  },
];

/** Linked out, not hosted: the game stays on its publisher's site. */
export interface LinkedGame {
  title: string;
  blurb: string;
  controls: string;
  url: string;
  host: string;
}

export const linkedGames: LinkedGame[] = [
  {
    title: "Subway Surfers",
    blurb: "Run the tracks, dodge the trains, grab the coins. Plays on Poki, with Poki's ads.",
    controls: "Arrows · swipe",
    url: "https://poki.com/en/g/subway-surfers",
    host: "poki.com",
  },
];

export function playUrl(slug: string): string {
  return `${PLAY_ORIGIN.replace(/\/+$/, "")}/g/${slug}/`;
}
