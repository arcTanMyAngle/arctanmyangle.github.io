// Player registry (PLAN §3.1): one adapter per `GameEntry.adapter`. Published `game` entries (M2+) are played through
// here; today's hand-built pages still import their toy directly. Everything is a lazy import, so a page only loads
// the player it uses.
import { PLAY_ORIGIN, playUrl } from "../../data/play";
import type { GameEntry } from "../content/types.generated";
import type { Mounted, PlayerAdapter, SiteModuleId } from "./types";

type ModuleLoader = () => Promise<{ mount(root: HTMLElement): Mounted }>;

/** First-party games a `site-module` entry may name. Keys must equal the `module` enum in contracts/game.schema.json. */
export const siteModules: Record<SiteModuleId, ModuleLoader> = {
  stacker: () => import("../../components/stacker"),
  reaction: () => import("../../components/reaction"),
  "iron-line": () => import("../../components/ironLine"),
  monolith: () => import("../../components/monolith"),
  "lane-rush": () => import("../../components/laneRush"),
};

/** A game from origin G in the sandboxed play frame. `root` carries the GameFrame markup playFrame.ts expects. */
const bundle: PlayerAdapter = {
  kind: "bundle",
  async mount(root, entry) {
    if (!entry.bundle) throw new Error(`game ${entry.slug}: bundle adapter without a bundle`);
    root.dataset.src ??= playUrl(entry.bundle);
    root.dataset.title ??= entry.title;
    const { mount } = await import("../../components/playFrame");
    return mount(root, { origin: PLAY_ORIGIN });
  },
};

const siteModule: PlayerAdapter = {
  kind: "site-module",
  async mount(root, entry) {
    const load = entry.module && siteModules[entry.module];
    if (!load) throw new Error(`game ${entry.slug}: unknown site module "${entry.module}"`);
    return (await load()).mount(root);
  },
};

/** Third-party games open in a new tab: no framing on origin A (framing checks happen at publish, M2). */
const embed: PlayerAdapter = {
  kind: "embed",
  async mount(root, entry) {
    if (!entry.url) throw new Error(`game ${entry.slug}: embed adapter without a url`);
    const a = document.createElement("a");
    a.className = "btn btn--primary";
    a.href = entry.url;
    a.target = "_blank";
    a.rel = "noopener noreferrer";
    a.textContent = `Play ${entry.title} — opens in new tab ↗`;
    root.append(a);
    return { destroy: () => a.remove() };
  },
};

export const adapters: Record<GameEntry["adapter"], PlayerAdapter> = { bundle, "site-module": siteModule, embed };

export function mountGame(root: HTMLElement, entry: GameEntry): Promise<Mounted> {
  return adapters[entry.adapter].mount(root, entry);
}
