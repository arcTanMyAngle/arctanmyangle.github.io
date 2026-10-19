// Display toggles: the header theme button and the footer motion button. The same two settings live in
// the command palette, but a first-time visitor never opens Ctrl+K, so they get visible controls too.
// Both write through clientState so the blocking head script picks the choice up on the next navigation.
import { getReducedEffects, getTheme, setReducedEffects, setTheme } from "../lib/clientState";

export function mount(root: HTMLElement): { destroy(): void } {
  const themeButtons = Array.from(root.querySelectorAll<HTMLButtonElement>("[data-theme-toggle]"));
  const motionButtons = Array.from(root.querySelectorAll<HTMLButtonElement>("[data-toggle-motion]"));

  // The theme button holds sun/moon icons, so only its label changes.
  const syncTheme = () => {
    const next = getTheme() === "dark" ? "light" : "dark";
    for (const b of themeButtons) b.setAttribute("aria-label", `Switch to ${next} theme`);
  };
  // Inverted on purpose: the button reads "Motion on", not "reduced on".
  const syncMotion = () => {
    const on = !getReducedEffects();
    for (const b of motionButtons) {
      b.setAttribute("aria-pressed", String(on));
      b.textContent = on ? "Motion on" : "Motion off";
      // Rendered hidden so a no-JS visitor never sees a dead control.
      b.hidden = false;
    }
  };

  const onTheme = () => {
    setTheme(getTheme() === "dark" ? "light" : "dark");
    syncTheme();
  };
  const onMotion = () => {
    setReducedEffects(!getReducedEffects());
    syncMotion();
  };

  for (const b of themeButtons) b.addEventListener("click", onTheme);
  for (const b of motionButtons) b.addEventListener("click", onMotion);
  syncTheme();
  syncMotion();

  return {
    destroy() {
      for (const b of themeButtons) b.removeEventListener("click", onTheme);
      for (const b of motionButtons) b.removeEventListener("click", onMotion);
    },
  };
}
