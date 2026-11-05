import { getReducedEffects, getTheme, setReducedEffects, setTheme } from "../lib/clientState";

interface Command {
  id: string;
  label: string;
  hint?: string;
  run: () => void;
}

function navCommands(): Command[] {
  const go = (href: string) => () => {
    window.location.href = href;
  };
  return [
    { id: "stacker", label: "Play Stacker", hint: "/arcade/stacker", run: go("/arcade/stacker/") },
    { id: "reaction", label: "Play Reaction", hint: "/arcade/reaction", run: go("/arcade/reaction/") },
    { id: "chess", label: "Open chess lines", hint: "/chess", run: go("/chess/") },
    { id: "chess-play", label: "Play chess for two", hint: "/chess/play", run: go("/chess/play/") },
    { id: "home", label: "Go to Home", hint: "/", run: go("/") },
    { id: "arcade", label: "Go to Arcade", hint: "/arcade", run: go("/arcade/") },
    { id: "lab", label: "Go to Lab", hint: "/lab", run: go("/lab/") },
    { id: "tabs", label: "Go to Tabs", hint: "/tabs", run: go("/tabs/") },
    { id: "skate", label: "Go to Skate Lab", hint: "/skate", run: go("/skate/") },
    { id: "projects", label: "Go to Projects", hint: "/projects", run: go("/projects/") },
    { id: "about", label: "Go to About", hint: "/about", run: go("/about/") },
  ];
}

// Toggles go through the visible buttons when they exist, so their labels stay in step (DisplayControls).
function toggleCommands(): Command[] {
  const viaButton = (selector: string, fallback: () => void) => () => {
    const button = document.querySelector<HTMLButtonElement>(selector);
    if (button) button.click();
    else fallback();
  };
  return [
    {
      id: "toggle-theme",
      label: "Toggle light/dark theme",
      hint: `currently ${getTheme()}`,
      run: viaButton("[data-theme-toggle]", () => setTheme(getTheme() === "dark" ? "light" : "dark")),
    },
    {
      id: "toggle-motion",
      label: "Toggle low-motion mode",
      hint: getReducedEffects() ? "currently reduced" : "currently full",
      run: viaButton("[data-toggle-motion]", () => setReducedEffects(!getReducedEffects())),
    },
  ];
}

export function mount(root: HTMLElement): { destroy(): void } {
  root.innerHTML = `
    <div class="palette-backdrop" id="palette-backdrop" hidden>
      <div class="palette" role="dialog" aria-modal="true" aria-label="Command palette">
        <input class="palette__input field" id="palette-input" type="text"
          placeholder="Type a command..." autocomplete="off" aria-label="Command palette input" />
        <ul class="palette__list" id="palette-list" role="listbox"></ul>
      </div>
    </div>
  `;

  const backdrop = root.querySelector<HTMLDivElement>("#palette-backdrop")!;
  const input = root.querySelector<HTMLInputElement>("#palette-input")!;
  const list = root.querySelector<HTMLUListElement>("#palette-list")!;
  const trigger = document.getElementById("palette-trigger");

  let selected = 0;
  let filtered: Command[] = [];
  let lastFocused: HTMLElement | null = null;

  function allCommands(): Command[] {
    return [...navCommands(), ...toggleCommands()];
  }

  // Labels are static today, but never interpolate them into innerHTML raw.
  function escapeHtml(value: string): string {
    return value.replace(/[&<>"']/g, (ch) =>
      ch === "&" ? "&amp;" : ch === "<" ? "&lt;" : ch === ">" ? "&gt;" : ch === '"' ? "&quot;" : "&#39;",
    );
  }

  function render() {
    const query = input.value.trim().toLowerCase();
    const commands = allCommands();
    filtered = query ? commands.filter((c) => c.label.toLowerCase().includes(query)) : commands;
    selected = 0;
    if (filtered.length === 0) {
      list.innerHTML = `<li class="palette__empty">No matching commands.</li>`;
      return;
    }
    list.innerHTML = filtered
      .map(
        (c, i) => `
      <li class="palette__item" role="option" data-index="${i}" aria-selected="${i === selected}">
        <span>${escapeHtml(c.label)}</span>
        ${c.hint ? `<span class="palette__item-hint">${escapeHtml(c.hint)}</span>` : ""}
      </li>`
      )
      .join("");
  }

  function updateSelection() {
    list.querySelectorAll<HTMLLIElement>(".palette__item").forEach((el, i) => {
      el.setAttribute("aria-selected", String(i === selected));
      if (i === selected) el.scrollIntoView({ block: "nearest" });
    });
  }

  function open() {
    lastFocused = document.activeElement as HTMLElement | null;
    backdrop.hidden = false;
    input.value = "";
    render();
    input.focus();
    document.addEventListener("keydown", onKeydownInPalette);
  }

  function close() {
    backdrop.hidden = true;
    document.removeEventListener("keydown", onKeydownInPalette);
    lastFocused?.focus();
  }

  function execute(command: Command) {
    close();
    command.run();
  }

  function onKeydownInPalette(e: KeyboardEvent) {
    if (e.key === "Escape") {
      e.preventDefault();
      close();
    } else if (e.key === "ArrowDown") {
      e.preventDefault();
      selected = Math.min(selected + 1, filtered.length - 1);
      updateSelection();
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      selected = Math.max(selected - 1, 0);
      updateSelection();
    } else if (e.key === "Enter") {
      e.preventDefault();
      const cmd = filtered[selected];
      if (cmd) execute(cmd);
    }
  }

  input.addEventListener("input", render);
  list.addEventListener("click", (e) => {
    const item = (e.target as HTMLElement).closest<HTMLLIElement>(".palette__item[data-index]");
    if (!item) return;
    const cmd = filtered[Number(item.dataset.index)];
    if (cmd) execute(cmd);
  });
  backdrop.addEventListener("click", (e) => {
    if (e.target === backdrop) close();
  });
  trigger?.addEventListener("click", open);

  // Global Ctrl/Cmd+K listener, active for the lifetime of the page.
  function onGlobalKeydown(e: KeyboardEvent) {
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") {
      e.preventDefault();
      if (backdrop.hidden) open();
      else close();
    }
  }
  document.addEventListener("keydown", onGlobalKeydown);

  return {
    destroy() {
      document.removeEventListener("keydown", onGlobalKeydown);
      document.removeEventListener("keydown", onKeydownInPalette);
    },
  };
}
