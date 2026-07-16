// Procedural spectrogram for Bird_Acoustics: animated frequency bars driven
// by layered sine waves + a cheap hash noise term. No microphone access, no
// real audio — a demo visual standing in for the on-device mel-spectrogram
// pipeline the real firmware runs.
import { startCanvasLoop } from "../lib/canvasLoop";

const BANDS = 40;

function bandValue(t: number, i: number): number {
  const f1 = Math.sin(t * 0.0016 + i * 0.35) * 0.5 + 0.5;
  const f2 = Math.sin(t * 0.0037 + i * 0.12) * 0.5 + 0.5;
  const rawNoise = Math.sin(i * 12.9898 + Math.floor(t / 90) * 78.233) * 43758.5453;
  const noise = (rawNoise - Math.floor(rawNoise)) * 0.3;
  return Math.min(1, f1 * 0.4 + f2 * 0.4 + noise);
}

export function mount(root: HTMLElement): { destroy(): void } {
  root.innerHTML = `
    <canvas class="toy-canvas" aria-hidden="true"></canvas>
    <p class="toy-caption">Procedural spectrogram — demo bars, not a live audio feed.</p>
  `;
  const canvas = root.querySelector("canvas") as HTMLCanvasElement;

  const handle = startCanvasLoop(canvas, {
    maxDPR: 2,
    onFrame(ctx, { time, width, height }) {
      ctx.fillStyle = "#05070a";
      ctx.fillRect(0, 0, width, height);

      const barW = width / BANDS;
      for (let i = 0; i < BANDS; i++) {
        const v = bandValue(time, i);
        const barH = v * height * 0.9;
        ctx.fillStyle = v < 0.5 ? `rgba(60,255,122,${0.35 + v * 0.5})` : `rgba(255,176,0,${0.35 + v * 0.5})`;
        ctx.fillRect(i * barW + 1, height - barH, barW - 2, barH);
      }
    },
  });

  return { destroy: () => handle.stop() };
}
