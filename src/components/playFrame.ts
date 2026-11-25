// Play frame: a hosted game from origin G, started on demand inside a sandboxed iframe (PLAN §3.1).
// Contract: mount(root, { origin }) => { destroy() }. `root` holds [data-stage] (where the frame goes), [data-poster]
// with the [data-play] button, [data-loading], [data-fail] with [data-retry], and the [data-fullscreen] / [data-exit]
// controls. root.dataset.src is the game URL.
//
// Nothing from G loads until Play. After that the frame must say `ready` (play/v1) within READY_MS, or the page
// shows the failure panel. Only messages from the frame's own window and from G's exact origin are trusted.

import { isPlayMessage } from "../lib/players/playV1";

const READY_MS = 10_000;
// Some embedded browsers leave a fullscreen request pending forever; after this long the frame is pinned instead.
const FS_WAIT_MS = 800;
const SANDBOX = "allow-scripts allow-same-origin allow-pointer-lock";

type State = "idle" | "loading" | "playing" | "failed";

export function mount(root: HTMLElement, options: { origin: string }) {
  const origin = options.origin.replace(/\/+$/, "");
  const src = root.dataset.src!;
  const title = root.dataset.title ?? "Game";
  const stage = root.querySelector<HTMLElement>("[data-stage]")!;
  const poster = root.querySelector<HTMLElement>("[data-poster]")!;
  const play = root.querySelector<HTMLButtonElement>("[data-play]")!;
  const loading = root.querySelector<HTMLElement>("[data-loading]")!;
  const fail = root.querySelector<HTMLElement>("[data-fail]")!;
  const retry = root.querySelector<HTMLButtonElement>("[data-retry]")!;
  const fullscreen = root.querySelector<HTMLButtonElement>("[data-fullscreen]");
  const exit = root.querySelector<HTMLButtonElement>("[data-exit]");
  const live = root.querySelector<HTMLElement>("[data-live]");

  let state: State = "idle";
  let frame: HTMLIFrameElement | null = null;
  let timer = 0;
  let dropped = 0;

  const say = (t: string) => {
    if (live) live.textContent = t;
  };

  const show = (next: State) => {
    state = next;
    root.dataset.state = next;
    poster.hidden = next !== "idle";
    loading.hidden = next !== "loading";
    fail.hidden = next !== "failed";
    if (exit) exit.hidden = next === "idle";
  };

  const removeFrame = () => {
    window.clearTimeout(timer);
    frame?.remove();
    frame = null;
  };

  const failed = (why: string) => {
    if (state !== "loading") return;
    removeFrame();
    show("failed");
    say(`${title} couldn't start.`);
    console.debug(`[play] ${title}: ${why}`);
    retry.focus();
  };

  const start = () => {
    removeFrame();
    show("loading");
    say(`Loading ${title}…`);
    frame = document.createElement("iframe");
    frame.className = "pf__frame";
    frame.title = title;
    frame.src = src;
    frame.setAttribute("sandbox", SANDBOX);
    frame.setAttribute("allow", "fullscreen; gamepad");
    frame.referrerPolicy = "no-referrer";
    stage.append(frame);
    timer = window.setTimeout(() => failed("no ready message in time"), READY_MS);
  };

  const stop = () => {
    removeFrame();
    if (document.fullscreenElement === stage) void document.exitFullscreen().catch(() => {});
    setPseudo(false);
    show("idle");
    say(`${title} closed.`);
    play.focus();
  };

  const onMessage = (e: MessageEvent) => {
    if (!frame || e.source !== frame.contentWindow || e.origin !== origin || !isPlayMessage(e.data)) {
      // Other frames, extensions and stray windows post here too. Count them, trust none.
      dropped++;
      console.debug(`[play] dropped message #${dropped} from ${e.origin || "unknown origin"}`);
      return;
    }
    const msg = e.data;
    if (msg.type === "ready" && state === "loading") {
      window.clearTimeout(timer);
      show("playing");
      say(`${title} is ready.`);
      frame.focus();
    } else if (msg.type === "error") {
      if (state === "loading") failed(`error before ready: ${String(msg.detail ?? "").slice(0, 200)}`);
      else console.debug(`[play] ${title} reported: ${String(msg.detail ?? "").slice(0, 200)}`);
    } else if (msg.type === "exit") {
      stop();
    }
  };

  // Tell the game when the tab hides; a game may ignore it, the bridge just relays it.
  const onVisibility = () => {
    if (state !== "playing" || !frame?.contentWindow) return;
    frame.contentWindow.postMessage({ v: 1, type: document.hidden ? "pause" : "resume" }, origin);
  };

  // iPhone Safari has no Fullscreen API for anything but video. There the frame and its bar are pinned over the
  // whole screen instead ("pseudo" fullscreen), and Exit fullscreen or Escape puts them back.
  const native = typeof stage.requestFullscreen === "function" && document.fullscreenEnabled;
  let pseudo = false;
  const setLabel = (on: boolean) => {
    if (!fullscreen) return;
    fullscreen.setAttribute("aria-pressed", String(on));
    const label = fullscreen.querySelector("[data-fs-label]");
    if (label) label.textContent = on ? "Exit fullscreen" : "Fullscreen";
  };
  const setPseudo = (on: boolean) => {
    if (pseudo === on) return;
    pseudo = on;
    if (on) root.setAttribute("data-pseudo-fs", "");
    else root.removeAttribute("data-pseudo-fs");
    document.documentElement.classList.toggle("pf-locked", on);
    setLabel(on);
    frame?.focus();
  };
  let fsWait = 0;
  const onFullscreenClick = () => {
    window.clearTimeout(fsWait);
    if (pseudo) setPseudo(false);
    else if (!native) setPseudo(true);
    else if (document.fullscreenElement === stage) void document.exitFullscreen().catch(() => {});
    else {
      fsWait = window.setTimeout(() => {
        if (document.fullscreenElement !== stage) setPseudo(true);
      }, FS_WAIT_MS);
      void stage.requestFullscreen().catch(() => {
        window.clearTimeout(fsWait);
        setPseudo(true);
      });
    }
  };
  const onFullscreenChange = () => {
    const on = document.fullscreenElement === stage;
    // A request that was given up on can still land late; the real thing wins.
    if (on) setPseudo(false);
    setLabel(on);
    if (!on) frame?.focus();
  };
  const onKey = (e: KeyboardEvent) => {
    if (e.key === "Escape" && pseudo) setPseudo(false);
  };

  if (fullscreen) {
    fullscreen.hidden = false;
    fullscreen.addEventListener("click", onFullscreenClick);
  }
  play.addEventListener("click", start);
  retry.addEventListener("click", start);
  exit?.addEventListener("click", stop);
  window.addEventListener("message", onMessage);
  document.addEventListener("visibilitychange", onVisibility);
  document.addEventListener("fullscreenchange", onFullscreenChange);
  document.addEventListener("keydown", onKey);
  play.disabled = false;
  show("idle");

  return {
    destroy() {
      removeFrame();
      play.removeEventListener("click", start);
      retry.removeEventListener("click", start);
      exit?.removeEventListener("click", stop);
      fullscreen?.removeEventListener("click", onFullscreenClick);
      window.removeEventListener("message", onMessage);
      document.removeEventListener("visibilitychange", onVisibility);
      document.removeEventListener("fullscreenchange", onFullscreenChange);
      document.removeEventListener("keydown", onKey);
      window.clearTimeout(fsWait);
      setPseudo(false);
    },
  };
}
