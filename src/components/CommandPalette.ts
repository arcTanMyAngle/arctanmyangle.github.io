import { getCrtMode, setCrtMode, getReducedEffects, setReducedEffects } from "../lib/clientState";

interface Command {
  id: string;
  label: string;
  hint?: string;
  run: () => void;
}

const KONAMI_SEQUENCE = [
  "ArrowUp",
  "ArrowUp",
  "ArrowDown",
  "ArrowDown",
  "ArrowLeft",
  "ArrowRight",
  "ArrowLeft",
  "ArrowRight",
  "b",
  "a",
];

function navCommands(): Command[] {
  const go = (href: string) => () => {
    window.location.href = href;
  };
  return [
    { id: "home", label: "Go to Home", hint: "/", run: go("/") },
    { id: "projects", label: "Go to Projects", hint: "/projects", run: go("/projects/") },
    { id: "lab", label: "Go to Lab", hint: "/lab", run: go("/lab/") },
    { id: "arcade", label: "Go to Arcade", hint: "/arcade", run: go("/arcade/") },
    { id: "about", label: "Go to About", hint: "/about", run: go("/about/") },
    { id: "contact", label: "Go to Contact", hint: "/contact", run: go("/contact/") },
    { id: "notes", label: "Go to Field Notes", hint: "/field-notes", run: go("/field-notes/") },
  ];
}

function toggleCommands(): Command[] {
  return [
    {
      id: "toggle-crt",
      label: "Toggle CRT mode",
      hint: getCrtMode() ? "currently on" : "currently off",
      run: () => setCrtMode(!getCrtMode()),
    },
    {
      id: "toggle-motion",
      label: "Toggle low-motion mode",
      hint: getReducedEffects() ? "currently reduced" : "currently full",
      run: () => setReducedEffects(!getReducedEffects()),
    },
  ];
}

// Featured-project / random-project commands are injected via registerProjectCommands()
// once page-level project data is available (see /projects and /projects/[slug] pages),
// keeping this module itself free of any project-data import at the global-chrome level.
let extraCommands: Command[] = [];
export function registerProjectCommands(commands: Command[]): void {
  extraCommands = commands;
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
    return [...navCommands(), ...toggleCommands(), ...extraCommands];
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
        <span>${c.label}</span>
        ${c.hint ? `<span class="palette__item-hint">${c.hint}</span>` : ""}
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
  let konamiBuffer: string[] = [];
  function onGlobalKeydown(e: KeyboardEvent) {
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") {
      e.preventDefault();
      if (backdrop.hidden) open();
      else close();
      return;
    }

    // Konami code easter egg: toggles "arcade attract mode".
    // No-op entirely when reduced-motion is active, per spec.
    konamiBuffer.push(e.key);
    konamiBuffer = konamiBuffer.slice(-KONAMI_SEQUENCE.length);
    if (konamiBuffer.length === KONAMI_SEQUENCE.length && konamiBuffer.every((k, i) => k === KONAMI_SEQUENCE[i])) {
      konamiBuffer = [];
      if (!getReducedEffects()) {
        const html = document.documentElement;
        html.dataset.attract = html.dataset.attract === "true" ? "false" : "true";
      }
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
