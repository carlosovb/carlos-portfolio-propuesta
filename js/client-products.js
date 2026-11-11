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
    scope = "current",
    importQueue = [],
    importReviewOpen = false;
  const node = (tag, text, cls) => {
    const n = document.createElement(tag);
    if (text !== undefined) n.textContent = text;
    if (cls) n.className = cls;
    return n;
  };
  const euro = (value) =>
    new Intl.NumberFormat("es-ES", { style: "currency", currency: "EUR" }).format(value);
  const periods = {
    monthly: { count: 12, suffix: "/mes", label: "al mes" },
    quarterly: { count: 4, suffix: "/trimestre", label: "por trimestre" },
    semiannual: { count: 2, suffix: "/semestre", label: "por semestre" },
    annual: { count: 1, suffix: "/año", label: "al año" },
  };
  const lifeReceipt = (annual, count) => Math.round(Math.round(Number(annual) * 100) / count) / 100;
  function lifeUnitSchedule(payment, units, effectiveOn) {
    const period = periods[payment];
    if (!period || units == null || units === "") return "";
    const format = new Intl.NumberFormat("es-ES", { maximumFractionDigits: 4 });
    let firstCharge = "un mes después de la fecha de efecto";
    if (effectiveOn) {
      const [year, month, day] = effectiveOn.split("-").map(Number);
      const lastDay = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
      const charge = new Date(Date.UTC(year, month, Math.min(day, lastDay)));
      firstCharge = new Intl.DateTimeFormat("es-ES", { dateStyle: "medium", timeZone: "UTC" }).format(charge);
    }
    if (period.count === 1) return format.format(units) + " U en el primer cobro previsto (" + firstCharge + ").";
    const share = Number(units) / period.count;
    const rounded = Math.round(share * 10000) / 10000;
    return period.count + " cuotas de " + (share === rounded ? "" : "aprox. ") +
      format.format(share) + " U " + period.label + ". Primer cobro previsto: " + firstCharge + ".";
  }
  const topPiasEntry = 3000;
  function renderTopPiasInitial(host) {
    host.replaceChildren(
      node("span", "Aportación inicial del contrato"),
      node("strong", euro(topPiasEntry)),
      node("span", "Primer pago · entrada y primera cuota"),
      node("strong", euro(topPiasEntry + 50)),
    );
  }
  function top10Initial(payment, amount) {
    const cents = Math.round(Number(amount) * 100);
    const extra = cents * ({ monthly: 3, quarterly: 1, annual: 0 }[payment]);
    return { extra: extra / 100, first: (cents + extra) / 100 };
  }
  function renderTop10Initial(host, payment, amount) {
    const { extra, first } = top10Initial(payment, amount);
    host.replaceChildren(
      node("span", "Prima adicional inicial calculada"),
      node("strong", extra ? euro(extra) : "No se exige con pago anual"),
      node("span", "Primer pago calculado"),
      node("strong", euro(first)),
    );
  }
  function basketChart(row) {
    if (window.PortfolioCompanies.find(row.company)?.id !== "intesa" || !row.portfolio) return null;
    const shares = row.portfolio.split(/\s+\+\s+/).map((part) => {
      const match = part.match(/^(.+?)\s+(\d+(?:[.,]\d{1,2})?)\s*%$/);
      return match && { name: match[1], cents: Math.round(Number(match[2].replace(",", ".")) * 100) };
    });
    if (shares.length === 1 && !shares[0]) shares[0] = { name: row.portfolio, cents: 10000 };
    if (shares.some((share) => !share || share.cents <= 0) ||
        shares.reduce((total, share) => total + share.cents, 0) !== 10000) return null;
    const chart = node("div", undefined, "contract-basket-chart");
    const ring = node("span", undefined, "contract-basket-ring");
    ring.setAttribute("aria-hidden", "true");
    const legend = node("ul");
    let start = 0;
    const colors = ["#de9e72", "#5bb9ae", "#7ea3dd", "#c98bba"];
    const segments = shares.map(({ name, cents }, index) => {
      const color = colors[index] || "hsl(" + ((index * 137) % 360) + " 60% 57%)";
      const item = node("li");
      const dot = node("span", undefined, "contract-basket-dot");
      dot.style.backgroundColor = color;
      dot.setAttribute("aria-hidden", "true");
      item.append(dot, node("span", name), node("strong", (cents / 100).toLocaleString("es-ES") + " %"));
      legend.append(item);
      const segment = color + " " + (start / 100) + "% " + ((start + cents) / 100) + "%";
      start += cents;
      return segment;
    });
    ring.style.backgroundImage = "conic-gradient(" + segments.join(",") + ")";
    chart.append(ring, legend);
    return chart;
  }
  const button = (text, fn, cls = "panel-secondary") => {
    const b = node("button", text, cls);
    b.type = "button";
    b.addEventListener("click", fn);
    return b;
  };
  function reset() {
    importQueue = [];
    importReviewOpen = false;
    epoch++;
    client = null;
    rows = [];
    editing = null;
    busy = false;
    selected.clear();
    window.DatePicker?.close();
    window.ContractControls?.close();
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
      return true;
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
      node("h3", "Productos en cartera"),
    );
    const note = node("p");
    note.setAttribute("role", "status");
    note.hidden = true;
    host.append(note);
    const metrics = node("div", undefined, "contract-metrics");
    const baseRows = rows.filter((r) => !r.is_apex);
    const liveRows = baseRows.filter((r) => !r.archived_at);
    const visibleRows = baseRows.filter((r) =>
      scope === "history" ? !!r.archived_at : !r.archived_at,
    );
    const recurringLabel = liveRows.some((r) => ["quarterly", "semiannual", "annual"].includes(r.payment_type))
      ? "Equivalente mensual" : "Aportación mensual";
    const monthly = liveRows
        .filter((r) => periods[r.payment_type])
        .reduce((s, r) => s + Number(r.amount) * periods[r.payment_type].count / 12, 0),
      single = rows
        .filter((r) => !r.archived_at)
        .filter((r) => r.payment_type === "single")
        .reduce((s, r) => s + Number(r.amount), 0);
    const signedUnits = rows.reduce((total, row) => total + Number(row.units || 0), 0);
    [
      [
        "Unidades firmadas",
        new Intl.NumberFormat("es-ES", { maximumFractionDigits: 4 }).format(signedUnits) +
          " U",
      ],
      ["en cartera", String(liveRows.length)],
      [
        recurringLabel,
        new Intl.NumberFormat("es-ES", {
          style: "currency",
          currency: "EUR",
          minimumFractionDigits: 0,
          maximumFractionDigits: 2,
        }).format(monthly),
      ],
      ["Aportaciones únicas", euro(single)],
    ].forEach(([label, value]) => {
      const box = node("article");
      if (label === "Aportaciones únicas") box.className = "contract-metric-single";
      if (label === "Aportaciones únicas" && single === 0) box.hidden = true;
      box.append(node("small", label), node("strong", value));
      if (label === "en cartera")
        box.querySelector("strong").append(node("span", " productos", "metric-suffix"));
      if (label === recurringLabel)
        box.querySelector("strong").append(node("span", "/mes", "metric-month-suffix"));
      metrics.append(box);
    });
    host.append(metrics);
    const tabs = node("div", undefined, "contract-tabs");
    tabs.setAttribute("role", "group");
    tabs.setAttribute("aria-label", "Situación de los productos");
    [
      ["current", "Vigentes", liveRows.length],
      ["history", "Historial", baseRows.length - liveRows.length],
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
    tabs.hidden = scope === "current" && !baseRows.some((r) => r.archived_at);
    if (scope === "history")
      host.append(
        node(
          "p",
          "Productos finalizados o de un contacto de baja. Conservan su producción histórica.",
          "contract-history-note",
        ),
      );
    const controls = node("div", undefined, "contract-actions contract-controls");
    const add = button("+ Añadir producto", startNew);
    add.disabled = client.is_active === false;
    if (add.disabled) add.title = "Reactiva el contacto antes de añadir productos";
    controls.append(add);
    const files = node("input");
    files.type = "file";
    files.accept = ".pdf,application/pdf";
    files.multiple = true;
    files.hidden = true;
    files.addEventListener("change", () => {
      const picked = Array.from(files.files);
      files.value = "";
      queueProjects(picked);
    });
    const importButton = button("Importar productos", () => {
      if (!busy && !editing) files.click();
    });
    importButton.disabled = add.disabled;
    controls.append(importButton, files);
    const resumeImport = button("Retomar revisión de PDF", () => {
      importReviewOpen = true;
      renderQueue();
    });
    resumeImport.classList.add("product-project-resume");
    resumeImport.hidden = true;
    controls.append(resumeImport);
    const remove = button(
      "Eliminar seleccionados",
      async () => {
        if (
          busy ||
          !selected.size ||
          !(await window.SiteConfirm.ask(
            `¿Eliminar ${selected.size} productos contratados seleccionados? Las unidades y comisiones históricas se conservarán.`,
          ))
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
    toolbar.append(heading, controls, tabs);
    host.append(toolbar);
    const list = node("div", undefined, "contract-list");
    const companies = new Map();
    visibleRows.forEach((row) => {
      const label = window.PortfolioCompanies.label(row.company);
      if (!companies.has(label)) {
        const section = node("section", undefined, "contract-company");
        const heading = node("header", undefined, "contract-company-heading");
        const toggle = button(
          "",
          () => {
            const expanded = toggle.getAttribute("aria-expanded") !== "true";
            toggle.setAttribute("aria-expanded", String(expanded));
            section
              .querySelectorAll(":scope > .contract-card")
              .forEach((card) => (card.hidden = !expanded));
          },
          "contract-company-toggle",
        );
        toggle.setAttribute("aria-expanded", "true");
        toggle.setAttribute("aria-label", "Productos de " + label);
        const company = window.PortfolioCompanies.find(label);
        if (company) {
          const logo = node("img");
          logo.src = "../assets/companies/" + company.logo;
          logo.alt = "";
          logo.dataset.company = company.id;
          const brand = node("span", undefined, "contract-brand-icon");
          brand.dataset.company = company.id;
          brand.append(logo);
          toggle.append(brand);
        }
        toggle.append(node("h4", label));
        const count = visibleRows.filter(
          (r) => window.PortfolioCompanies.label(r.company) === label,
        ).length;
        toggle.append(node("small", count + (count === 1 ? " producto" : " productos")));
        const arrow = node("img", undefined, "contract-company-chevron");
        arrow.src = "../assets/icons/chevron-down.svg";
        arrow.alt = "";
        toggle.append(arrow);
        heading.append(toggle);
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
          (row.portfolio ? row.portfolio + " · " : "") +
            new Intl.NumberFormat("es-ES", {
              style: "currency",
              currency: "EUR",
              minimumFractionDigits: 0,
              maximumFractionDigits: 2,
            }).format(row.amount) +
            (periods[row.payment_type]?.suffix || " · aportación única"),
          "contract-portfolio-label",
        ),
      );
      const payment = node("span", undefined, "contract-payment");
      payment.append(
        node("strong", euro(row.amount)),
        node("small", periods[row.payment_type]?.label || "aportación única"),
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
      const chevron = node("img", undefined, "contract-chevron");
      chevron.src = "../assets/icons/chevron-down.svg";
      chevron.alt = "";
      summary.append(identity, payment, units, chevron);
      const detail = node("div", undefined, "contract-expanded");
      const dl = node("dl");
      const date = (value) =>
        value
          ? new Intl.DateTimeFormat("es-ES", { dateStyle: "medium" }).format(
              new Date(value + "T12:00:00"),
            )
          : "Pendiente";
      [
        ...(window.LifeProtect.isProduct(row.company, row.product) ? [] : [["Cartera de fondos", row.portfolio || "Sin indicar"]]),
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
        const description = node("dd");
        const chart = label === "Cartera de fondos" && basketChart(row);
        description.append(chart || value);
        item.append(node("dt", label), description);
        dl.append(item);
      });
      detail.append(dl);
      if (window.LifeProtect.isProduct(row.company, row.product)) {
        const life = node("section", undefined, "life-protect-summary");
        life.append(node("h6", "Protecciones y capital asegurado"));
        const list = node("dl");
        list.append(
          node("dt", "Prima neta anual"),
          node("dd", row.life_annual_net_premium == null ? "Sin confirmar" : euro(row.life_annual_net_premium)),
          node("dt", "Cuota neta por recibo"),
          node("dd", euro(row.amount) + (periods[row.payment_type] ? " " + periods[row.payment_type].label : "")),
        );
        for (const [key, label] of window.LifeProtect.covers) {
          const capital = row.life_coverages?.[key];
          list.append(node("dt", label), node("dd", capital > 0 ? euro(capital) : "Sin capital asignado"));
        }
        if (row.life_effective_on) list.append(node("dt", "Inicio de cobertura"), node("dd", date(row.life_effective_on)));
        life.append(list);
        if (row.life_effective_on) life.append(node("p", lifeUnitSchedule(row.payment_type, row.units, row.life_effective_on)));
        detail.append(life);
      }
      if (window.PortfolioCompanies.isTop10(row.company, row.product) && periods[row.payment_type]) {
        const initial = node("div", undefined, "contract-apex-context contract-top10-initial");
        renderTop10Initial(initial, row.payment_type, row.amount);
        detail.append(initial);
      }
      if (row.top_pias_with_initial) {
        const initial = node("div", undefined, "contract-apex-context contract-top10-initial");
        renderTopPiasInitial(initial);
        detail.append(initial);
      }
      const extras = rows.filter((p) => p.is_apex && p.parent_product_id === row.id);
      if (extras.length) {
        const apexList = node("section", undefined, "contract-apex-list");
        apexList.append(node("h6", "APEX · Aportaciones únicas adicionales"));
        extras.forEach((extra) => {
          const entry = node("article", undefined, "contract-apex-entry");
          const text = node("div");
          text.append(
            node("strong", euro(extra.amount)),
            node(
              "small",
              (extra.signed_on || "Sin fecha") +
                " · " +
                (extra.units ?? "—") +
                " U · ×" +
                (extra.signed_multiplier ?? "—"),
            ),
          );
          const actions = node("div");
          const editExtra = button("Editar APEX", () => {
            editing = extra;
            editor();
          });
          editExtra.disabled = client.is_active === false || !!row.archived_at;
          const deleteExtra = button(
            "Eliminar APEX",
            async () => {
              if (
                busy ||
                !(await window.SiteConfirm.ask(
                  "¿Eliminar esta APEX de la ficha? Sus unidades y comisiones históricas se conservarán.",
                ))
              )
                return;
              const ticket = epoch;
              busy = true;
              try {
                if (demo) {
                  rows = rows.filter((p) => p.id !== extra.id);
                  render();
                  announceCompanies();
                } else {
                  await backend.deleteClientProducts(client.id, [extra.id]);
                  if (ticket === epoch) await reload();
                }
              } catch {
                if (ticket === epoch)
                  say(
                    "No se ha podido eliminar la APEX. Reabre la ficha para comprobarlo.",
                  );
              } finally {
                if (ticket === epoch) busy = false;
              }
            },
            "panel-text-button",
          );
          actions.append(editExtra, deleteExtra);
          entry.append(text, actions);
          apexList.append(entry);
        });
        detail.append(apexList);
      }
      const tools = node("div", undefined, "contract-detail-actions");
      if (window.PortfolioCompanies.apex(row.company, row.product)) {
        const addApex = button("+ Añadir APEX", () => {
          editing = {
            is_apex: true,
            parent_product_id: row.id,
            company: row.company,
            product: row.product,
            portfolio: row.portfolio,
            payment_type: "single",
          };
          editor();
        });
        addApex.disabled = client.is_active === false || !!row.archived_at;
        tools.append(addApex);
      }

      const archive = button(
        row.archived_at ? "Reactivar producto" : "Pasar al historial",
        async () => {
          if (busy) return;
          const restoring = !!row.archived_at;
          if (
            !restoring &&
            !(await window.SiteConfirm.ask(
              "¿Pasar este producto al historial? Las unidades y comisiones se conservarán.",
            ))
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
      tools.prepend(edit);
      card.append(check, copy);
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
    const importHost = node("section", undefined, "product-project-queue");
    importHost.setAttribute("aria-label", "Revisión de productos importados");
    const workspace = node("div", undefined, "product-project-workspace");
    workspace.append(importHost, editorHost);
    host.append(workspace);
    renderQueue();
    if (editing) editor();
    if (demo) say("Datos de ejemplo: los productos añadidos aquí no se guardan.");
  }
  function announceCompanies() {
    window.dispatchEvent(
      new CustomEvent("client-products-changed", {
        detail: {
          clientId: client.id,
          demo,
          productCount: rows.filter((r) => !r.is_apex).length,
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
  async function queueProjects(files) {
    if (!client || client.is_active === false || busy || !files.length) return;
    const ticket = epoch;
    const current = () => ticket === epoch;
    const added = [];
    for (const file of files) {
      const key = JSON.stringify([file.name, file.size, file.lastModified]);
      if (importQueue.some((entry) => entry.key === key)) continue;
      const entry = { key, name: file.name, id: crypto.randomUUID(), status: "reading" };
      importQueue.push(entry);
      added.push({ entry, file });
    }
    if (!added.length) return;
    importReviewOpen = true;
    renderQueue();
    const name = [client.first_name, client.last_name].filter(Boolean).join(" ");
    for (const { entry, file } of added) {
      if (!current()) return;
      try {
        const result = await window.ProductProject.read(file, current);
        if (!current()) return;
        entry.draft = result.draft;
        entry.holder = result.source.holder;
        entry.offer = result.source.lifeDocument === "offer" ? result.source : null;
        entry.lifeRequest = result.source.lifeDocument === "request";
        entry.demoMismatch = !!(demo && entry.holder && !window.ProductCaptureParser.samePerson(entry.holder, name));
        entry.status = !demo && entry.holder && !window.ProductCaptureParser.samePerson(entry.holder, name)
          ? "mismatch" : entry.offer ? "offer" : "pending";
      } catch (error) {
        entry.status = "unreadable";
        entry.message = error.name === "PasswordException"
          ? "PDF protegido con contraseña." : "No se pudo leer. Usa un PDF con texto, de hasta 10 MB y 200 páginas.";
      }
      if (current()) renderQueue();
    }
  }
  function renderQueue() {
    const queue = host.querySelector(".product-project-queue");
    if (!queue) return;
    const hasPending = importQueue.some((entry) => entry.status !== "saved");
    queue.hidden = !importReviewOpen || !importQueue.length;
    const resume = host.querySelector(".product-project-resume");
    if (resume) resume.hidden = importReviewOpen || !hasPending;
    queue.parentElement.classList.toggle("is-reviewing", Boolean(editing?._entry));
    queue.replaceChildren();
    if (!importQueue.length) return;
    const ready = importQueue.filter((entry) => entry.status === "ready").length;
    const heading = node("div", undefined, "product-project-heading");
    heading.append(
      node("h4", "Revisar documentos"),
      node("small", importQueue.length + " PDF · " + ready + " listos"),
    );
    const list = node("ul", undefined, "product-project-list");
    const labels = {
      reading: "Leyendo PDF…", pending: "Por revisar", mismatch: "El titular no coincide",
      unreadable: "PDF ilegible", ready: "Listo para guardar", saved: "Guardado",
      offer: "Oferta · Solo referencia",
    };
    for (const entry of importQueue) {
      const item = node("li");
      item.dataset.status = entry.status;
      const description = node("div");
      const draft = entry.fields || entry.draft;
      description.append(node("strong", draft?.product || entry.name));
      if (draft?.product) description.append(node("small", entry.name));
      if (draft && entry.status !== "mismatch") {
        const amount = draft.amount == null ? "" : euro(draft.amount) + (periods[draft.payment_type]?.suffix || "");
        const summary = [draft.company, amount].filter(Boolean).join(" · ");
        if (summary) description.append(node("small", summary));
      }
      description.append(node("span", labels[entry.status], "product-project-status"));
      if (entry.status === "pending" && !entry.holder)
        description.append(node("small", "Titular sin identificar"));
      if (entry.status === "pending" && draft?.units == null)
        description.append(node("small", "Faltan unidades"));
      const offer = entry.lifeRequest && availableLifeOffer(entry);
      if (entry.lifeRequest && entry.status === "pending") {
        description.append(node("small", Object.keys(draft.life_coverages || {}).length + " protecciones detectadas"));
        if (draft.amount == null) description.append(node("small", "Confirma la prima neta al revisar"));
        description.append(node("small", offer ? "Oferta vinculada: " + offer.name
          : "Añade una oferta de Vida Protect del mismo titular para revisar la solicitud."));
      }
      if (entry.status === "offer") {
        const details = node("details", undefined, "life-protect-summary");
        details.append(node("summary", "Ver capitales y prima de la oferta"));
        const list = node("dl");
        for (const [key, label] of window.LifeProtect.covers) {
          const cover = entry.offer.protections[key];
          if (!cover) continue;
          list.append(node("dt", label), node("dd", euro(cover.capital) +
            (cover.net ? " · Prima neta anual " + euro(cover.net) : "")));
        }
        if (entry.offer.net) list.append(node("dt", "Prima neta anual"), node("dd", euro(entry.offer.net)));
        if (entry.offer.total) list.append(node("dt", "Prima total anual con impuestos"), node("dd", euro(entry.offer.total)));
        details.append(list, node("small", "Usa la solicitud para registrar el contrato."));
        description.append(details);
      }
      if (entry.status === "mismatch") description.append(node("small", "Titular del PDF: " + entry.holder));
      if (entry.demoMismatch)
        description.append(node("small", "El titular del PDF es distinto. Esta ficha es de ejemplo."));
      if (entry.message) description.append(node("small", entry.message));
      item.append(description);
      if (["pending", "ready"].includes(entry.status)) {
        const review = button(entry.status === "ready" ? "Volver a revisar" : "Revisar", () => {
          if (editing || busy || (entry.lifeRequest && !offer)) return;
          if (entry.lifeRequest) entry.pairedOffer = offer;
          const annualNet = entry.lifeRequest ? draft.life_annual_net_premium ?? offer.offer.net : null;
          editing = { ...draft, life_annual_net_premium: annualNet, _capture: true, _entry: entry };
          renderQueue();
          editor();
        });
        review.disabled = !!editing || busy || (entry.lifeRequest && !offer);
        item.append(review);
      }
      list.append(item);
    }
    const save = button("Guardar productos listos (" + ready + ")", saveProjects, "btn");
    save.disabled = !ready || busy || !!editing;
    const close = button("Cerrar revisión", () => {
      importQueue = [];
      importReviewOpen = false;
      renderQueue();
    }, "panel-text-button");
    close.disabled = busy || !!editing || importQueue.some((entry) => entry.status === "reading");
    const actions = node("div", undefined, "contract-actions");
    actions.append(save, close);
    queue.append(heading, list, actions);
  }
  function availableLifeOffer(entry) {
    if (entry.pairedOffer) return entry.pairedOffer;
    const candidates = importQueue.filter((offer) => offer.status === "offer" &&
      window.ProductCaptureParser.samePerson(offer.holder, entry.holder) &&
      !importQueue.some((request) => request.pairedOffer === offer));
    const capitals = Object.entries(entry.draft.life_coverages || {});
    return candidates.find((offer) => capitals.length > 0 &&
      capitals.length === Object.keys(offer.offer.protections).length &&
      capitals.every(([key, value]) => offer.offer.protections[key]?.capital === value))
      || (candidates.length === 1 ? candidates[0] : null);
  }
  async function saveProjects() {
    if (!client || client.is_active === false || busy || editing) return;
    const ready = importQueue.filter((entry) => entry.status === "ready");
    if (!ready.length) return;
    const ticket = epoch, target = client.id;
    const saved = [];
    busy = true;
    renderQueue();
    try {
      for (const entry of ready) {
        if (ticket !== epoch) return;
        try {
          if (demo) rows.unshift({ ...entry.fields, id: entry.id, client_id: target });
          else await backend.saveClientProduct(target, entry.fields, null, entry.id);
        } catch {
          const list = await backend.listClientProducts(target).catch(() => []);
          if (ticket !== epoch) return;
          if (!list.some((row) => row.id === entry.id)) {
            entry.message = "No se pudo guardar. Revisa el importe y el margen disponible antes de reintentar.";
            continue;
          }
        }
        entry.status = "saved";
        if (entry.pairedOffer) entry.pairedOffer.status = "saved";
        entry.message = "";
        saved.push(entry.id);
      }
      if (ticket !== epoch) return;
      if (!demo && saved.length) {
        try { await reload(); } catch { /* El guardado ya se confirmó. */ }
      } else if (demo) {
        render();
        announceCompanies();
      }
      if (ticket !== epoch) return;
      if (saved.length === ready.length) {
        importReviewOpen = false;
        importQueue = importQueue.filter((entry) => entry.status !== "saved");
        renderQueue();
      }
      say(saved.length + " productos guardados. " +
        (ready.length > saved.length ? "Los documentos con error siguen en la revisión." : ""));
      if (!demo && saved.length) void window.PanelInsights?.showProductPromotion(saved);
    } finally {
      if (ticket === epoch) {
        busy = false;
        renderQueue();
      }
    }
  }
  async function editor() {
    const box = document.getElementById("client-product-editor");
    box.replaceChildren();
    if (!editing) return;
    renderQueue();
    host.dataset.editing = "true";
    const selectedProduct = editing,
      ticket = epoch;
    box.textContent = "Preparando los datos de la firma…";
    let me;
    try {
      me = demo ? { user_id: "demo" } : await backend.getMyTeamProfile();
    } catch {
      if (ticket === epoch && selectedProduct === editing) {
        editing = null;
        host.dataset.editing = "false";
        box.textContent =
          "No se ha podido preparar la firma. Vuelve a abrir el formulario para reintentar.";
        renderQueue();
      }
      return;
    }
    if (ticket !== epoch || selectedProduct !== editing) return;
    box.replaceChildren();
    const form = node("form", undefined, "contract-editor"),
      grid = node("div", undefined, "contract-fields");
    form.append(
      node(
        "h4",
        editing.is_apex
          ? editing.id
            ? "Editar APEX"
            : "Añadir APEX"
          : editing.id
            ? "Editar producto contratado"
            : editing._entry ? "Revisar producto del PDF" : "Nuevo producto contratado",
      ),
    );
    if (editing._capture) {
      form.append(
        node(
          "p",
          editing._entry.name + " · Revisa los datos y completa los campos pendientes.",
          "capture-note",
        ),
      );
      if (!editing._entry.holder)
        form.append(node("p", "No se ha podido identificar al titular. Verifica que el PDF pertenece a este cliente.", "capture-identity-warning"));
      if (rows.some((row) => !row.is_apex && row.company === editing.company &&
          row.product === editing.product && row.portfolio === editing.portfolio && Number(row.amount) === editing.amount))
        form.append(node("p", "Ya hay un producto parecido en esta ficha. Comprueba si está duplicado.", "capture-note"));
    }
    const conditions = node("section", undefined, "product-conditions");
    const apex = !!editing.is_apex;
    const parent = apex ? rows.find((r) => r.id === editing.parent_product_id) : null;
    const apexRule = apex ? window.PortfolioCompanies.apex(editing.company, editing.product) : null;
    let picker;
    if (apex) {
      const context = node("div", undefined, "contract-apex-context");
      context.append(
        node("strong", editing.company + " · " + editing.product),
        node("span", editing.portfolio + " · Aportación única adicional"),
      );
      if (apexRule?.wait) {
        context.append(
          node("span", "Mínimo " + euro(apexRule.minimum) + " · " +
            (apexRule.annual ? "Hasta el margen disponible del límite anual de 8.000 €" : "Sin máximo contractual indicado")),
          node("span", "En la contratación o a partir de " + apexRule.wait + " desde la aceptación por Intesa. Gastos sobre la APEX: 5 %."),
          node("span", apexRule.transferAll
            ? "Pago de la APEX por transferencia bancaria."
            : "Transferencia bancaria obligatoria para la APEX inicial."),
        );
      }
      form.append(context);
      conditions.hidden = false;
      picker = {
        read: () => ({
          company: editing.company,
          product: editing.product,
          portfolio: editing.portfolio,
        }),
      };
    } else if (editing._entry?.lifeRequest) {
      form.append(node("p", "AXA · Vida Protect · Oferta: " + editing._entry.pairedOffer.name));
      picker = { read: () => ({ company: "AXA", product: "Vida Protect", portfolio: "" }) };
    } else picker = window.ProductPicker.mount(form, editing, conditions);
    conditions.append(node("h5", "Condiciones del contrato"));
    const mode = node("div");
    const modeLabel = node("label", undefined, "capture-confirm");
    const initialMode = node("input");
    initialMode.type = "checkbox";
    initialMode.checked = !!editing.top_pias_with_initial;
    mode.hidden = true;
    modeLabel.append(initialMode, "Modalidad de 50 €/año con 3.000 € iniciales");
    mode.append(modeLabel);
    conditions.append(mode);
    const payment = field(
      grid,
      "Tipo de aportación",
      "payment_type",
      editing._capture ? editing.payment_type : editing.payment_type || "monthly",
      {
        options: [
          ...(editing._capture ? [["", "Selecciona la periodicidad"]] : []),
          ["monthly", "Mensual · €/mes"],
          ["quarterly", "Trimestral · €/trimestre"],
          ["semiannual", "Semestral · €/semestre"],
          ["annual", "Anual · €/año"],
          ["single", "Aportación única"],
        ],
      },
    );
    payment.required = true;
    let paymentControl;
    if (apex) {
      payment.value = "single";
      payment.disabled = true;
      payment.closest("label").hidden = true;
    } else paymentControl = window.ContractControls.payment(payment);
    const initialAmount = window.LifeProtect.isProduct(editing.company, editing.product)
      ? editing.life_annual_net_premium : editing.amount;
    const amount = field(grid, "Importe en euros", "amount", initialAmount, {
      type: "number",
      required: true,
    });
    const amountControl = window.ContractControls.amount(amount, apexRule?.wait ? [300, 500, 1000, 2000, 3000, 5000] : undefined);
    const life = node("fieldset", undefined, "life-protect-fields");
    life.hidden = true;
    life.disabled = true;
    life.append(node("legend", "Protecciones y capital asegurado"),
      node("p", "Introduce el capital de cada protección contratada. Deja vacías las demás."));
    const protections = node("div", undefined, "life-protect-grid");
    const capitals = window.LifeProtect.covers.map(([key, label]) => {
      const input = field(protections, label, "life_" + key, editing.life_coverages?.[key], { type: "number" });
      input.min = "0.01";
      input.placeholder = "Sin capital asignado";
      return [key, input];
    });
    const effective = field(life, "Inicio de cobertura", "life_effective_on", editing.life_effective_on, { type: "date", required: true });
    window.DatePicker.mount(effective);
    life.insertBefore(protections, effective.closest("label"));
    if (editing._entry?.lifeRequest && editing.life_annual_net_premium != null) life.append(node("p",
      "Prima neta anual según la oferta. Confirma el importe o corrígelo antes de guardar."));
    const receipt = node("small");
    receipt.hidden = true;
    amount.closest("label").append(receipt);
    const amountLimits = node("small", "", "contract-amount-limits");
    amountLimits.id = "contract-amount-limits";
    amount.setAttribute("aria-describedby", amountLimits.id);
    amount.closest("label").append(amountLimits);
    const units = field(
      grid,
      apex ? "Unidades de la APEX" : "Unidades generadas",
      "units",
      editing.units,
      {
        type: "number",
      },
    );
    units.required = true;
    const lifeUnits = node("small");
    lifeUnits.hidden = true;
    units.closest("label").append(lifeUnits);
    conditions.append(grid);
    conditions.append(life);
    const initial = node("div", undefined, "contract-apex-context contract-top10-initial");
    initial.hidden = true;
    initial.setAttribute("aria-live", "polite");
    conditions.append(initial);
    const budget = node("p", undefined, "contract-pias-budget");
    budget.setAttribute("role", "status");
    budget.hidden = true;
    conditions.append(budget);
    const signature = node("fieldset", undefined, "contract-signature");
    signature.append(node("legend", "Firma y producción"));
    const calculationHelp = node("details", undefined, "contract-calculation-help");
    calculationHelp.append(
      node("summary", "Cómo se calculan las unidades y comisiones"),
      node(
        "p",
        "La aportación del cliente no es tu comisión. Las unidades cuentan una vez, en el mes de firma, con los multiplicadores guardados para esa firma. Lo desconocido queda pendiente.",
      ),
    );
    const today = new Intl.DateTimeFormat("sv-SE", {
      timeZone: "Atlantic/Canary",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(new Date());
    const signed = field(
      signature,
      "Fecha de firma",
      "signed_on",
      editing._capture ? editing.signed_on || "" : editing.id ? editing.signed_on : today,
      { type: "date" },
    );
    signed.required = apex || !!editing._capture;
    signed.min = apex && parent?.signed_on ? parent.signed_on : "2000-01-01";
    signed.max = today;
    window.DatePicker.mount(signed);
    const multipliers = [
      ["", "Pendiente de confirmar"],
      ...[2, 2.5, 3.5, 4.5, 5, 5.5, 6].map((v) => [String(v), "×" + v]),
    ];
    const multiplier = field(
      signature,
      "Tu multiplicador al firmar",
      "signed_multiplier",
      editing._capture || editing.id ? editing.signed_multiplier : me.multiplier,
      { options: multipliers },
    );
    multiplier.required = apex || !!editing._capture;
    signature.append(
      node(
        "p",
        "Las comisiones del equipo se calculan automáticamente según los responsables de esta firma.",
        "stats-caption",
      ),
      calculationHelp,
    );
    conditions.append(signature);
    form.append(conditions);
    if (editing._capture) {
      const confirmation = node("label", undefined, "capture-confirm");
      const checkbox = node("input");
      checkbox.type = "checkbox";
      checkbox.required = true;
      confirmation.append(
        checkbox,
        document.createTextNode(
          editing._entry.holder
            ? editing._entry.lifeRequest
              ? "Confirmo la prima neta y he revisado los datos de la solicitud."
              : "He revisado los datos importados, la fecha de firma y el multiplicador histórico."
            : "He comprobado que el PDF pertenece a este cliente y he revisado los datos de firma.",
        ),
      );
      form.append(confirmation);
    }
    const actions = node("div", undefined, "contract-actions"),
      save = node("button", editing._entry ? "Marcar como listo" : apex ? "Guardar APEX" : "Guardar producto", "btn");
    save.type = "submit";
    actions.append(
      save,
      button("Cancelar", () => {
        if (editing._entry?.status === "pending") delete editing._entry.pairedOffer;
        editing = null;
        host.dataset.editing = "false";
        box.replaceChildren();
        renderQueue();
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
    let budgetVersion = 0,
      budgetTimer;
    let ordinaryPayment = initialMode.checked ? "monthly" : payment.value;
    let ordinaryAmount = initialMode.checked ? "" : amount.value;
    let withEntry = !!editing.top_pias_with_initial;
    function configureAmount(selection) {
      const isLife = window.LifeProtect.isProduct(selection.company, selection.product);
      life.hidden = !isLife;
      life.disabled = !isLife;
      capitals[0][1].setCustomValidity(isLife && !capitals.some(([, input]) => Number(input.value) > 0)
        ? "Indica el capital de al menos una protección contratada." : "");
      amount.closest("label").firstChild.textContent = isLife ? "Prima neta anual en euros" : "Importe en euros";
      units.closest("label").firstChild.textContent = isLife ? "Unidades totales del primer año" : apex ? "Unidades de la APEX" : "Unidades generadas";
      const top10 = !apex && window.PortfolioCompanies.isTop10(selection.company, selection.product);
      const rules = window.PortfolioCompanies.contribution(selection.company, selection.product);
      const topPias = !apex && window.PortfolioCompanies.find(selection.company)?.id === "intesa" &&
        selection.product === "TOP PIAS";
      mode.hidden = !topPias;
      if (!topPias) initialMode.checked = false;
      const useEntry = topPias && initialMode.checked;
      if (useEntry !== withEntry) {
        if (useEntry) {
          ordinaryPayment = payment.value;
          ordinaryAmount = amount.value;
        } else {
          payment.value = ordinaryPayment;
          amount.value = ordinaryAmount;
        }
        withEntry = useEntry;
      }
      amount.readOnly = withEntry;
      if (withEntry) {
        payment.value = "annual";
        amount.value = "50";
      }
      if (!apex) {
        for (const option of payment.options) {
          const legacy = editing.id && editing.payment_type === option.value &&
            editing.company === selection.company && editing.product === selection.product;
          const hide = withEntry ? option.value !== "annual"
            : !!option.value && (rules ? !rules[option.value] && !legacy : ["quarterly", "semiannual", "annual"].includes(option.value));
          option.hidden = option.disabled = hide;
        }
        if (payment.selectedOptions[0]?.disabled) {
          payment.value = Array.from(payment.options).find((option) => !option.disabled).value;
        }
        paymentControl.refresh();
      }
      lifeUnits.textContent = isLife ? lifeUnitSchedule(payment.value, units.value, effective.value) : "";
      lifeUnits.hidden = !lifeUnits.textContent;
      const pias = /pias/i.test(selection.product || "");
      const count = apex ? 1 : periods[payment.value]?.count ?? 1;
      receipt.hidden = !isLife || !amount.value || !periods[payment.value];
      receipt.textContent = receipt.hidden ? "" : "Cuota neta por recibo: " +
        euro(lifeReceipt(amount.value, count)) + " " + periods[payment.value].label;
      const period = top10 && periods[payment.value];
      signed.required = isLife || withEntry || apex || !!editing._capture || (pias && payment.value === "single");
      const [min, cap] = rules?.[payment.value] ?? [0.01];
      const minimum = String(withEntry ? 50 : apex ? apexRule?.minimum ?? 600 : isLife ? count / 100 : min);
      const productCap = withEntry ? 50 : apex ? apexRule?.annual : cap;
      const maximum = String(productCap ?? (pias ? 8000 : 100000000));
      amountLimits.textContent = rules || apexRule
        ? "Mínimo " + euro(Number(minimum)) + (pias ? " · Sujeto al margen anual del PIAS"
          : productCap ? " · Máximo " + euro(productCap) : "")
        : "";
      if (amount.min !== minimum || amount.max !== maximum) {
        amount.min = minimum;
        amount.max = maximum;
        amountControl.refresh();
      }
      amount.setCustomValidity("");
      initial.hidden = !withEntry && (!period || !amount.value);
      if (withEntry) renderTopPiasInitial(initial);
      else if (!initial.hidden) renderTop10Initial(initial, payment.value, amount.value);
      return { pias, count, maximum };
    }
    async function updateBudget() {
      const version = ++budgetVersion;
      const selection = picker.read(Object.fromEntries(new FormData(form)));
      const { pias, count, maximum } = configureAmount(selection);
      if (!pias) {
        budget.hidden = true;
        save.disabled = false;
        return true;
      }
      const year = Number((signed.value || signed.max).slice(0, 4));
      const entry = withEntry ? topPiasEntry : 0;
      budget.hidden = false;
      budget.textContent = "Comprobando margen anual…";
      save.disabled = true;
      try {
        let result;
        if (demo) {
          const rest = rows.filter((r) => r.id !== editing.id && /pias/i.test(r.product));
          const reserved = rest.reduce(
            (sum, r) =>
              sum +
              (periods[r.payment_type]
                ? Number(r.amount) * periods[r.payment_type].count
                : Number(r.signed_on?.slice(0, 4)) === year
                  ? Number(r.amount)
                  : 0) +
              (r.top_pias_with_initial && Number(r.signed_on?.slice(0, 4)) === year ? topPiasEntry : 0),
            0,
          );
          result = { reserved, remaining: Math.max(0, 8000 - reserved) };
        } else result = await backend.getPiasBudget(client.id, year, editing.id || null);
        if (
          ticket !== epoch ||
          selectedProduct !== editing ||
          version !== budgetVersion ||
          !form.isConnected
        )
          return false;
        const max = Math.min(Number(maximum || Infinity), Math.floor((Number(result.remaining) - entry) * 100 / count) / 100);
        amount.max = String(Math.max(0, max));
        amountControl.refresh();
        const candidate = Number(amount.value || 0) * count + entry,
          available = Number(result.remaining) - candidate;
        budget.dataset.error = String(available < 0 || max < Number(amount.min));
        budget.textContent =
          year +
          " · " +
          euro(Number(result.reserved) + candidate) +
          " de 8.000 € anuales · " +
          euro(Math.max(0, available)) +
          " disponibles. " +
          (count > 1 ? "Se reservan " + count + " cuotas completas. " : "") +
          (entry ? "Incluye los 3.000 € de entrada del contrato. " : "") +
          (entry && available < 0 ? "No hay margen para esta modalidad. " : "") +
          "Incluye los PIAS registrados de este cliente.";
        if (max < Number(amount.min))
          amount.setCustomValidity(
            apex
              ? "No queda margen para una APEX mínima de " + euro(Number(amount.min)) + "."
              : "No queda margen anual para esta aportación.",
          );
        else if (candidate > Number(result.remaining))
          amount.setCustomValidity("Esta aportación supera el margen anual disponible.");
        return available >= 0 && max >= Number(amount.min) && amount.checkValidity();
      } catch {
        if (ticket === epoch && version === budgetVersion) {
          budget.dataset.error = "true";
          budget.textContent =
            "No se ha podido comprobar el margen anual. Vuelve a intentarlo.";
          amount.setCustomValidity("No se ha podido verificar el límite anual.");
        }
        return false;
      } finally {
        if (ticket === epoch && version === budgetVersion) save.disabled = false;
      }
    }
    const scheduleBudget = () => {
      clearTimeout(budgetTimer);
      budgetVersion++;
      const selection = picker.read(Object.fromEntries(new FormData(form)));
      const { pias } = configureAmount(selection);
      if (!pias) {
        budget.hidden = true;
        save.disabled = false;
      } else {
        budget.hidden = false;
        budget.textContent = "Comprobando margen anual…";
      }
      budgetTimer = setTimeout(() => {
        if (form.isConnected && selectedProduct === editing) updateBudget();
      }, 150);
    };
    form.addEventListener("change", scheduleBudget);
    form.addEventListener("input", scheduleBudget);
    updateBudget();
    form.addEventListener("submit", async (event) => {
      event.preventDefault();
      if (busy || !client) return;
      clearTimeout(budgetTimer);
      if (!(await updateBudget())) {
        form.reportValidity();
        return;
      }
      if (selectedProduct !== editing || !client || !form.isConnected || !form.reportValidity()) return;
      const values = Object.fromEntries(new FormData(form));
      const selection = picker.read(values);
      if (editing._entry && window.LifeProtect.isProduct(selection.company, selection.product) &&
          !editing._entry.pairedOffer) {
        say("Para importar Vida Protect, selecciona la oferta y la solicitud del mismo titular.");
        return;
      }
      const fields = {
        company: window.PortfolioCompanies.label(selection.company),
        product: selection.product.trim(),
        portfolio: selection.portfolio.trim(),
        payment_type: apex ? "single" : values.payment_type,
        is_apex: apex,
        parent_product_id: apex ? editing.parent_product_id : null,
        amount: !life.disabled
          ? lifeReceipt(values.amount, periods[values.payment_type].count)
          : Number(values.amount),
        units: values.units === "" ? null : Number(values.units),
        signed_on: values.signed_on || null,
        signed_multiplier:
          values.signed_multiplier === "" ? null : Number(values.signed_multiplier),
      };
      if (withEntry || editing.top_pias_with_initial) fields.top_pias_with_initial = withEntry;
      if (!life.disabled || editing.life_coverages) {
        fields.life_coverages = life.disabled ? null : Object.fromEntries(capitals
          .filter(([, input]) => input.value).map(([key, input]) => [key, Number(input.value)]));
        fields.life_effective_on = life.disabled ? null : effective.value || null;
        fields.life_annual_net_premium = life.disabled ? null : Number(values.amount);
      }
      if (editing._entry) {
        editing._entry.fields = fields;
        editing._entry.status = "ready";
        editing._entry.message = "";
        editing = null;
        host.dataset.editing = "false";
        box.replaceChildren();
        renderQueue();
        return;
      }
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
          const savedId = await backend.saveClientProduct(target, fields, id);
          if (ticket === epoch) {
            await reload();
            if (ticket === epoch && savedId)
              void window.PanelInsights?.showProductPromotion(savedId);
          }
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
  function startNew() {
    if (!client || busy || client.is_active === false) return;
    editing = {};
    return editor();
  }
  window.ClientProducts = { open, reset, startNew, isBusy: () => busy };
})();
