// Solo la vista se guarda. Los datos y filtros de clientes permanecen en memoria.
(() => {
  const get = (id) => document.getElementById(id),
    backend = window.PortfolioBackend;
  const form = get("clients-filter-panel"),
    wrap = get("clients-table-wrap");
  let filters = {},
    view = "list",
    options = {},
    loaded = false,
    restoring = null,
    generation = 0,
    changes = 0,
    queue = Promise.resolve(),
    reload = () => {};
  const number = new Intl.NumberFormat("es-ES", { maximumFractionDigits: 4 });
  function setView(next) {
    view = ["list", "cards", "compact"].includes(next) ? next : "list";
    wrap.dataset.view = view;
    document
      .querySelectorAll("[data-client-view]")
      .forEach((b) =>
        b.setAttribute("aria-pressed", String(b.dataset.clientView === view)),
      );
  }
  function populateProducts() {
    const company = form.elements.company.value,
      selected = form.elements.product.value;
    populate(
      form.elements.product,
      [
        ...new Set(
          (options.products || [])
            .filter((p) => !company || p.company === company)
            .map((p) => p.product),
        ),
      ],
      "Todos los productos",
      selected,
    );
  }
  function populate(select, values, label, selected) {
    select.replaceChildren(new Option(label, ""));
    values.forEach((value) => select.append(new Option(value, value)));
    if (selected && !values.includes(selected))
      select.append(new Option(selected, selected));
    select.value = selected || "";
  }
  function update(result) {
    options = result.options || {};
    populate(
      form.elements.company,
      options.companies || [],
      "Todas las compañías",
      form.elements.company.value,
    );
    populateProducts();
  }
  function describe() {
    const labels = {
      company: "Compañía",
      product: "Producto",
      category: "Tipo",
      min_units: "Desde U",
      max_units: "Hasta U",
      min_products: "Desde productos",
      max_products: "Hasta productos",
      sort: "Orden",
    };
    const values = {
      client: "Clientes",
      interested: "Interesados",
      other: "Otros",
      units: "Más unidades",
      products: "Más productos",
      recent: "Más recientes",
    };
    const host = get("clients-active-filters");
    host.replaceChildren();
    Object.entries(filters).forEach(([key, value]) => {
      const b = document.createElement("button");
      b.type = "button";
      b.textContent = labels[key] + ": " + (values[value] || value) + " ×";
      b.setAttribute("aria-label", "Quitar filtro " + labels[key]);
      b.onclick = () => {
        delete filters[key];
        form.elements[key].value = key === "sort" ? "name" : "";
        describe();
        reload();
      };
      host.append(b);
    });
    host.hidden = !Object.keys(filters).length;
    get("clients-filter-count").textContent = Object.keys(filters).length
      ? "· " + Object.keys(filters).length
      : "";
  }
  function clear() {
    filters = {};
    form.reset();
    form.elements.max_units.setCustomValidity("");
    form.elements.max_products.setCustomValidity("");
    describe();
  }
  form.addEventListener("submit", (event) => {
    event.preventDefault();
    const data = Object.fromEntries(new FormData(form)),
      next = {};
    for (const [key, value] of Object.entries(data)) {
      if (value === "" || (key === "sort" && value === "name")) continue;
      next[key] =
        key.startsWith("min_") || key.startsWith("max_") ? Number(value) : value;
    }
    for (const kind of ["units", "products"]) {
      if (
        next["min_" + kind] != null &&
        next["max_" + kind] != null &&
        next["min_" + kind] > next["max_" + kind]
      ) {
        form.elements["max_" + kind].setCustomValidity(
          "El máximo debe ser igual o superior al mínimo.",
        );
        form.reportValidity();
        return;
      }
    }
    filters = next;
    describe();
    reload();
  });
  form.addEventListener("input", () => {
    form.elements.max_units.setCustomValidity("");
    form.elements.max_products.setCustomValidity("");
  });
  form.elements.company.addEventListener("change", () => {
    form.elements.product.value = "";
    populateProducts();
  });
  get("clients-filter-clear").onclick = () => {
    clear();
    reload();
  };
  get("clients-filter-toggle").onclick = () => {
    form.hidden = !form.hidden;
    get("clients-filter-toggle").setAttribute("aria-expanded", String(!form.hidden));
  };
  document.querySelectorAll("[data-client-view]").forEach(
    (button) =>
      (button.onclick = () => {
        const next = button.dataset.clientView,
          ticket = generation;
        changes++;
        setView(next);
        get("clients-view-status").textContent = "Guardando tu vista…";
        queue = queue
          .catch(() => {})
          .then(async () => {
            if (ticket !== generation) return;
            try {
              await backend.saveClientViewPreference(next);
              if (ticket === generation && view === next)
                get("clients-view-status").textContent =
                  "Vista guardada para tus próximos accesos.";
            } catch {
              if (ticket === generation)
                get("clients-view-status").textContent =
                  "La vista está aplicada, pero no se ha podido guardar. Vuelve a elegirla para reintentar.";
            }
          });
      }),
  );
  async function restore() {
    if (loaded) return;
    if (restoring) return restoring;
    const ticket = generation,
      version = changes;
    restoring = (async () => {
      try {
        const saved = await backend.getClientViewPreference();
        if (ticket === generation && version === changes) setView(saved);
      } catch {
      } finally {
        if (ticket === generation) {
          loaded = true;
          restoring = null;
        }
      }
    })();
    return restoring;
  }
  function reset() {
    generation++;
    changes++;
    loaded = false;
    restoring = null;
    options = {};
    clear();
    populate(form.elements.company, [], "Todas las compañías", "");
    populate(form.elements.product, [], "Todos los productos", "");
    setView("list");
    form.hidden = true;
    get("clients-filter-toggle").setAttribute("aria-expanded", "false");
    get("clients-view-status").textContent = "";
  }
  function demoResult(rows, search) {
    const normalize = window.ClientImport.normalize,
      f = filters;
    const matched = rows.filter((r) => {
      const count = r.product_count || 0,
        units = r.total_units || 0;
      return (
        normalize(Object.values(r).join(" ")).includes(normalize(search)) &&
        (!f.company || (r.companies || []).includes(f.company)) &&
        (!f.product || (r.products || []).includes(f.product)) &&
        (!f.category ||
          (r.category ||
            { cliente: "client", interesado: "interested" }[normalize(r.client_type)] ||
            "other") === f.category) &&
        (f.min_units == null || units >= f.min_units) &&
        (f.max_units == null || units <= f.max_units) &&
        (f.min_products == null || count >= f.min_products) &&
        (f.max_products == null || count <= f.max_products)
      );
    });
    return matched.sort((a, b) => {
      const rank = (r) => ({ cliente: 0, interesado: 1 })[normalize(r.client_type)] ?? 2;
      return (
        rank(a) - rank(b) ||
        (f.sort === "units"
          ? (b.total_units || 0) - (a.total_units || 0)
          : f.sort === "products"
            ? (b.product_count || 0) - (a.product_count || 0)
            : 0) ||
        a.last_name.localeCompare(b.last_name, "es")
      );
    });
  }
  function summary(row) {
    const el = document.createElement("span");
    el.className = "client-portfolio-summary";
    const count = Number(row.product_count || 0),
      units = Number(row.total_units || 0);
    const strong = document.createElement("strong");
    strong.textContent = number.format(units) + " U";
    const small = document.createElement("small");
    small.textContent =
      count +
      (count === 1 ? " producto" : " productos") +
      (row.pending_units ? " · Unidades pendientes" : "");
    el.append(strong, small);
    return el;
  }
  document
    .querySelectorAll("[data-client-tab]")
    .forEach((button) => (button.onclick = () => detailTab(button.dataset.clientTab)));
  function detailTab(tab = "products") {
    if (tab === "contact")
      get("client-detail-fields")
        .querySelector(".client-additional")
        ?.setAttribute("open", "");
    get("client-detail-fields").hidden = tab !== "contact";
    get("client-products-section").hidden = tab !== "products";
    get("client-detail-fields").closest(".client-file-layout").dataset.tab = tab;
    document
      .querySelectorAll("[data-client-tab]")
      .forEach((b) =>
        b.setAttribute("aria-pressed", String(b.dataset.clientTab === tab)),
      );
  }
  setView("list");
  window.ClientWorkspace = {
    restore,
    reset,
    update,
    summary,
    detailTab,
    demoResult,
    filters: () => structuredClone(filters),
    changed: () => {
      if (Object.keys(filters).length) reload();
    },
    init: (fn) => (reload = fn),
  };
})();
