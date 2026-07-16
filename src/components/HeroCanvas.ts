// Home-page hero background: a pixel starfield with a slow radar sweep
// searchlighting across it. Purely decorative chrome (not a project demo),
// so unlike the toy modules this mounts directly onto an existing <canvas>
// already sitting behind the hero copy, rather than injecting its own markup
// into a container. Mounted eagerly since it IS the above-the-fold visual.
import { startCanvasLoop } from "../lib/canvasLoop";

interface Star {
  x: number;
  y: number;
  r: number;
  phase: number;
  speed: number;
}

function makeStars(count: number, width: number, height: number): Star[] {
  return Array.from({ length: count }, () => ({
    x: Math.random() * width,
    y: Math.random() * height,
    r: Math.random() * 1.3 + 0.3,
    phase: Math.random() * Math.PI * 2,
    speed: 0.0004 + Math.random() * 0.0009,
  }));
}

export function mount(canvas: HTMLCanvasElement): { destroy(): void } {
  let stars: Star[] = [];
  let sweepAngle = -Math.PI / 2;

  const handle = startCanvasLoop(canvas, {
    maxDPR: 2,
    onResize(width, height) {
      const count = Math.round((width * height) / 6000);
      stars = makeStars(count, width, height);
    },
    onFrame(ctx, { dt, time, width, height }) {
      ctx.fillStyle = "#050912";
      ctx.fillRect(0, 0, width, height);

      for (const star of stars) {
        const twinkle = 0.4 + 0.6 * (0.5 + 0.5 * Math.sin(time * star.speed + star.phase));
        ctx.fillStyle = `rgba(238,242,251,${twinkle * 0.7})`;
        ctx.fillRect(star.x, star.y, star.r, star.r);
      }

      const originX = width / 2;
      const originY = height;
      const radius = Math.hypot(width / 2, height) * 1.05;

      sweepAngle += dt * 0.00035;
      if (sweepAngle > -0.05) sweepAngle = -Math.PI + 0.05;

      const wedgeSpan = 0.5;
      const wedgeSteps = 20;
      for (let i = 0; i < wedgeSteps; i++) {
        const a = sweepAngle - (i / wedgeSteps) * wedgeSpan;
        const alpha = 0.05 * (1 - i / wedgeSteps);
        const grad = ctx.createLinearGradient(
          originX,
          originY,
          originX + Math.cos(a) * radius,
          originY + Math.sin(a) * radius
        );
        grad.addColorStop(0, `rgba(79,178,255,${alpha})`);
        grad.addColorStop(1, "rgba(79,178,255,0)");
        ctx.strokeStyle = grad;
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(originX, originY);
        ctx.lineTo(originX + Math.cos(a) * radius, originY + Math.sin(a) * radius);
        ctx.stroke();
      }
    },
  });

  return { destroy: () => handle.stop() };
}
