// Demo of global_unrest's UI language on this portfolio page: heat cells,
// event diamonds, a time scrubber. The real desktop app tracks actual media
// attention and verified-event signals (see project-overrides.ts for how it
// works); this widget intentionally runs on local synthetic data only, so
// the site never fakes a live feed or scrapes a real one just to look busy.
const COLS = 14;
const ROWS = 7;
const DAYS = 35;

function seededRandom(seed: number): number {
  const x = Math.sin(seed * 12.9898) * 43758.5453;
  return x - Math.floor(x);
}

function cellIntensity(day: number, col: number, row: number): number {
  const seed = day * 1000 + row * 31 + col;
  const base = seededRandom(seed);
  const wave = 0.5 + 0.5 * Math.sin(day * 0.3 + col * 0.5 + row * 0.7);
  return Math.min(1, base * 0.55 + wave * 0.45);
}

function intensityColor(intensity: number, alpha: number): string {
  if (intensity < 0.33) return `rgba(60,255,122,${alpha})`;
  if (intensity < 0.66) return `rgba(255,176,0,${alpha})`;
  return `rgba(225,75,255,${alpha})`;
}

function setupCanvasDPR(canvas: HTMLCanvasElement, maxDPR = 2) {
  const rect = canvas.getBoundingClientRect();
  const width = Math.max(1, Math.round(rect.width));
  const height = Math.max(1, Math.round(rect.height));
  const dpr = Math.min(window.devicePixelRatio || 1, maxDPR);
  canvas.width = Math.round(width * dpr);
  canvas.height = Math.round(height * dpr);
  const ctx = canvas.getContext("2d")!;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  return { ctx, width, height };
}

function draw(canvas: HTMLCanvasElement, day: number) {
  const { ctx, width, height } = setupCanvasDPR(canvas);
  ctx.fillStyle = "#05070a";
  ctx.fillRect(0, 0, width, height);

  const cellW = width / COLS;
  const cellH = height / ROWS;
  const pad = 1.5;
  const hotCells: { x: number; y: number }[] = [];

  for (let row = 0; row < ROWS; row++) {
    for (let col = 0; col < COLS; col++) {
      const intensity = cellIntensity(day, col, row);
      const x = col * cellW;
      const y = row * cellH;
      ctx.fillStyle = intensityColor(intensity, 0.12 + intensity * 0.55);
      ctx.fillRect(x + pad, y + pad, cellW - pad * 2, cellH - pad * 2);
      if (intensity > 0.82) hotCells.push({ x: x + cellW / 2, y: y + cellH / 2 });
    }
  }

  ctx.strokeStyle = "rgba(225,75,255,0.9)";
  ctx.lineWidth = 1.5;
  for (const cell of hotCells) {
    const s = Math.min(cellW, cellH) * 0.28;
    ctx.beginPath();
    ctx.moveTo(cell.x, cell.y - s);
    ctx.lineTo(cell.x + s, cell.y);
    ctx.lineTo(cell.x, cell.y + s);
    ctx.lineTo(cell.x - s, cell.y);
    ctx.closePath();
    ctx.stroke();
  }
}

export function mount(root: HTMLElement): { destroy(): void } {
  root.innerHTML = `
    <canvas class="toy-canvas" aria-hidden="true"></canvas>
    <div class="toy-controls">
      <label for="signal-map-day" class="visually-hidden">Day in synthetic 35-day window</label>
      <input type="range" id="signal-map-day" min="0" max="${DAYS - 1}" value="${DAYS - 1}" class="field" style="flex:1" />
      <span id="signal-map-day-label">Day ${DAYS} / ${DAYS}</span>
    </div>
    <p class="toy-caption">Demo of the UI — the real app tracks actual media attention and event signals; this widget runs on local synthetic data only.</p>
  `;

  const canvas = root.querySelector("canvas") as HTMLCanvasElement;
  const slider = root.querySelector("#signal-map-day") as HTMLInputElement;
  const label = root.querySelector("#signal-map-day-label") as HTMLElement;

  function render() {
    const day = Number(slider.value);
    label.textContent = `Day ${day + 1} / ${DAYS}`;
    draw(canvas, day);
  }

  slider.addEventListener("input", render);
  const ro = new ResizeObserver(render);
  ro.observe(canvas);
  render();

  return {
    destroy() {
      ro.disconnect();
      slider.removeEventListener("input", render);
    },
  };
}
