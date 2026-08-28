// Scroll-reveal, powered by `motion` (a small framework-free WAAPI wrapper that
// Astro bundles locally — no CDN, no runtime dependency at request time).
//
// Contract with the markup:
//   [data-reveal]        — reveal this element on its own
//   [data-reveal-group]  — stagger this element's direct children
//
// The hiding CSS is gated on :root[data-reveal-state="armed"], which the
// blocking head script sets only when JS + full motion are both live. Every
// failure path here disarms it, so content is never left permanently invisible.
import { animate, inView, stagger } from "motion";

// Not `as const`: motion's keyframe target type wants mutable arrays.
const ENTER = {
  opacity: [0, 1],
  transform: ["translateY(12px)", "translateY(0px)"],
};

// `ease`, not `easing` — the WAAPI spelling is silently ignored by motion, which
// would quietly downgrade this curve to the default ease.
const OPTIONS = {
  duration: 0.5,
  ease: [0.22, 1, 0.36, 1] as [number, number, number, number],
};

// Long enough for the animations above to have visibly started, short enough
// that a stuck page corrects itself before anyone notices.
const FAILSAFE_MS = 1200;

function disarm(): void {
  document.documentElement.dataset.revealState = "off";
}

/** True when the element is already within (or above) the viewport at call time. */
function inViewportNow(el: Element): boolean {
  const rect = el.getBoundingClientRect();
  return rect.top < window.innerHeight && rect.bottom > 0;
}

function run(root: ParentNode): void {
  const armed: HTMLElement[] = [];

  const play = (targets: HTMLElement[], delay?: ReturnType<typeof stagger>) => {
    animate(targets, ENTER, delay ? { ...OPTIONS, delay } : OPTIONS);
  };

  try {
    for (const el of root.querySelectorAll<HTMLElement>("[data-reveal]")) {
      armed.push(el);
      // Above the fold on load: animate straight away rather than waiting on an
      // intersection callback whose moment has already passed.
      if (inViewportNow(el)) play([el]);
      else inView(el, () => play([el]), { amount: 0.15 });
    }

    for (const group of root.querySelectorAll<HTMLElement>("[data-reveal-group]")) {
      const children = Array.from(group.children) as HTMLElement[];
      if (children.length === 0) continue;
      armed.push(...children);
      if (inViewportNow(group)) play(children, stagger(0.06));
      else inView(group, () => play(children, stagger(0.06)), { amount: 0.1 });
    }
  } catch {
    disarm();
    return;
  }

  // Trust nothing: if an element that should have animated by now is still fully
  // transparent, the animation never took (no rAF, blocked WAAPI, throttled tab)
  // — drop the hiding CSS so the page is readable regardless.
  window.setTimeout(() => {
    const stuck = armed.some(
      (el) => inViewportNow(el) && getComputedStyle(el).opacity === "0",
    );
    if (stuck) disarm();
  }, FAILSAFE_MS);
}

export function revealAll(root: ParentNode = document): void {
  if (document.documentElement.dataset.revealState !== "armed") return;

  // A page loaded into a background tab gets no rAF, so `motion` would queue the
  // animations and the reveal would stall. Nothing is on screen to stall, so just
  // wait for the tab to be looked at.
  if (document.hidden) {
    const onVisible = () => {
      if (document.hidden) return;
      document.removeEventListener("visibilitychange", onVisible);
      revealAll(root);
    };
    document.addEventListener("visibilitychange", onVisible);
    return;
  }

  run(root);
}
