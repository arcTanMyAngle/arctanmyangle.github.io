// Mounts below-the-fold toys only once they scroll near the viewport,
// so /lab and project-detail pages don't pay for five canvases' worth of
// animation work above the fold. The home-page background canvas mounts
// eagerly instead, since it IS the above-the-fold visual.
export function lazyMount(el: Element, mountFn: (el: HTMLElement) => void): void {
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
