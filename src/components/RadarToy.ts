// Synthetic radar scope for look-above: sweep line, range rings, and a
// handful of fake aircraft with phosphor-persistence ghost trails. No real
// flight data — purely decorative/demo, matching look-above's actual
// dead-reckoning-between-updates design without pretending to be live.
import { startCanvasLoop } from "../lib/canvasLoop";

const CALLSIGNS = ["UAL118", "DAL92", "SWA204", "AAL77", "JBU55", "ASA310", "FDX19", "UPS88"];
const FONT = "10px ui-monospace, Menlo, Consolas, monospace";

interface Aircraft {
  x: number;
  y: number;
  vx: number;
  vy: number;
  altitudeFt: number;
  callsign: string;
}

function spawnAircraft(): Aircraft {
  const edgeAngle = Math.random() * Math.PI * 2;
  const x = Math.cos(edgeAngle);
  const y = Math.sin(edgeAngle);
  const inward = Math.atan2(-y, -x) + (Math.random() - 0.5) * 1.4;
  const speed = 0.06 + Math.random() * 0.06;
  return {
    x,
    y,
    vx: Math.cos(inward) * speed,
    vy: Math.sin(inward) * speed,
    altitudeFt: Math.round(5 + Math.random() * 35) * 1000,
    callsign: CALLSIGNS[Math.floor(Math.random() * CALLSIGNS.length)]!,
  };
}

function normalizeAngle(a: number): number {
  while (a > Math.PI) a -= Math.PI * 2;
  while (a < -Math.PI) a += Math.PI * 2;
  return a;
}

export function mount(root: HTMLElement): { destroy(): void } {
  root.innerHTML = `
    <canvas class="toy-canvas" aria-hidden="true"></canvas>
    <p class="toy-caption">Synthetic radar scope — demo aircraft on local pseudo-random paths, not live air-traffic data.</p>
  `;
  const canvas = root.querySelector("canvas") as HTMLCanvasElement;
  const fleet: Aircraft[] = Array.from({ length: 6 }, spawnAircraft);
  let sweepAngle = 0;

  const handle = startCanvasLoop(canvas, {
    maxDPR: 2,
    onFrame(ctx, { dt, width, height }) {
      const cx = width / 2;
      const cy = height / 2;
      const r = Math.min(width, height) / 2 - 10;

      // Phosphor-persistence fade instead of a full clear — gives aircraft
      // natural ghost trails for free.
      ctx.fillStyle = "rgba(5,7,10,0.16)";
      ctx.fillRect(0, 0, width, height);

      ctx.strokeStyle = "rgba(60,255,122,0.25)";
      ctx.lineWidth = 1;
      for (let i = 1; i <= 4; i++) {
        ctx.beginPath();
        ctx.arc(cx, cy, (r * i) / 4, 0, Math.PI * 2);
        ctx.stroke();
      }
      ctx.beginPath();
      ctx.moveTo(cx - r, cy);
      ctx.lineTo(cx + r, cy);
      ctx.moveTo(cx, cy - r);
      ctx.lineTo(cx, cy + r);
      ctx.stroke();

      sweepAngle += dt * 0.0009;
      const wedgeSpan = 0.6;
      const wedgeSteps = 16;
      for (let i = 0; i < wedgeSteps; i++) {
        const a = sweepAngle - (i / wedgeSteps) * wedgeSpan;
        const alpha = 0.16 * (1 - i / wedgeSteps);
        ctx.strokeStyle = `rgba(60,255,122,${alpha})`;
        ctx.beginPath();
        ctx.moveTo(cx, cy);
        ctx.lineTo(cx + Math.cos(a) * r, cy + Math.sin(a) * r);
        ctx.stroke();
      }
      ctx.strokeStyle = "rgba(60,255,122,0.9)";
      ctx.beginPath();
      ctx.moveTo(cx, cy);
      ctx.lineTo(cx + Math.cos(sweepAngle) * r, cy + Math.sin(sweepAngle) * r);
      ctx.stroke();

      for (const ac of fleet) {
        ac.x += ac.vx * (dt / 1000);
        ac.y += ac.vy * (dt / 1000);
        if (Math.hypot(ac.x, ac.y) > 1.05) Object.assign(ac, spawnAircraft());

        const px = cx + ac.x * r;
        const py = cy + ac.y * r;
        ctx.fillStyle = "#3cff7a";
        ctx.beginPath();
        ctx.arc(px, py, 2.5, 0, Math.PI * 2);
        ctx.fill();

        const acAngle = Math.atan2(ac.y, ac.x);
        if (Math.abs(normalizeAngle(sweepAngle - acAngle)) < 0.15) {
          ctx.fillStyle = "rgba(60,255,122,0.9)";
          ctx.font = FONT;
          ctx.fillText(`${ac.callsign} FL${Math.round(ac.altitudeFt / 100)}`, px + 6, py - 6);
        }
      }
    },
  });

  return { destroy: () => handle.stop() };
}
