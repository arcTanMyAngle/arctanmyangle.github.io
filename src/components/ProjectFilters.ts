// Client-side search/filter/sort controller for /projects. The grid itself
// is fully server-rendered (static output, no client fetch) — this module
// only ever shows/hides and reorders the already-rendered .project-card
// nodes, it never builds cards from data.
import { getLastProjectCategory, setLastProjectCategory } from "../lib/clientState";

export interface ProjectFiltersOptions {
  gridId: string;
}

type SortKey = "updated-desc" | "stars-desc" | "name-asc";

export function mount(root: HTMLElement, options: ProjectFiltersOptions): { destroy(): void } {
  const grid = document.getElementById(options.gridId);
  const empty = document.getElementById(`${options.gridId}-empty`);
  if (!grid) return { destroy() {} };

  const gridEl = grid;
  const cards = Array.from(gridEl.querySelectorAll<HTMLElement>(".project-card"));
  const search = root.querySelector<HTMLInputElement>("#project-search");
  const category = root.querySelector<HTMLSelectElement>("#project-category");
  const status = root.querySelector<HTMLSelectElement>("#project-status");
  const sort = root.querySelector<HTMLSelectElement>("#project-sort");
  const count =
    root.querySelector<HTMLElement>("[data-result-count]") ??
    document.querySelector<HTMLElement>("[data-result-count]");
  // Two places offer a reset: the toolbar and the empty state.
  const resets = [
    ...root.querySelectorAll<HTMLButtonElement>("[data-filter-reset]"),
    ...document.querySelectorAll<HTMLButtonElement>("[data-filter-reset]"),
  ].filter((el, i, arr) => arr.indexOf(el) === i);

  const savedCategory = getLastProjectCategory();
  if (category && savedCategory && [...category.options].some((o) => o.value === savedCategory)) {
    category.value = savedCategory;
  }

  function filtersActive(): boolean {
    return Boolean(
      (search?.value ?? "").trim() ||
        (category && category.value !== "all") ||
        (status && status.value !== "all"),
    );
  }

  function apply() {
    const query = (search?.value ?? "").trim().toLowerCase();
    const categoryValue = category?.value ?? "all";
    const statusValue = status?.value ?? "all";
    const sortKey = (sort?.value as SortKey) ?? "updated-desc";

    let visibleCount = 0;
    for (const card of cards) {
      const matchesQuery = !query || (card.dataset.search ?? "").includes(query);
      const matchesCategory = categoryValue === "all" || card.dataset.category === categoryValue;
      const matchesStatus = statusValue === "all" || card.dataset.status === statusValue;
      const visible = matchesQuery && matchesCategory && matchesStatus;
      card.hidden = !visible;
      if (visible) visibleCount += 1;
    }

    const sorted = [...cards].sort((a, b) => {
      if (sortKey === "stars-desc") return Number(b.dataset.stars) - Number(a.dataset.stars);
      if (sortKey === "name-asc") return (a.dataset.slug ?? "").localeCompare(b.dataset.slug ?? "");
      return new Date(b.dataset.updated ?? 0).getTime() - new Date(a.dataset.updated ?? 0).getTime();
    });
    for (const card of sorted) gridEl.appendChild(card);

    if (empty) empty.hidden = visibleCount > 0;
    if (count) {
      count.textContent =
        visibleCount === cards.length
          ? `${cards.length} repositories`
          : `${visibleCount} of ${cards.length} repositories`;
    }
    const active = filtersActive();
    for (const reset of resets) reset.hidden = !active;
  }

  function onCategoryChange() {
    if (category) setLastProjectCategory(category.value);
    apply();
  }

  function onReset() {
    if (search) search.value = "";
    if (category) category.value = "all";
    if (status) status.value = "all";
    setLastProjectCategory("all");
    apply();
    search?.focus();
  }

  search?.addEventListener("input", apply);
  status?.addEventListener("change", apply);
  sort?.addEventListener("change", apply);
  category?.addEventListener("change", onCategoryChange);
  for (const reset of resets) reset.addEventListener("click", onReset);

  apply();

  return {
    destroy() {
      search?.removeEventListener("input", apply);
      status?.removeEventListener("change", apply);
      sort?.removeEventListener("change", apply);
      category?.removeEventListener("change", onCategoryChange);
      for (const reset of resets) reset.removeEventListener("click", onReset);
    },
  };
}
