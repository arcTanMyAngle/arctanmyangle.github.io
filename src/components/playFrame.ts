// Play frame: a hosted game from origin G, started on demand inside a sandboxed iframe (PLAN §3.1).
// Contract: mount(root, { origin }) => { destroy() }. `root` holds [data-stage] (where the frame goes), [data-poster]
// with the [data-play] button, [data-loading], [data-fail] with [data-retry], and the [data-fullscreen] / [data-exit]
// controls. root.dataset.src is the game URL.
//
// Nothing from G loads until Play. After that the frame must say `ready` (play/v1) within READY_MS, or the page
// shows the failure panel. Only messages from the frame's own window and from G's exact origin are trusted.

const READY_MS = 10_000;
const SANDBOX = "allow-scripts allow-same-origin allow-pointer-lock";

type State = "idle" | "loading" | "playing" | "failed";
type Msg = { v: 1; type: "ready" | "error" | "exit"; detail?: unknown };

function isMsg(d: unknown): d is Msg {
  if (!d || typeof d !== "object") return false;
  const m = d as Record<string, unknown>;
  return m.v === 1 && (m.type === "ready" || m.type === "error" || m.type === "exit");
}

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
    show("idle");
    say(`${title} closed.`);
    play.focus();
  };

  const onMessage = (e: MessageEvent) => {
    if (!frame || e.source !== frame.contentWindow || e.origin !== origin || !isMsg(e.data)) {
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

  const canFullscreen = typeof stage.requestFullscreen === "function" && document.fullscreenEnabled;
  const onFullscreenClick = () => {
    if (document.fullscreenElement === stage) void document.exitFullscreen().catch(() => {});
    else void stage.requestFullscreen().catch(() => {});
  };
  const onFullscreenChange = () => {
    if (!fullscreen) return;
    const on = document.fullscreenElement === stage;
    fullscreen.setAttribute("aria-pressed", String(on));
    const label = fullscreen.querySelector("[data-fs-label]");
    if (label) label.textContent = on ? "Exit fullscreen" : "Fullscreen";
    if (!on) frame?.focus();
  };

  if (fullscreen) {
    fullscreen.hidden = !canFullscreen;
    fullscreen.addEventListener("click", onFullscreenClick);
  }
  play.addEventListener("click", start);
  retry.addEventListener("click", start);
  exit?.addEventListener("click", stop);
  window.addEventListener("message", onMessage);
  document.addEventListener("visibilitychange", onVisibility);
  document.addEventListener("fullscreenchange", onFullscreenChange);
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
    },
  };
}
