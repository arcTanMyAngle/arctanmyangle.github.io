// Footer display toggles. The same two settings live in the command palette,
// but a first-time visitor never opens Ctrl+K — so they get a visible control
// too. Both write through clientState so the blocking head script picks the
// choice up on the next navigation.
import { getShineMode, setShineMode, getReducedEffects, setReducedEffects } from "../lib/clientState";

interface Toggle {
  button: HTMLButtonElement;
  read: () => boolean;
  write: (value: boolean) => void;
  onLabel: string;
  offLabel: string;
}

export function mount(root: HTMLElement): { destroy(): void } {
  const shineButton = root.querySelector<HTMLButtonElement>("[data-toggle-shine]");
  const motionButton = root.querySelector<HTMLButtonElement>("[data-toggle-motion]");

  const toggles: Toggle[] = [];

  if (shineButton) {
    toggles.push({
      button: shineButton,
      read: getShineMode,
      write: setShineMode,
      onLabel: "Shine on",
      offLabel: "Shine off",
    });
  }

  if (motionButton) {
    toggles.push({
      button: motionButton,
      // Inverted on purpose: the button reads "Motion on", not "reduced on".
      read: () => !getReducedEffects(),
      write: (value) => {
        setReducedEffects(!value);
        // Reveal-hiding CSS is armed by the head script. If motion is switched
        // off mid-session, disarm it so nothing stays permanently invisible.
        if (!value) document.documentElement.dataset.revealState = "off";
      },
      onLabel: "Motion on",
      offLabel: "Motion off",
    });
  }

  function sync(toggle: Toggle): void {
    const on = toggle.read();
    toggle.button.setAttribute("aria-pressed", String(on));
    toggle.button.textContent = on ? toggle.onLabel : toggle.offLabel;
  }

  const handlers = toggles.map((toggle) => {
    const handler = () => {
      toggle.write(!toggle.read());
      sync(toggle);
    };
    toggle.button.addEventListener("click", handler);
    sync(toggle);
    return { toggle, handler };
  });

  // Buttons are rendered hidden so a no-JS visitor never sees a dead control.
  root.hidden = false;

  return {
    destroy() {
      for (const { toggle, handler } of handlers) {
        toggle.button.removeEventListener("click", handler);
      }
    },
  };
}
