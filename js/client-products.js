// Productos contratados de la ficha. Los permisos reales se aplican en Supabase.
(() => {
  const backend = window.PortfolioBackend,
    host = document.getElementById("client-products-section");
  let epoch = 0,
    client = null,
    demo = false,
    rows = [],
    editing = null,
    busy = false,
    selected = new Set();
  const node = (tag, text, cls) => {
    const n = document.createElement(tag);
    if (text !== undefined) n.textContent = text;
    if (cls) n.className = cls;
    return n;
  };
  const euro = (value) =>
    new Intl.NumberFormat("es-ES", { style: "currency", currency: "EUR" }).format(value);
  const button = (text, fn, cls = "panel-secondary") => {
    const b = node("button", text, cls);
    b.type = "button";
    b.addEventListener("click", fn);
    return b;
  };
  function reset() {
    epoch++;
    client = null;
    rows = [];
    editing = null;
    busy = false;
    selected.clear();
    host.replaceChildren();
  }
  function say(text) {
    const p = host.querySelector('[role="status"]');
    if (p) {
      p.textContent = text;
      p.hidden = !text;
    }
  }
  async function open(row, isDemo = false) {
    reset();
    client = row;
    demo = isDemo;
    const ticket = epoch;
    render();
    say("Cargando productos…");
    if (demo) {
      rows = [];
      say("En el ejemplo puedes probar el editor. Los cambios no se guardan.");
      return;
    }
    try {
      const list = await backend.listClientProducts(row.id);
      if (ticket !== epoch) return;
      rows = list;
      render();
    } catch {
      if (ticket === epoch)
        say(
          "No se han podido cargar los productos. Cierra y vuelve a abrir la ficha para reintentar.",
        );
    }
  }
  function field(form, label, key, value, opts = {}) {
    const wrap = node("label", label);
    const input = node(opts.options ? "select" : "input");
    input.name = key;
    input.required = !!opts.required;
    if (opts.options)
      opts.options.forEach(([v, t]) => {
        const o = node("option", t);
        o.value = v;
        input.append(o);
      });
    else {
      input.type = opts.type || "text";
      if (input.type === "number") {
        input.min = "0";
        input.max = "100000000";
        input.step = key === "units" ? "0.0001" : "0.01";
        input.inputMode = "decimal";
      } else input.maxLength = key === "company" ? 120 : 160;
    }
    input.value = value ?? "";
    if (key === "company") input.setAttribute("list", "contract-companies");
    wrap.append(input);
    form.append(wrap);
    return input;
  }
  function render() {
    host.replaceChildren();
    if (!client) return;
    selected.clear();
    const heading = node("div", undefined, "client-products-heading");
    heading.append(
      node("div", "PRODUCTOS CONTRATADOS", "eyebrow"),
      node("h3", "Compañías y productos."),
    );
    host.append(heading);
    const note = node("p");
    note.setAttribute("role", "status");
    note.hidden = true;
    host.append(note);
    const metrics = node("div", undefined, "contract-metrics");
    const monthly = rows
        .filter((r) => r.payment_type === "monthly")
        .reduce((s, r) => s + Number(r.amount), 0),
      single = rows
        .filter((r) => r.payment_type === "single")
        .reduce((s, r) => s + Number(r.amount), 0);
    [
      ["Productos", String(rows.length)],
      ["Aportación mensual", euro(monthly)],
      ["Aportaciones únicas", euro(single)],
    ].forEach(([label, value]) => {
      const box = node("article");
      box.append(node("small", label), node("strong", value));
      metrics.append(box);
    });
    host.append(metrics);
    const controls = node("div", undefined, "contract-actions");
    controls.append(
      button("+ Añadir producto", () => {
        editing = {};
        editor();
      }),
    );
    const remove = button(
      "Eliminar seleccionados",
      async () => {
        if (
          busy ||
          !selected.size ||
          !confirm(
            `¿Eliminar ${selected.size} productos contratados seleccionados? También se eliminarán sus unidades y comisiones de las estadísticas.`,
          )
        )
          return;
        const ticket = epoch;
        busy = true;
        remove.disabled = true;
        try {
          if (demo) {
            rows = rows.filter((r) => !selected.has(r.id));
            render();
          } else {
            await backend.deleteClientProducts(client.id, [...selected]);
            if (ticket === epoch) await reload();
          }
        } catch {
          if (ticket === epoch)
            say(
              "No se ha podido confirmar la eliminación. Reabre la ficha para actualizarla.",
            );
        } finally {
          if (ticket === epoch) {
            busy = false;
            remove.disabled = !selected.size;
          }
        }
      },
      "invitation-delete",
    );
    remove.disabled = true;
    const bulk = node("div", undefined, "contract-actions contract-bulk");
    bulk.hidden = true;
    bulk.append(remove);
    controls.append(bulk);
    if (rows.length) {
      const all = node("label", "Seleccionar todos");
      const check = node("input");
      check.type = "checkbox";
      check.addEventListener("change", () => {
        host.querySelectorAll(".contract-card input[type=checkbox]").forEach((c) => {
          c.checked = check.checked;
          c.dispatchEvent(new Event("change"));
        });
      });
      all.prepend(check);
      bulk.append(all);
    }
    host.append(controls);
    const list = node("div", undefined, "contract-list");
    const companies = new Map();
    rows.forEach((row) => {
      const label = window.PortfolioCompanies.label(row.company);
      if (!companies.has(label)) {
        const section = node("section", undefined, "contract-company");
        const heading = node("header", undefined, "contract-company-heading");
        const company = window.PortfolioCompanies.find(label);
        if (company) {
          const logo = node("img");
          logo.src = "../assets/companies/" + company.logo;
          logo.alt = "";
          logo.dataset.company = company.id;
          heading.append(logo);
        }
        heading.append(node("h4", label));
        const count = rows.filter(
          (r) => window.PortfolioCompanies.label(r.company) === label,
        ).length;
        heading.append(node("small", count + (count === 1 ? " producto" : " productos")));
        section.append(heading);
        list.append(section);
        companies.set(label, section);
      }
      const card = node("article", undefined, "contract-card"),
        check = node("input");
      check.type = "checkbox";
      check.setAttribute("aria-label", "Seleccionar producto " + row.product);
      check.addEventListener("change", () => {
        check.checked ? selected.add(row.id) : selected.delete(row.id);
        remove.disabled = !selected.size || busy;
        bulk.hidden = !selected.size;
      });
      const copy = node("div", undefined, "contract-copy");
      copy.append(node("h5", row.product));
      const dl = node("dl");
      [
        ["Cartera de fondos", row.portfolio || "Sin indicar"],
        ["Fecha de firma", row.signed_on || "Pendiente · No cuenta en estadísticas"],
        [
          "Multiplicador al firmar",
          row.signed_multiplier == null ? "Pendiente" : "×" + row.signed_multiplier,
        ],
        [
          row.payment_type === "monthly" ? "Aportación mensual" : "Aportación única",
          euro(row.amount) + (row.payment_type === "monthly" ? " / mes" : ""),
        ],
        [
          "Unidades generadas",
          row.units == null
            ? "Sin indicar"
            : new Intl.NumberFormat("es-ES", { maximumFractionDigits: 4 }).format(
                row.units,
              ),
        ],
      ].forEach(([label, value]) => {
        const item = node("div");
        item.append(node("dt", label), node("dd", value));
        dl.append(item);
      });
      copy.append(dl);
      card.append(
        check,
        copy,
        button("Editar", () => {
          editing = row;
          editor();
        }),
      );
      companies.get(window.PortfolioCompanies.label(row.company)).append(card);
    });
    host.append(list);
    if (!rows.length)
      host.append(
        node(
          "p",
          "Todavía no hay productos añadidos. Puedes registrar el primero con «Añadir producto».",
          "contract-empty",
        ),
      );
    const editorHost = node("div");
    editorHost.id = "client-product-editor";
    host.append(editorHost);
    if (editing) editor();
    if (demo) say("Datos de ejemplo: los productos añadidos aquí no se guardan.");
  }
  async function reload() {
    const ticket = epoch,
      list = await backend.listClientProducts(client.id);
    if (ticket !== epoch) return;
    rows = list;
    editing = null;
    render();
  }
  async function editor() {
    const box = document.getElementById("client-product-editor");
    box.replaceChildren();
    if (!editing) return;
    const selectedProduct = editing,
      ticket = epoch;
    box.textContent = "Preparando los datos de la firma…";
    let me, directory;
    try {
      [me, directory] = demo
        ? [{ user_id: "demo" }, []]
        : await Promise.all([backend.getMyTeamProfile(), backend.listTeam()]);
    } catch {
      if (ticket === epoch && selectedProduct === editing)
        box.textContent =
          "No se ha podido preparar la firma. Pulsa Editar o Añadir producto para reintentar.";
      return;
    }
    if (ticket !== epoch || selectedProduct !== editing) return;
    box.replaceChildren();
    const form = node("form", undefined, "contract-editor"),
      grid = node("div", undefined, "contract-fields");
    form.append(
      node("h4", editing.id ? "Editar producto contratado" : "Nuevo producto contratado"),
    );
    const conditions = node("section", undefined, "product-conditions");
    const picker = window.ProductPicker.mount(form, editing, conditions);
    conditions.append(node("h5", "Condiciones del contrato"));
    field(grid, "Tipo de aportación", "payment_type", editing.payment_type || "monthly", {
      options: [
        ["monthly", "Mensual · €/mes"],
        ["single", "Aportación única"],
      ],
    });
    field(grid, "Importe en euros", "amount", editing.amount, {
      type: "number",
      required: true,
    });
    field(grid, "Unidades generadas (opcional)", "units", editing.units, {
      type: "number",
    });
    conditions.append(grid);
    const signature = node("fieldset", undefined, "contract-signature");
    signature.append(
      node("legend", "Producción de esta firma"),
      node(
        "p",
        "La aportación del cliente y tu comisión son importes diferentes. Las unidades cuentan una vez, en el mes de firma. Confirma los multiplicadores de entonces; si no los conoces, déjalos pendientes.",
      ),
    );
    const signed = field(signature, "Fecha de firma", "signed_on", editing.signed_on, {
      type: "date",
    });
    signed.min = "2000-01-01";
    signed.max = new Intl.DateTimeFormat("sv-SE", {
      timeZone: "Atlantic/Canary",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(new Date());
    const multipliers = [
      ["", "Pendiente de confirmar"],
      ...[2, 2.5, 3.5, 4.5, 5, 5.5, 6].map((v) => [String(v), "×" + v]),
    ];
    field(
      signature,
      "Tu multiplicador al firmar",
      "signed_multiplier",
      editing.signed_multiplier,
      { options: multipliers },
    );
    const structure = node("details"),
      rates = {};
    structure.append(node("summary", "Multiplicadores de los responsables al firmar"));
    if (editing.signed_on) Object.assign(rates, editing.signature_rates || {});
    else {
      const seen = new Set([me.user_id]);
      let parent =
        directory.find((p) => p.user_id === me.user_id)?.manager_id || me.manager_id;
      while (parent && !seen.has(parent)) {
        seen.add(parent);
        rates[parent] = null;
        parent = directory.find((p) => p.user_id === parent)?.manager_id;
      }
    }
    Object.entries(rates).forEach(([id, value]) => {
      const person = directory.find((p) => p.user_id === id);
      field(
        structure,
        person?.name ||
          ((person?.first_name || "") + " " + (person?.last_name || "")).trim() ||
          "Responsable de la firma",
        "rate_" + id,
        value,
        { options: multipliers },
      );
    });
    if (!Object.keys(rates).length)
      structure.append(node("p", "Esta firma no tiene responsables por encima."));
    if (!editing.signed_on)
      structure.append(
        node(
          "p",
          "La estructura propuesta es la actual. Si era diferente en la fecha de firma, revísala antes de registrar este producto.",
        ),
      );
    signature.append(structure);
    const confirmation = node(
      "label",
      "He revisado los multiplicadores de la fecha de firma. Los que dejo pendientes no generarán un importe calculado.",
    );
    const check = node("input");
    check.type = "checkbox";
    check.required = !!signed.value;
    signed.addEventListener("change", () => (check.required = !!signed.value));
    confirmation.prepend(check);
    signature.append(confirmation);
    conditions.append(signature);
    form.append(conditions);
    const actions = node("div", undefined, "contract-actions"),
      save = node("button", "Guardar producto", "btn");
    save.type = "submit";
    actions.append(
      save,
      button("Cancelar", () => {
        editing = null;
        box.replaceChildren();
      }),
    );
    form.append(actions);
    box.append(form);
    requestAnimationFrame(() => {
      if (form.isConnected) {
        form.scrollIntoView({
          block: "nearest",
          behavior: matchMedia("(prefers-reduced-motion: reduce)").matches
            ? "instant"
            : "smooth",
        });
        form
          .querySelector(
            ".product-company-options input:checked, .product-company-options input",
          )
          ?.focus({ preventScroll: true });
      }
    });
    form.addEventListener("submit", async (event) => {
      event.preventDefault();
      if (busy || !client) return;
      const values = Object.fromEntries(new FormData(form));
      const selection = picker.read(values);
      const fields = {
        company: window.PortfolioCompanies.label(selection.company),
        product: selection.product.trim(),
        portfolio: selection.portfolio.trim(),
        payment_type: values.payment_type,
        amount: Number(values.amount),
        units: values.units === "" ? null : Number(values.units),
        signed_on: values.signed_on || null,
        signed_multiplier:
          values.signed_multiplier === "" ? null : Number(values.signed_multiplier),
        signature_rates: Object.fromEntries(
          Object.keys(rates).map((id) => [
            id,
            values["rate_" + id] === "" ? null : Number(values["rate_" + id]),
          ]),
        ),
      };
      const ticket = epoch,
        target = client.id,
        id = editing.id || null;
      busy = true;
      save.disabled = true;
      try {
        if (demo) {
          const row = { ...fields, id: id || crypto.randomUUID(), client_id: target };
          rows = id ? rows.map((r) => (r.id === id ? row : r)) : [row, ...rows];
          editing = null;
          render();
        } else {
          await backend.saveClientProduct(target, fields, id);
          if (ticket === epoch) await reload();
        }
      } catch {
        if (ticket === epoch)
          say(
            "No se ha podido guardar el producto. Comprueba los campos y vuelve a intentarlo.",
          );
      } finally {
        if (ticket === epoch) {
          busy = false;
          save.disabled = false;
        }
      }
    });
  }
  window.ClientProducts = { open, reset };
})();
