// Tiny client-side terminal for /lab. Never executes a real shell command —
// every "command" here is a lookup table entry that prints text or navigates
// to a page. Purely a website interaction.
import { getAllProjects } from "../lib/projects";

const OPEN_TARGETS: Record<string, string> = {
  "look-above": "/projects/look-above/",
  global_unrest: "/projects/global_unrest/",
  bird: "/projects/bird_acoustics/",
  arcade: "/arcade/",
};

const SKILLS = [
  "Rust",
  "C++",
  "Python",
  "TypeScript",
  "CUDA / parallel programming (learning)",
  "TinyML / ESP32",
  "SQLite / DuckDB",
  "OpenGL / wgpu / graphics",
  "Data visualization",
];

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
}

export function mount(root: HTMLElement): { destroy(): void } {
  root.innerHTML = `
    <div class="terminal-toy">
      <div class="terminal-toy__output" id="terminal-output" role="log" aria-live="polite"></div>
      <div class="terminal-toy__input-row">
        <span class="terminal-toy__prompt" aria-hidden="true">guest@arctanmyangle:~$</span>
        <label for="terminal-input" class="visually-hidden">Terminal command input</label>
        <input type="text" id="terminal-input" class="terminal-toy__input" autocomplete="off" spellcheck="false" />
      </div>
    </div>
  `;

  const output = root.querySelector("#terminal-output") as HTMLDivElement;
  const input = root.querySelector("#terminal-input") as HTMLInputElement;

  const history: string[] = [];
  let historyIndex = -1;

  function print(line: string, cls?: string) {
    const div = document.createElement("div");
    div.className = cls ? `terminal-toy__line ${cls}` : "terminal-toy__line";
    div.innerHTML = escapeHtml(line);
    output.appendChild(div);
    output.scrollTop = output.scrollHeight;
  }

  function runCommand(raw: string) {
    const trimmed = raw.trim();
    print(`guest@arctanmyangle:~$ ${trimmed}`, "terminal-toy__line--echo");
    if (!trimmed) return;

    const [cmd, ...args] = trimmed.split(/\s+/);

    switch (cmd) {
      case "help":
        print("Commands: help, ls, open <look-above|global_unrest|bird|arcade>, random, skills, clear");
        break;
      case "ls":
        for (const p of getAllProjects()) print(`  ${p.slug.padEnd(34)} ${p.category}`);
        break;
      case "open": {
        const target = args[0];
        const href = target ? OPEN_TARGETS[target] : undefined;
        if (href) {
          print(`opening ${target}...`);
          window.setTimeout(() => {
            window.location.href = href;
          }, 200);
        } else {
          print(`open: unknown target '${target ?? ""}' — try: look-above, global_unrest, bird, arcade`, "terminal-toy__line--error");
        }
        break;
      }
      case "random": {
        const all = getAllProjects();
        const pick = all[Math.floor(Math.random() * all.length)];
        if (pick) {
          print(`random pick: ${pick.slug} — opening...`);
          window.setTimeout(() => {
            window.location.href = `/projects/${pick.slug}/`;
          }, 200);
        }
        break;
      }
      case "skills":
        for (const s of SKILLS) print(`  - ${s}`);
        break;
      case "clear":
        output.innerHTML = "";
        break;
      default:
        print(`command not found: ${cmd} — try 'help'`, "terminal-toy__line--error");
    }
  }

  print("arcTanMyAngle terminal toy — type 'help' to begin.");

  function onKeydown(e: KeyboardEvent) {
    if (e.key === "Enter") {
      const value = input.value;
      if (value.trim()) {
        history.push(value);
        historyIndex = history.length;
      }
      input.value = "";
      runCommand(value);
    } else if (e.key === "ArrowUp") {
      if (historyIndex > 0) {
        historyIndex -= 1;
        input.value = history[historyIndex] ?? "";
        e.preventDefault();
      }
    } else if (e.key === "ArrowDown") {
      if (historyIndex < history.length - 1) {
        historyIndex += 1;
        input.value = history[historyIndex] ?? "";
      } else {
        historyIndex = history.length;
        input.value = "";
      }
      e.preventDefault();
    }
  }
  input.addEventListener("keydown", onKeydown);

  function focusInput() {
    input.focus();
  }
  root.addEventListener("click", focusInput);

  return {
    destroy() {
      input.removeEventListener("keydown", onKeydown);
      root.removeEventListener("click", focusInput);
    },
  };
}
