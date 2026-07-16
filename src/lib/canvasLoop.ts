// Shared canvas animation-loop discipline, used by every toy (RadarToy,
// SpectrogramToy, SignalMapToy) and the home-page background canvas, so DPR
// capping / visibility pausing / reduced-motion gating / mobile throttling
// is implemented exactly once.

export interface CanvasFrameInfo {
  dt: number;
  time: number;
  width: number;
  height: number;
}

export interface CanvasLoopOptions {
  maxDPR?: number;
  targetFPS?: number;
  mobileFPS?: number;
  onFrame: (ctx: CanvasRenderingContext2D, info: CanvasFrameInfo) => void;
  onResize?: (width: number, height: number) => void;
}

export interface CanvasLoopHandle {
  stop(): void;
}

function isReducedMotion(): boolean {
  return document.documentElement.dataset.motion === "reduced";
}

export function startCanvasLoop(canvas: HTMLCanvasElement, options: CanvasLoopOptions): CanvasLoopHandle {
  const { maxDPR = 2, targetFPS = 60, mobileFPS = 30, onFrame, onResize } = options;
  const ctx = canvas.getContext("2d");
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
  if (isReducedMotion()) {
    onFrame(ctx, { dt: 0, time: 0, width, height });
    return { stop() {} };
  }

  let rafId: number | null = null;
  let lastTime = performance.now();
  let accumulator = 0;
  const startTime = lastTime;

  function frame(now: number) {
    rafId = requestAnimationFrame(frame);
    const dt = now - lastTime;
    lastTime = now;
    accumulator += dt;
    if (accumulator < frameInterval) return;
    accumulator %= frameInterval;
    onFrame(ctx!, { dt, time: now - startTime, width, height });
  }

  function start() {
    if (rafId === null) {
      lastTime = performance.now();
      rafId = requestAnimationFrame(frame);
    }
  }

  function pause() {
    if (rafId !== null) {
      cancelAnimationFrame(rafId);
      rafId = null;
    }
  }

  start();

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
    resizeTimeout = setTimeout(resize, 120);
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
