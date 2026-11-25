import type { GameEntry } from "../content/types.generated";

/** What every mounted player hands back: the toy/island contract. */
export interface Mounted {
  destroy(): void;
}

/** A way to play a published `game` entry (PLAN §3.1 / §3.3). One adapter per `GameEntry.adapter` value. */
export interface PlayerAdapter {
  kind: GameEntry["adapter"];
  mount(root: HTMLElement, entry: GameEntry): Promise<Mounted>;
}

/** The first-party modules a `site-module` entry may name (the schema's `module` enum). */
export type SiteModuleId = NonNullable<GameEntry["module"]>;
