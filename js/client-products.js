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
    selected = new Set(),
    scope = "current";
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
    host.dataset.editing = "false";
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
    scope = row.is_active === false ? "history" : "current";
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
    host.dataset.editing = "false";
    host.replaceChildren();
    if (!client) return;
    selected.clear();
    const heading = node("div", undefined, "client-products-heading");
    heading.append(
      node("div", "TU CARTERA", "eyebrow"),
      node("h3", "Tus productos, de un vistazo."),
    );
    host.append(heading);
    const note = node("p");
    note.setAttribute("role", "status");
    note.hidden = true;
    host.append(note);
    const metrics = node("div", undefined, "contract-metrics");
    const liveRows = rows.filter((r) => !r.archived_at);
    const visibleRows = rows.filter((r) =>
      scope === "history" ? !!r.archived_at : !r.archived_at,
    );
    const monthly = liveRows
        .filter((r) => r.payment_type === "monthly")
        .reduce((s, r) => s + Number(r.amount), 0),
      single = liveRows
        .filter((r) => r.payment_type === "single")
        .reduce((s, r) => s + Number(r.amount), 0);
    [
      ["Productos vigentes", String(liveRows.length)],
      ["Aportación mensual", euro(monthly)],
      ["Aportaciones únicas", euro(single)],
    ].forEach(([label, value]) => {
      const box = node("article");
      box.append(node("small", label), node("strong", value));
      metrics.append(box);
    });
    host.append(metrics);
    const tabs = node("div", undefined, "contract-tabs");
    tabs.setAttribute("role", "group");
    tabs.setAttribute("aria-label", "Situación de los productos");
    [
      ["current", "Vigentes", liveRows.length],
      ["history", "Historial", rows.length - liveRows.length],
    ].forEach(([key, label, count]) => {
      const tab = button(
        label + " · " + count,
        () => {
          scope = key;
          editing = null;
          render();
        },
        "contract-tab",
      );
      tab.dataset.productScope = key;
      tab.setAttribute("aria-pressed", String(scope === key));
      tabs.append(tab);
    });
    const toolbar = node("div", undefined, "contract-toolbar");
    if (scope === "history")
      host.append(
        node(
          "p",
          "Productos finalizados o de un contacto de baja. Conservan su producción histórica.",
          "contract-history-note",
        ),
      );
    const controls = node("div", undefined, "contract-actions contract-controls");
    const add = button("+ Añadir producto", () => {
      editing = {};
      editor();
    });
    add.disabled = client.is_active === false;
    if (add.disabled) add.title = "Reactiva el contacto antes de añadir productos";
    controls.append(add);
    const remove = button(
      "Eliminar seleccionados",
      async () => {
        if (
          busy ||
          !selected.size ||
          !confirm(
            `¿Eliminar ${selected.size} productos contratados seleccionados? Las unidades y comisiones históricas se conservarán.`,
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
            announceCompanies();
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
    if (visibleRows.length) {
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
    toolbar.append(tabs, controls);
    host.append(toolbar);
    const list = node("div", undefined, "contract-list");
    const companies = new Map();
    visibleRows.forEach((row) => {
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
        const count = visibleRows.filter(
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
      const copy = node("details", undefined, "contract-copy contract-detail");
      const summary = node("summary", undefined, "contract-summary");
      const identity = node("span", undefined, "contract-identity");
      identity.append(
        node("h5", row.product),
        node(
          "small",
          row.portfolio || "Sin cartera asignada",
          "contract-portfolio-label",
        ),
      );
      const payment = node("span", undefined, "contract-payment");
      payment.append(
        node("strong", euro(row.amount)),
        node("small", row.payment_type === "monthly" ? "al mes" : "aportación única"),
      );
      const units = node("span", undefined, "contract-units");
      units.append(
        node(
          "strong",
          row.units == null
            ? "—"
            : new Intl.NumberFormat("es-ES", { maximumFractionDigits: 4 }).format(
                row.units,
              ) + " U",
        ),
        node("small", row.archived_at ? "En historial" : "Unidades firmadas"),
      );
      summary.append(identity, payment, units, node("span", "⌄", "contract-chevron"));
      const detail = node("div", undefined, "contract-expanded");
      const dl = node("dl");
      const date = (value) =>
        value
          ? new Intl.DateTimeFormat("es-ES", { dateStyle: "medium" }).format(
              new Date(value + "T12:00:00"),
            )
          : "Pendiente";
      [
        ["Cartera de fondos", row.portfolio || "Sin indicar"],
        ["Fecha de firma", date(row.signed_on)],
        [
          "Multiplicador al firmar",
          row.signed_multiplier == null ? "Pendiente" : "×" + row.signed_multiplier,
        ],
        [
          "Comisión propia registrada",
          row.units == null || row.signed_multiplier == null
            ? "Pendiente"
            : euro(Number(row.units) * Number(row.signed_multiplier)),
        ],
        ...(row.archived_at
          ? [
              [
                "En historial desde",
                new Intl.DateTimeFormat("es-ES", { dateStyle: "medium" }).format(
                  new Date(row.archived_at),
                ),
              ],
            ]
          : []),
      ].forEach(([label, value]) => {
        const item = node("div");
        item.append(node("dt", label), node("dd", value));
        dl.append(item);
      });
      detail.append(dl);
      const tools = node("div", undefined, "contract-detail-actions");
      const archive = button(
        row.archived_at ? "Reactivar producto" : "Pasar al historial",
        async () => {
          if (busy) return;
          const restoring = !!row.archived_at;
          if (
            !restoring &&
            !confirm(
              "¿Pasar este producto al historial? Las unidades y comisiones se conservarán.",
            )
          )
            return;
          const ticket = epoch;
          busy = true;
          archive.disabled = true;
          try {
            if (demo) {
              row.archived_at = restoring ? null : new Date().toISOString();
              render();
              announceCompanies();
            } else {
              await backend.setClientProductArchived(row.id, !restoring);
              if (ticket === epoch) await reload();
            }
          } catch {
            if (ticket === epoch) {
              say(
                "No se ha podido actualizar el producto. Reabre la ficha para comprobarlo.",
              );
              archive.disabled = false;
            }
          } finally {
            if (ticket === epoch) busy = false;
          }
        },
      );
      archive.disabled = !!row.archived_at && client.is_active === false;
      if (archive.disabled) archive.title = "Reactiva primero el contacto";
      tools.append(archive);
      detail.append(tools);
      copy.append(summary, detail);
      const edit = button("Editar", () => {
        editing = row;
        editor();
      });
      edit.disabled = client.is_active === false;
      card.append(check, copy, edit);
      companies.get(window.PortfolioCompanies.label(row.company)).append(card);
    });
    host.append(list);
    if (!visibleRows.length)
      host.append(
        node(
          "p",
          scope === "history"
            ? "Todavía no hay productos en el historial."
            : "No hay productos vigentes. Añade uno nuevo o consulta el historial.",
          "contract-empty",
        ),
      );
    const editorHost = node("div");
    editorHost.id = "client-product-editor";
    host.append(editorHost);
    if (editing) editor();
    if (demo) say("Datos de ejemplo: los productos añadidos aquí no se guardan.");
  }
  function announceCompanies() {
    window.dispatchEvent(
      new CustomEvent("client-products-changed", {
        detail: {
          clientId: client.id,
          demo,
          productCount: rows.length,
          units: rows.reduce((sum, r) => sum + Number(r.units || 0), 0),
          pendingUnits: rows.filter((r) => r.units == null).length,
          companies: [
            ...new Set(
              rows
                .filter((r) => !r.archived_at)
                .map((r) => window.PortfolioCompanies.label(r.company)),
            ),
          ],
        },
      }),
    );
  }
  async function reload() {
    const ticket = epoch,
      list = await backend.listClientProducts(client.id);
    if (ticket !== epoch) return;
    rows = list;
    editing = null;
    render();
    announceCompanies();
  }
  async function editor() {
    const box = document.getElementById("client-product-editor");
    box.replaceChildren();
    if (!editing) return;
    host.dataset.editing = "true";
    const selectedProduct = editing,
      ticket = epoch;
    box.textContent = "Preparando los datos de la firma…";
    let me, directory;
    try {
      [me, directory] = demo
        ? [{ user_id: "demo" }, []]
        : await Promise.all([backend.getMyTeamProfile(), backend.listTeam()]);
    } catch {
      if (ticket === epoch && selectedProduct === editing) {
        host.dataset.editing = "false";
        box.textContent =
          "No se ha podido preparar la firma. Pulsa Editar o Añadir producto para reintentar.";
      }
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
    signature.append(node("legend", "Firma y producción"));
    const calculationHelp = node("details", undefined, "contract-calculation-help");
    calculationHelp.append(
      node("summary", "Cómo se calculan las unidades y comisiones"),
      node(
        "p",
        "La aportación del cliente no es tu comisión. Las unidades cuentan una vez, en el mes de firma, con los multiplicadores confirmados de entonces. Lo desconocido queda pendiente.",
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
    structure.className = "contract-structure";
    structure.append(node("summary", "Multiplicadores del equipo"));
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
      "Confirmo los multiplicadores de esta firma; los pendientes quedan sin calcular.",
    );
    const check = node("input");
    check.type = "checkbox";
    check.required = !!signed.value;
    signed.addEventListener("change", () => (check.required = !!signed.value));
    confirmation.prepend(check);
    confirmation.className = "contract-confirmation";
    signature.append(confirmation, calculationHelp);
    conditions.append(signature);
    form.append(conditions);
    const actions = node("div", undefined, "contract-actions"),
      save = node("button", "Guardar producto", "btn");
    save.type = "submit";
    actions.append(
      save,
      button("Cancelar", () => {
        editing = null;
        host.dataset.editing = "false";
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
          announceCompanies();
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
