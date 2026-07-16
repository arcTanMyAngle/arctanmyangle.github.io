// Reaction-time mini-game for /lab and the Real-TimeReaction ("reActivation")
// detail page. Five-round sets, false-start detection, best 5-round average
// persisted to localStorage via clientState.ts.
import { getReactionBestScore, setReactionBestScore } from "../lib/clientState";

type StageState = "idle" | "waiting" | "go" | "between" | "done" | "too-soon";

const ROUNDS_PER_SET = 5;

export function mount(root: HTMLElement): { destroy(): void } {
  root.innerHTML = `
    <div class="reaction-toy">
      <button type="button" class="reaction-toy__stage" id="reaction-stage" data-state="idle" aria-live="polite">
        Press Space or click to start
      </button>
      <div class="toy-stat-row">
        <span>Last: <strong id="reaction-last">–</strong></span>
        <span>Average (${ROUNDS_PER_SET}): <strong id="reaction-avg">–</strong></span>
        <span>Best avg: <strong id="reaction-best">–</strong></span>
      </div>
    </div>
  `;

  const stage = root.querySelector("#reaction-stage") as HTMLButtonElement;
  const lastEl = root.querySelector("#reaction-last") as HTMLElement;
  const avgEl = root.querySelector("#reaction-avg") as HTMLElement;
  const bestEl = root.querySelector("#reaction-best") as HTMLElement;

  let state: StageState = "idle";
  let timeoutId: ReturnType<typeof setTimeout> | null = null;
  let goAt = 0;
  let samples: number[] = [];

  function refreshBest() {
    const best = getReactionBestScore();
    bestEl.textContent = best !== null ? `${best} ms` : "–";
  }
  refreshBest();

  function setStage(next: StageState, text: string) {
    state = next;
    stage.dataset.state = next;
    stage.textContent = text;
  }

  function armRound() {
    setStage("waiting", "Wait for green...");
    const delay = 800 + Math.random() * 1800;
    timeoutId = setTimeout(() => {
      goAt = performance.now();
      setStage("go", "GO!");
    }, delay);
  }

  function handleTrigger() {
    switch (state) {
      case "idle":
      case "done":
      case "too-soon":
        samples = [];
        lastEl.textContent = "–";
        avgEl.textContent = "–";
        armRound();
        break;
      case "between":
        armRound();
        break;
      case "waiting":
        if (timeoutId) clearTimeout(timeoutId);
        setStage("too-soon", "Too soon — click to retry");
        break;
      case "go": {
        const rt = Math.round(performance.now() - goAt);
        samples.push(rt);
        lastEl.textContent = `${rt} ms`;
        if (samples.length >= ROUNDS_PER_SET) {
          const avg = Math.round(samples.reduce((a, b) => a + b, 0) / samples.length);
          avgEl.textContent = `${avg} ms`;
          const best = getReactionBestScore();
          if (best === null || avg < best) {
            setReactionBestScore(avg);
            refreshBest();
          }
          setStage("done", `Average ${avg} ms — click to try again`);
        } else {
          setStage("between", `Round ${samples.length}/${ROUNDS_PER_SET} — click to continue`);
        }
        break;
      }
    }
  }

  // A native <button> already fires "click" for both mouse clicks and
  // keyboard activation (Enter, and Space on keyup) when it has focus — no
  // separate global keydown listener needed, and nothing hijacks the page's
  // normal Space-to-scroll behavior when the stage isn't focused.
  stage.addEventListener("click", handleTrigger);

  return {
    destroy() {
      if (timeoutId) clearTimeout(timeoutId);
      stage.removeEventListener("click", handleTrigger);
    },
  };
}
