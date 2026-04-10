(() => {
  const root = document.querySelector("[data-card-filters]");
  if (!root) {
    return;
  }

  const productButtons = [...root.querySelectorAll("[data-product-filter]")];
  const roleButtons = [...root.querySelectorAll("[data-role-filter]")];
  const cards = [...root.querySelectorAll("[data-card-item]")];
  const emptyState = root.querySelector("[data-filter-empty]");

  let activeProduct = "all";
  let activeRole = "all";

  function updateButtons(buttons, attribute, activeValue) {
    buttons.forEach((button) => {
      const value = button.getAttribute(attribute);
      button.classList.toggle("is-active", value === activeValue);
    });
  }

  function applyFilters() {
    let visibleCount = 0;

    cards.forEach((card) => {
      const product = card.getAttribute("data-product") || "";
      const roles = (card.getAttribute("data-roles") || "")
        .split(/\s+/)
        .filter(Boolean);
      const matchesProduct =
        activeProduct === "all" || product === activeProduct;
      const matchesRole = activeRole === "all" || roles.includes(activeRole);
      const isVisible = matchesProduct && matchesRole;
      card.classList.toggle("hidden", !isVisible);
      if (isVisible) {
        visibleCount += 1;
      }
    });

    if (emptyState) {
      emptyState.classList.toggle("hidden", visibleCount !== 0);
    }

    updateButtons(productButtons, "data-product-filter", activeProduct);
    updateButtons(roleButtons, "data-role-filter", activeRole);
  }

  productButtons.forEach((button) => {
    button.addEventListener("click", () => {
      activeProduct = button.getAttribute("data-product-filter") || "all";
      applyFilters();
    });
  });

  roleButtons.forEach((button) => {
    button.addEventListener("click", () => {
      activeRole = button.getAttribute("data-role-filter") || "all";
      applyFilters();
    });
  });

  applyFilters();
})();
