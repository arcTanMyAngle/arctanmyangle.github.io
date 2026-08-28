// Mounts below-the-fold toys only once they scroll near the viewport,
// so /lab and project-detail pages don't pay for five canvases' worth of
// animation work above the fold. The home-page background canvas mounts
// eagerly instead, since it IS the above-the-fold visual.
export function lazyMount(el: Element, mountFn: (el: HTMLElement) => void): void {
  // A page opened into a background tab gets no rAF and unreliable observer
  // callbacks, which would leave the toy as a permanent placeholder. Nothing is
  // on screen yet, so just wait for the tab to be looked at.
  if (document.hidden) {
    const onVisible = () => {
      if (document.hidden) return;
      document.removeEventListener("visibilitychange", onVisible);
      lazyMount(el, mountFn);
    };
    document.addEventListener("visibilitychange", onVisible);
    return;
  }

  if (!("IntersectionObserver" in window)) {
    mountFn(el as HTMLElement);
    return;
  }
  const io = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        if (entry.isIntersecting) {
          io.disconnect();
          mountFn(el as HTMLElement);
        }
      }
    },
    { rootMargin: "200px" }
  );
  io.observe(el);
}
