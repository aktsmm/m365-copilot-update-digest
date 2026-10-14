(() => {
  const roots = [...document.querySelectorAll("[data-card-filters]")];
  if (roots.length === 0) {
    return;
  }

  const FILTERS = [
    { attr: "data-product-filter", card: "data-product", multi: false },
    { attr: "data-role-filter", card: "data-roles", multi: true },
    { attr: "data-source-filter", card: "data-source-type", multi: false },
    { attr: "data-category-filter", card: "data-categories", multi: true },
    { attr: "data-importance-filter", card: "data-importance", multi: false, atLeast: ["high", "notable"] },
  ];

  roots.forEach((root) => {
    const cards = [...root.querySelectorAll("[data-card-item]")];
    const emptyState = root.querySelector("[data-filter-empty]");
    const state = FILTERS.map((filter) => ({
      ...filter,
      buttons: [...root.querySelectorAll(`[${filter.attr}]`)],
      active: "all",
    }));

    function matches(card, filter) {
      if (filter.active === "all") {
        return true;
      }
      const value = card.getAttribute(filter.card) || "";
      if (filter.atLeast) {
        // 「注目」は重要も含む（上位レベルほど広く拾う）
        const rank = filter.atLeast.indexOf(value);
        return rank >= 0 && rank <= filter.atLeast.indexOf(filter.active);
      }
      return filter.multi ? value.split(/\s+/).filter(Boolean).includes(filter.active) : value === filter.active;
    }

    function applyFilters() {
      let visibleCount = 0;
      cards.forEach((card) => {
        const isVisible = state.every((filter) => matches(card, filter));
        card.classList.toggle("hidden", !isVisible);
        if (isVisible) {
          visibleCount += 1;
        }
      });

      if (emptyState) {
        emptyState.classList.toggle("hidden", visibleCount !== 0);
      }

      state.forEach((filter) => {
        filter.buttons.forEach((button) => {
          button.classList.toggle("is-active", button.getAttribute(filter.attr) === filter.active);
        });
      });
    }

    state.forEach((filter) => {
      filter.buttons.forEach((button) => {
        button.addEventListener("click", () => {
          filter.active = button.getAttribute(filter.attr) || "all";
          applyFilters();
        });
      });
    });

    applyFilters();
  });
})();
