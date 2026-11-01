// Shared chrome for the canvas games (Lane Rush, Monolith, Iron Line), rendered by CanvasGame.astro.
// Contract: createShell(root, { onMain, onPause }) wires the overlay's [data-act="main"] button, the [data-pause],
// [data-fullscreen], [data-sound] and [data-share] buttons, and the [data-live] line. The game owns its state; the
// shell only calls onPause() when play should stop (Pause, Escape/P, hidden tab, window blur) and onMain() for the
// overlay button. Fullscreen covers the whole card (canvas + touch controls); browsers that never settle
// requestFullscreen (or have none, like iPhone Safari) get the card pinned over the page instead.

import { STORAGE_KEYS } from "./clientState";
import { setMuted } from "./sfx";

const FS_WAIT_MS = 800;

export interface ShellOptions {
  onMain(): void;
  onPause(): void;
}

export interface Shell {
  /** Show the overlay. `label` is the main button's text; `share` turns on the share button with that text. */
  show(o: { kicker?: string; title: string; msg?: string; label: string; share?: string }): void;
  hide(): void;
  say(text: string): void;
  /** Mark the game as running: the Pause button shows and keys that scroll the page are held back. */
  setRunning(on: boolean): void;
  destroy(): void;
}

function soundStored(): boolean {
  try {
    return window.localStorage.getItem(STORAGE_KEYS.gameSound) !== "off";
  } catch {
    return true;
  }
}

export function createShell(root: HTMLElement, options: ShellOptions): Shell {
  const q = <T extends HTMLElement>(s: string) => root.querySelector<T>(s);
  const overlay = q<HTMLElement>("[data-overlay]")!;
  const kicker = q<HTMLElement>("[data-ov-kicker]");
  const title = q<HTMLElement>("[data-ov-title]")!;
  const msg = q<HTMLElement>("[data-ov-msg]")!;
  const main = q<HTMLButtonElement>('[data-act="main"]')!;
  const pauseBtn = q<HTMLButtonElement>("[data-pause]");
  const fsBtn = q<HTMLButtonElement>("[data-fullscreen]");
  const soundBtn = q<HTMLButtonElement>("[data-sound]");
  const shareBtn = q<HTMLButtonElement>("[data-share]");
  const live = q<HTMLElement>("[data-live]");

  let running = false;
  let shareText = "";

  const say = (t: string) => {
    if (live) live.textContent = t;
  };

  const show: Shell["show"] = (o) => {
    if (kicker) {
      kicker.textContent = o.kicker ?? "";
      kicker.hidden = !o.kicker;
    }
    title.textContent = o.title;
    msg.textContent = o.msg ?? "";
    msg.hidden = !o.msg;
    main.textContent = o.label;
    shareText = o.share ?? "";
    if (shareBtn) shareBtn.hidden = !shareText;
    overlay.hidden = false;
    say(`${o.title}. ${o.msg ?? ""}`);
    // Don't pull focus out of the page on first load; do it once a game is under way.
    if (root.contains(document.activeElement) || document.activeElement === document.body) main.focus({ preventScroll: true });
  };

  const hide = () => {
    overlay.hidden = true;
    root.focus({ preventScroll: true });
  };

  const setRunning = (on: boolean) => {
    running = on;
    root.dataset.state = on ? "running" : "menu";
    if (pauseBtn) pauseBtn.hidden = !on;
  };

  // --- Sound toggle ---
  let sound = soundStored();
  const paintSound = () => {
    setMuted(!sound);
    if (!soundBtn) return;
    soundBtn.setAttribute("aria-pressed", String(sound));
    soundBtn.textContent = sound ? "Sound on" : "Sound off";
  };
  const onSound = () => {
    sound = !sound;
    try {
      window.localStorage.setItem(STORAGE_KEYS.gameSound, sound ? "on" : "off");
    } catch {
      // Storage unavailable: the choice lasts for this page only.
    }
    paintSound();
  };
  paintSound();

  // --- Share (Web Share where there is one, else copy) ---
  const onShare = async () => {
    const url = window.location.href.split("#")[0];
    try {
      if (navigator.share) await navigator.share({ text: shareText, url });
      else {
        await navigator.clipboard.writeText(`${shareText} ${url}`);
        say("Copied. Paste it to a friend.");
        if (shareBtn) {
          shareBtn.textContent = "Copied";
          window.setTimeout(() => (shareBtn.textContent = "Share score"), 1600);
        }
      }
    } catch {
      // Share sheet dismissed, or no clipboard permission.
    }
  };

  // --- Fullscreen with a pinned fallback (same approach as playFrame.ts) ---
  const native = typeof root.requestFullscreen === "function" && document.fullscreenEnabled;
  let pseudo = false;
  let fsWait = 0;
  const setLabel = (on: boolean) => {
    if (!fsBtn) return;
    fsBtn.setAttribute("aria-pressed", String(on));
    fsBtn.textContent = on ? "Exit fullscreen" : "Fullscreen";
  };
  const setPseudo = (on: boolean) => {
    if (pseudo === on) return;
    pseudo = on;
    if (on) root.setAttribute("data-pinned", "");
    else root.removeAttribute("data-pinned");
    document.documentElement.classList.toggle("pf-locked", on);
    setLabel(on);
  };
  const onFs = () => {
    window.clearTimeout(fsWait);
    if (pseudo) setPseudo(false);
    else if (!native) setPseudo(true);
    else if (document.fullscreenElement === root) void document.exitFullscreen().catch(() => {});
    else {
      fsWait = window.setTimeout(() => {
        if (document.fullscreenElement !== root) setPseudo(true);
      }, FS_WAIT_MS);
      void root
        .requestFullscreen({ navigationUI: "hide" })
        .then(() => {
          // Landscape suits the side-on games; phones that refuse keep whatever they had.
          const o = screen.orientation as ScreenOrientation & { lock?: (o: string) => Promise<void> };
          if (root.dataset.orient === "landscape") void o.lock?.("landscape").catch(() => {});
        })
        .catch(() => {
          window.clearTimeout(fsWait);
          setPseudo(true);
        });
    }
  };
  const onFsChange = () => {
    const on = document.fullscreenElement === root;
    if (on) setPseudo(false);
    setLabel(on || pseudo);
  };

  // --- Pausing ---
  const SCROLL_KEYS = new Set([" ", "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"]);
  const onKey = (e: KeyboardEvent) => {
    const t = e.target as HTMLElement | null;
    if (t && (t.tagName === "INPUT" || t.tagName === "SELECT" || t.tagName === "TEXTAREA")) return;
    if (e.key === "Escape" && pseudo && !running) {
      setPseudo(false);
      return;
    }
    if (running && (e.key === "Escape" || e.key === "p" || e.key === "P")) {
      e.preventDefault();
      options.onPause();
      return;
    }
    if (running && SCROLL_KEYS.has(e.key)) e.preventDefault();
  };
  const onHidden = () => {
    if (document.hidden && running) options.onPause();
  };
  const onBlur = () => {
    if (running) options.onPause();
  };
  const onPauseClick = () => {
    if (running) options.onPause();
  };
  const onMainClick = () => {
    options.onMain();
    // On a short screen (a phone in landscape) the header can push the view partly off screen; bring all of it in.
    const view = q<HTMLElement>(".cg__view") ?? root;
    const b = view.getBoundingClientRect();
    if (!document.fullscreenElement && !root.hasAttribute("data-pinned") && (b.top < 0 || b.bottom > innerHeight)) {
      view.scrollIntoView({ block: b.height > innerHeight ? "start" : "center", behavior: "auto" });
    }
  };

  main.addEventListener("click", onMainClick);
  pauseBtn?.addEventListener("click", onPauseClick);
  soundBtn?.addEventListener("click", onSound);
  shareBtn?.addEventListener("click", onShare);
  if (fsBtn) {
    fsBtn.hidden = false;
    fsBtn.addEventListener("click", onFs);
  }
  document.addEventListener("keydown", onKey);
  document.addEventListener("visibilitychange", onHidden);
  document.addEventListener("fullscreenchange", onFsChange);
  window.addEventListener("blur", onBlur);
  main.disabled = false;
  root.tabIndex = -1;

  return {
    show,
    hide,
    say,
    setRunning,
    destroy() {
      main.removeEventListener("click", onMainClick);
      pauseBtn?.removeEventListener("click", onPauseClick);
      soundBtn?.removeEventListener("click", onSound);
      shareBtn?.removeEventListener("click", onShare);
      fsBtn?.removeEventListener("click", onFs);
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("visibilitychange", onHidden);
      document.removeEventListener("fullscreenchange", onFsChange);
      window.removeEventListener("blur", onBlur);
      window.clearTimeout(fsWait);
      setPseudo(false);
    },
  };
}

/** Swipe/tap reader for a touch surface. Calls back with the direction of a quick swipe, or "tap". */
export function onSwipe(
  el: HTMLElement,
  cb: (dir: "left" | "right" | "up" | "down" | "tap") => void,
  minPx = 24
): () => void {
  let sx = 0;
  let sy = 0;
  let id: number | null = null;
  let fired = false;
  const down = (e: PointerEvent) => {
    if (e.pointerType === "mouse" || id !== null) return;
    id = e.pointerId;
    sx = e.clientX;
    sy = e.clientY;
    fired = false;
  };
  // Fire mid-gesture, as soon as the finger has travelled far enough: waiting for the lift feels slow.
  const move = (e: PointerEvent) => {
    if (e.pointerId !== id || fired) return;
    const dx = e.clientX - sx;
    const dy = e.clientY - sy;
    if (Math.max(Math.abs(dx), Math.abs(dy)) < minPx) return;
    fired = true;
    if (Math.abs(dx) > Math.abs(dy)) cb(dx > 0 ? "right" : "left");
    else cb(dy > 0 ? "down" : "up");
  };
  const up = (e: PointerEvent) => {
    if (e.pointerId !== id) return;
    if (!fired) cb("tap");
    id = null;
  };
  const cancel = (e: PointerEvent) => {
    if (e.pointerId === id) id = null;
  };
  el.addEventListener("pointerdown", down);
  el.addEventListener("pointermove", move);
  el.addEventListener("pointerup", up);
  el.addEventListener("pointercancel", cancel);
  return () => {
    el.removeEventListener("pointerdown", down);
    el.removeEventListener("pointermove", move);
    el.removeEventListener("pointerup", up);
    el.removeEventListener("pointercancel", cancel);
  };
}

/** Held-button reader for on-screen controls: each [data-key="name"] element sets keys[name] while pressed. */
export function holdButtons(root: HTMLElement, keys: Record<string, boolean>, onPress?: (name: string) => void) {
  const els = Array.from(root.querySelectorAll<HTMLElement>("[data-key]"));
  const offs: Array<() => void> = [];
  for (const el of els) {
    const name = el.dataset.key!;
    const on = (e: PointerEvent) => {
      e.preventDefault();
      try {
        el.setPointerCapture(e.pointerId);
      } catch {
        // The pointer already ended; nothing to capture.
      }
      keys[name] = true;
      el.classList.add("is-held");
      onPress?.(name);
    };
    const off = () => {
      keys[name] = false;
      el.classList.remove("is-held");
    };
    el.addEventListener("pointerdown", on);
    el.addEventListener("pointerup", off);
    el.addEventListener("pointercancel", off);
    el.addEventListener("lostpointercapture", off);
    const noMenu = (e: Event) => e.preventDefault();
    el.addEventListener("contextmenu", noMenu);
    offs.push(() => {
      el.removeEventListener("pointerdown", on);
      el.removeEventListener("pointerup", off);
      el.removeEventListener("pointercancel", off);
      el.removeEventListener("lostpointercapture", off);
      el.removeEventListener("contextmenu", noMenu);
    });
  }
  return () => offs.forEach((f) => f());
}

/** Seeded PRNG (mulberry32), so spawn patterns can be tested. */
export function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function buzz(ms: number | number[]) {
  try {
    navigator.vibrate?.(ms);
  } catch {
    // Not allowed here; haptics are a bonus.
  }
}
