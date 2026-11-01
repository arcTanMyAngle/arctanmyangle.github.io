// Shared canvas animation-loop discipline, used by every canvas toy and game, so DPR capping / visibility
// pausing / reduced-motion gating / mobile throttling is implemented exactly once.

export interface CanvasFrameInfo {
  /** Milliseconds since the previous onFrame call (not since the previous rAF tick). */
  dt: number;
  time: number;
  width: number;
  height: number;
}

export interface CanvasLoopOptions {
  maxDPR?: number;
  targetFPS?: number;
  mobileFPS?: number;
  /** Games are the point of their page: keep running under reduced motion instead of drawing one still frame. */
  essential?: boolean;
  onFrame: (ctx: CanvasRenderingContext2D, info: CanvasFrameInfo) => void;
  onResize?: (width: number, height: number) => void;
  /** Called when the loop stops for a hidden tab or an offscreen canvas, and when it starts again. */
  onPauseChange?: (paused: boolean) => void;
}

export interface CanvasLoopHandle {
  stop(): void;
}

function isReducedMotion(): boolean {
  return document.documentElement.dataset.motion === "reduced";
}

export function startCanvasLoop(canvas: HTMLCanvasElement, options: CanvasLoopOptions): CanvasLoopHandle {
  const { maxDPR = 2, targetFPS = 60, mobileFPS = 30, essential = false, onFrame, onResize, onPauseChange } = options;
  const ctx = canvas.getContext("2d", { alpha: false });
  if (!ctx) return { stop() {} };

  const isMobile = window.matchMedia("(max-width: 640px), (pointer: coarse)").matches;
  const frameInterval = 1000 / (isMobile ? mobileFPS : targetFPS);

  let width = 0;
  let height = 0;

  function resize() {
    const rect = canvas.getBoundingClientRect();
    width = Math.max(1, Math.round(rect.width));
    height = Math.max(1, Math.round(rect.height));
    const dpr = Math.min(window.devicePixelRatio || 1, maxDPR);
    canvas.width = Math.round(width * dpr);
    canvas.height = Math.round(height * dpr);
    ctx!.setTransform(dpr, 0, 0, dpr, 0, 0);
    onResize?.(width, height);
  }

  resize();

  // Reduced motion: render exactly one static frame and never start rAF.
  if (isReducedMotion() && !essential) {
    onFrame(ctx, { dt: 0, time: 0, width, height });
    return { stop() {} };
  }

  let rafId: number | null = null;
  let lastFrame = 0;
  const startTime = performance.now();

  function frame(now: number) {
    rafId = requestAnimationFrame(frame);
    // A 2 ms slack keeps a 60 fps target at 60 fps on a 60 Hz screen, where ticks jitter around 16.7 ms.
    if (lastFrame && now - lastFrame < frameInterval - 2) return;
    const dt = lastFrame ? now - lastFrame : frameInterval;
    lastFrame = now;
    onFrame(ctx!, { dt, time: now - startTime, width, height });
  }

  function start() {
    if (rafId === null) {
      lastFrame = 0;
      rafId = requestAnimationFrame(frame);
      onPauseChange?.(false);
    }
  }

  function pause() {
    if (rafId !== null) {
      cancelAnimationFrame(rafId);
      rafId = null;
      onPauseChange?.(true);
    }
  }

  if (!document.hidden) start();

  function onVisibilityChange() {
    if (document.hidden) pause();
    else start();
  }
  document.addEventListener("visibilitychange", onVisibilityChange);

  // Same pause/resume codepath, second trigger: offscreen via IntersectionObserver.
  const io = new IntersectionObserver(
    (entries) => {
      const entry = entries[0];
      if (!entry) return;
      if (entry.isIntersecting && !document.hidden) start();
      else pause();
    },
    { threshold: 0 }
  );
  io.observe(canvas);

  let resizeTimeout: ReturnType<typeof setTimeout> | null = null;
  const ro = new ResizeObserver(() => {
    if (resizeTimeout) clearTimeout(resizeTimeout);
    resizeTimeout = setTimeout(resize, 60);
  });
  ro.observe(canvas);

  return {
    stop() {
      pause();
      document.removeEventListener("visibilitychange", onVisibilityChange);
      io.disconnect();
      ro.disconnect();
      if (resizeTimeout) clearTimeout(resizeTimeout);
    },
  };
}
