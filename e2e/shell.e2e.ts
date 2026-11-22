// Shell, keyboard and accessibility checks on every built route (PLAN §4 and §5 M1: A-A11Y-01 skip link, landmarks,
// focus order; T-M1-04 axe on all shell routes). Routes come from the built sitemap, so a new page is covered the
// moment it ships. Fails on axe "serious" or "critical" (PLAN §4 "Accessible"); lesser findings are annotations.
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page, type TestInfo } from "@playwright/test";

type Theme = "dark" | "light";

interface FocusInfo {
  done: boolean;
  id: number;
  desc: string;
  /** -1 skip link, 0 header, 1 main, 2 footer, 9 outside every landmark. */
  rank: number;
  sized: boolean;
  inView: boolean;
  unobscured: boolean;
  /** null when the element had no baseline (added after load). */
  changed: boolean | null;
}

declare global {
  interface Window {
    __atmaCsp: string[];
    __atmaBaseline: () => number;
    __atmaFocus: () => FocusInfo;
  }
}

const sitemap = fileURLToPath(new URL("../dist/sitemap-0.xml", import.meta.url));
if (!existsSync(sitemap)) throw new Error("dist/sitemap-0.xml is missing: run `bun run build` before `bun run e2e`.");
const routes = [...readFileSync(sitemap, "utf8").matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => new URL(m[1]).pathname);
if (routes.length === 0) throw new Error("dist/sitemap-0.xml lists no routes.");

const AXE_TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa", "best-practice"];
const MAX_STOPS = 400;

// Runs in the page before any of its own scripts (and, being CDP-injected, outside its CSP). Self-contained: Playwright
// serialises the function, so it can't close over anything in this file.
function instrument() {
  window.__atmaCsp = [];
  document.addEventListener("securitypolicyviolation", (e) => {
    window.__atmaCsp.push(`${e.effectiveDirective} blocked ${e.blockedURI || "inline"} at ${e.sourceFile}:${e.lineNumber}`);
  });

  // What can show focus: the element itself and its pseudo-elements, a ring drawn on a near ancestor (the card pattern,
  // `.card:has(.card__link:focus-visible)`), or a styled next sibling (a visually hidden input before its label).
  const OWN = [
    "outline-style",
    "outline-width",
    "outline-color",
    "box-shadow",
    "border-top-color",
    "border-bottom-color",
    "background-color",
    "color",
    "text-decoration-line",
    "text-decoration-color",
  ];
  const RING = ["outline-style", "outline-width", "outline-color", "box-shadow"];
  const read = (el: Element, pseudo: string | null, props: string[]) => {
    const cs = getComputedStyle(el, pseudo);
    return props.map((p) => cs.getPropertyValue(p)).join("|");
  };
  const fingerprint = (el: Element) => {
    const parts = [read(el, null, OWN), read(el, "::before", OWN), read(el, "::after", OWN)];
    let up = el.parentElement;
    for (let i = 0; i < 3 && up; i++, up = up.parentElement) parts.push(read(up, null, RING));
    if (el.nextElementSibling) parts.push(read(el.nextElementSibling, null, OWN));
    return parts.join(" / ");
  };

  const baseline = new WeakMap<Element, string>();
  const ids = new WeakMap<Element, number>();
  let nextId = 0;

  window.__atmaBaseline = () => {
    const all = document.querySelectorAll("a[href], button, input, select, textarea, summary, iframe, [tabindex], [contenteditable]");
    all.forEach((el) => {
      if (el !== document.activeElement) baseline.set(el, fingerprint(el));
    });
    return all.length;
  };

  window.__atmaFocus = () => {
    const el = document.activeElement;
    if (!el || el === document.body || el === document.documentElement) {
      return { done: true, id: -1, desc: "", rank: 9, sized: false, inView: false, unobscured: false, changed: null };
    }
    let id = ids.get(el);
    if (id === undefined) ids.set(el, (id = ++nextId));

    const cls = typeof el.className === "string" && el.className.trim() ? "." + el.className.trim().split(/\s+/).slice(0, 2).join(".") : "";
    const label = (el.getAttribute("aria-label") || el.textContent || "").trim().replace(/\s+/g, " ").slice(0, 40);
    const desc = `${el.tagName.toLowerCase()}${el.id ? "#" + el.id : ""}${cls} "${label}"`;

    const header = document.querySelector(".site-header");
    const main = document.getElementById("main");
    const footer = document.querySelector(".site-footer");
    const rank = el.matches("a.skip") ? -1 : header?.contains(el) ? 0 : main?.contains(el) ? 1 : footer?.contains(el) ? 2 : 9;

    const r = el.getBoundingClientRect();
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const sized = r.width > 0 && r.height > 0;
    const inView = sized && r.right > 0 && r.bottom > 0 && r.left < vw && r.top < vh;
    // WCAG 2.4.11 (AA): not entirely hidden. Any of five sample points landing on the element (or inside it) passes.
    let unobscured = false;
    if (inView) {
      const ix = Math.min(4, r.width / 4);
      const iy = Math.min(4, r.height / 4);
      const points: [number, number][] = [
        [(r.left + r.right) / 2, (r.top + r.bottom) / 2],
        [r.left + ix, r.top + iy],
        [r.right - ix, r.top + iy],
        [r.left + ix, r.bottom - iy],
        [r.right - ix, r.bottom - iy],
      ];
      unobscured = points.some(([x, y]) => {
        if (x < 0 || y < 0 || x >= vw || y >= vh) return false;
        const hit = document.elementFromPoint(x, y);
        return !!hit && (el.contains(hit) || hit.contains(el));
      });
    }

    const before = baseline.get(el);
    const changed = before === undefined ? null : before !== fingerprint(el);
    return { done: false, id, desc, rank, sized, inView, unobscured, changed };
  };
}

interface Watch {
  errors: string[];
  external: string[];
}

/** Opens `path` in `theme` with the instrumentation in place, collecting console errors and off-site requests. */
async function open(page: Page, path: string, theme: Theme): Promise<{ status: number; csp: string | null; watch: Watch }> {
  const watch: Watch = { errors: [], external: [] };
  page.on("console", (m) => m.type() === "error" && watch.errors.push(`console: ${m.text()}`));
  page.on("pageerror", (e) => watch.errors.push(`pageerror: ${e.message}`));
  page.on("request", (r) => {
    const u = new URL(r.url());
    if ((u.protocol === "http:" || u.protocol === "https:") && u.hostname !== "localhost") watch.external.push(r.url());
  });
  await page.addInitScript(instrument);
  await page.addInitScript((t: Theme) => {
    try {
      localStorage.setItem("atma:theme", t);
    } catch {
      // about:blank and opaque origins have no storage.
    }
  }, theme);
  const res = await page.goto(path);
  if (!res) throw new Error(`no response for ${path}`);
  await page.waitForLoadState("networkidle");
  return { status: res.status(), csp: res.headers()["content-security-policy"] ?? null, watch };
}

async function expectNoSeriousAxe(page: Page, testInfo: TestInfo) {
  const results = await new AxeBuilder({ page }).withTags(AXE_TAGS).analyze();
  const blocking = results.violations.filter((v) => v.impact === "serious" || v.impact === "critical");
  for (const v of results.violations) {
    if (blocking.includes(v)) continue;
    testInfo.annotations.push({ type: `axe ${v.impact ?? "minor"}`, description: `${v.id}: ${v.help} (${v.nodes.length})` });
  }
  if (results.incomplete.length) {
    testInfo.annotations.push({
      type: "axe needs review",
      description: results.incomplete.map((v) => `${v.id} (${v.nodes.length})`).join(", "),
    });
  }
  const report = blocking.map(
    (v) =>
      `${v.impact} ${v.id}: ${v.help}\n` +
      v.nodes
        .slice(0, 8)
        .map((n) => `    ${n.target.join(" ")}\n      ${(n.failureSummary ?? "").replace(/\n/g, "\n      ")}`)
        .join("\n")
  );
  expect(report, "axe serious/critical violations").toEqual([]);
}

for (const path of routes) {
  test.describe(path, () => {
    for (const theme of ["dark", "light"] as const) {
      test(`axe, ${theme} theme`, async ({ page }, testInfo) => {
        test.skip(theme === "light" && testInfo.project.name === "mobile", "light contrast is checked at desktop width");
        await open(page, path, theme);
        await expect(page.locator("html")).toHaveAttribute("data-theme", theme);
        await expectNoSeriousAxe(page, testInfo);
      });
    }

    test("shell: status, CSP, landmarks, skip link, clean console", async ({ page }) => {
      const { status, csp, watch } = await open(page, path, "dark");
      expect(status).toBe(200);
      expect(csp, "content-security-policy header").toBeTruthy();

      await expect(page.getByRole("banner")).toHaveCount(1);
      await expect(page.getByRole("main")).toHaveCount(1);
      await expect(page.getByRole("contentinfo")).toHaveCount(1);
      await expect(page.getByRole("navigation", { name: "Main", includeHidden: true })).toHaveCount(1);
      await expect(page.locator("h1")).toHaveCount(1);

      // A-A11Y-01: the first Tab lands on the skip link, it shows, and it moves focus into <main>.
      await page.keyboard.press("Tab");
      const skip = page.locator("a.skip");
      await expect(skip).toBeFocused();
      await expect(skip).toHaveAttribute("href", "#main");
      await expect(skip).toBeInViewport();
      await page.keyboard.press("Enter");
      await expect(page.locator("#main")).toBeFocused();

      expect(await page.evaluate(() => window.__atmaCsp), "CSP violations").toEqual([]);
      expect(watch.errors, "console errors").toEqual([]);
      expect(watch.external, "off-site requests on load").toEqual([]);
    });

    test("keyboard: focus order, visible, not obscured", async ({ page }, testInfo) => {
      test.skip(testInfo.project.name !== "desktop", "the full Tab walk runs once, at desktop width");
      await open(page, path, "dark");
      await page.evaluate(() => window.__atmaBaseline());

      const problems: string[] = [];
      let lastRank = -1;
      let lastId = -1;
      let stops = 0;
      for (; stops < MAX_STOPS; stops++) {
        await page.keyboard.press("Tab");
        const f = await page.evaluate(() => window.__atmaFocus());
        if (f.done || (stops > 0 && f.rank === -1)) break; // left the page, or wrapped back to the skip link
        if (stops === 0 && f.rank !== -1) problems.push(`first stop is ${f.desc}, not the skip link`);
        if (f.id === lastId) {
          problems.push(`focus trap: Tab stays on ${f.desc}`);
          break;
        }
        if (f.rank === 9) problems.push(`${f.desc} is outside the header, main and footer`);
        else if (f.rank < lastRank) problems.push(`${f.desc} comes after a later landmark (order ${lastRank} → ${f.rank})`);
        if (!f.sized) problems.push(`${f.desc} has no size`);
        else if (!f.inView) problems.push(`${f.desc} is focused off screen`);
        else if (!f.unobscured) problems.push(`${f.desc} is hidden behind something`);
        if (f.changed === false) problems.push(`${f.desc} shows no focus indicator`);
        lastRank = Math.max(lastRank, f.rank === 9 ? lastRank : f.rank);
        lastId = f.id;
      }
      if (stops >= MAX_STOPS) problems.push(`more than ${MAX_STOPS} Tab stops: focus never left the page`);
      testInfo.annotations.push({ type: "tab stops", description: String(stops) });
      expect(problems).toEqual([]);
    });

    test("phone menu opens, shows the nav and closes on Escape", async ({ page }, testInfo) => {
      test.skip(testInfo.project.name !== "mobile", "the menu button only shows at phone width");
      await open(page, path, "dark");
      const button = page.locator("[data-menu-toggle]");
      const firstLink = page.locator("#site-nav a").first();
      await expect(button).toBeVisible();
      await expect(button).toHaveAttribute("aria-expanded", "false");
      await expect(firstLink).toBeHidden();

      await button.click();
      await expect(button).toHaveAttribute("aria-expanded", "true");
      await expect(button).toHaveAccessibleName("Close menu");
      await expect(firstLink).toBeVisible();

      await page.keyboard.press("Escape");
      await expect(button).toHaveAttribute("aria-expanded", "false");
      await expect(button).toBeFocused();
      await expect(firstLink).toBeHidden();
    });
  });
}

test("unknown path serves the 404 page with status 404", async ({ page }, testInfo) => {
  const { status } = await open(page, "/no-such-page/", "dark");
  expect(status).toBe(404);
  await expect(page.locator("h1")).toHaveCount(1);
  await expectNoSeriousAxe(page, testInfo);
});
