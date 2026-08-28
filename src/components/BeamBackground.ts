// Site-wide background: a single scanner beam sweeping back and forth across
// the viewport, lighting a field of instrument ticks along the bottom edge as
// it passes. Replaces the old starfield + rotating radar wedge.
//
// Cost discipline: the beam's soft falloff is rasterised once per resize into
// an offscreen sprite and then blitted a handful of times per frame (the trail
// is just the same sprite at earlier sweep phases), so a full-viewport fixed
// canvas costs one fill + ~8 drawImage calls + ~40 hairlines per frame instead
// of rebuilding gradients 60 times a second.
import { startCanvasLoop } from "../lib/canvasLoop";

const SWEEP_PERIOD_MS = 6200;
const TRAIL_STEPS = 8;
const TRAIL_PHASE_LAG = 0.05;
const SPRITE_HEIGHT = 128; // stretched vertically at draw time; it's a soft gradient
const TICK_SPACING = 34;
const TICK_BAND = 0.26; // fraction of viewport height the tick field occupies, from the bottom

function readVar(name: string, fallback: string): string {
  const value = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return value || fallback;
}

/** Deterministic per-index height so the tick field is stable across resizes. */
function tickHeight(index: number): number {
  const n = Math.sin(index * 12.9898) * 43758.5453;
  return 0.18 + (n - Math.floor(n)) * 0.62;
}

function buildBeamSprite(width: number): HTMLCanvasElement {
  const sprite = document.createElement("canvas");
  sprite.width = Math.max(2, width);
  sprite.height = SPRITE_HEIGHT;
  const g = sprite.getContext("2d");
  if (!g) return sprite;

  // Horizontal falloff: a hot narrow core inside a wide, very soft halo.
  const across = g.createLinearGradient(0, 0, sprite.width, 0);
  const stops: [number, number][] = [
    [0, 0],
    [0.3, 0.03],
    [0.42, 0.12],
    [0.47, 0.38],
    [0.5, 0.95],
    [0.53, 0.38],
    [0.58, 0.12],
    [0.7, 0.03],
    [1, 0],
  ];
  for (const [pos, alpha] of stops) across.addColorStop(pos, `rgba(104, 190, 255, ${alpha})`);
  g.fillStyle = across;
  g.fillRect(0, 0, sprite.width, SPRITE_HEIGHT);

  // Vertical profile: brightest through the middle, fading at both edges so the
  // beam never draws a hard line against the header or the footer.
  g.globalCompositeOperation = "destination-in";
  const down = g.createLinearGradient(0, 0, 0, SPRITE_HEIGHT);
  down.addColorStop(0, "rgba(0,0,0,0.08)");
  down.addColorStop(0.42, "rgba(0,0,0,1)");
  down.addColorStop(0.78, "rgba(0,0,0,0.7)");
  down.addColorStop(1, "rgba(0,0,0,0.1)");
  g.fillStyle = down;
  g.fillRect(0, 0, sprite.width, SPRITE_HEIGHT);

  return sprite;
}

export function mount(canvas: HTMLCanvasElement): { destroy(): void } {
  const bg = readVar("--color-bg", "#050912");
  let sprite = buildBeamSprite(2);
  let spriteWidth = 2;
  let tickCount = 0;

  const handle = startCanvasLoop(canvas, {
    maxDPR: 1.5,
    onResize(width) {
      spriteWidth = Math.round(Math.min(Math.max(width * 0.42, 260), 820));
      sprite = buildBeamSprite(spriteWidth);
      tickCount = Math.ceil(width / TICK_SPACING) + 1;
    },
    onFrame(ctx, { time, width, height }) {
      // data-shine is the site-wide "chrome flourish" switch; when it's off the
      // beam stays but drops to a dim, matte version of itself.
      const lit = document.documentElement.dataset.shine !== "off" ? 1 : 0.4;

      ctx.globalCompositeOperation = "source-over";
      ctx.fillStyle = bg;
      ctx.fillRect(0, 0, width, height);

      const phase = (time / SWEEP_PERIOD_MS) * Math.PI * 2;
      // sin() eases naturally at both ends — the beam decelerates into each
      // wall and accelerates back out, which is what makes it read as a scan
      // rather than a slider.
      const beamX = width / 2 + Math.sin(phase) * (width / 2);

      ctx.globalCompositeOperation = "lighter";
      for (let i = TRAIL_STEPS; i >= 0; i--) {
        const trailX = width / 2 + Math.sin(phase - i * TRAIL_PHASE_LAG) * (width / 2);
        const decay = 1 - i / (TRAIL_STEPS + 1);
        ctx.globalAlpha = 0.5 * decay * decay * lit;
        ctx.drawImage(sprite, trailX - spriteWidth / 2, 0, spriteWidth, height);
      }

      // Hot core: a single hairline that sells the beam as a light source.
      ctx.globalAlpha = 0.5 * lit;
      const core = ctx.createLinearGradient(0, 0, 0, height);
      core.addColorStop(0, "rgba(150, 225, 255, 0)");
      core.addColorStop(0.45, "rgba(190, 240, 255, 0.55)");
      core.addColorStop(1, "rgba(150, 225, 255, 0)");
      ctx.fillStyle = core;
      ctx.fillRect(beamX - 0.75, 0, 1.5, height);

      // Instrument ticks along the bottom edge, brightening as the beam crosses.
      const baseline = height - 1;
      const bandHeight = height * TICK_BAND;
      const reach = spriteWidth * 0.5;
      ctx.globalAlpha = 1;
      for (let i = 0; i < tickCount; i++) {
        const x = i * TICK_SPACING + 0.5;
        const distance = Math.abs(x - beamX) / reach;
        const glow = distance >= 1 ? 0 : (1 - distance) * (1 - distance);
        const h = bandHeight * tickHeight(i) * (0.55 + 0.45 * glow);
        ctx.fillStyle = `rgba(109, 243, 255, ${(0.035 + glow * 0.4 * lit).toFixed(3)})`;
        ctx.fillRect(x, baseline - h, 1, h);
      }

      ctx.globalCompositeOperation = "source-over";
      ctx.globalAlpha = 1;

      // Top vignette so header and hero copy always sit on near-flat ink.
      const veil = ctx.createLinearGradient(0, 0, 0, height * 0.6);
      veil.addColorStop(0, "rgba(5, 9, 18, 0.85)");
      veil.addColorStop(1, "rgba(5, 9, 18, 0)");
      ctx.fillStyle = veil;
      ctx.fillRect(0, 0, width, height * 0.6);
    },
  });

  return { destroy: () => handle.stop() };
}
