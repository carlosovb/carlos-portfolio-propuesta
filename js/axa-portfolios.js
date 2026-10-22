/* Referencia extraída del HTML aportado; no ejecuta contenido del documento. */
(() => {
  const data = window.AxaPortfoliosData;
  const names = [...new Set(data.portfolios.flatMap((p) => p.holdings.map((h) => h[0])))];
  const colors = ["#68bea0", "#72bad1", "#a6a0db", "#daab73", "#9bbb70", "#de969b"];
  const find = (name) => data.portfolios.find((p) => p.name === name);
  const el = (tag, text, cls) => {
    const node = document.createElement(tag);
    if (text != null) node.textContent = text;
    if (cls) node.className = cls;
    return node;
  };
  const percent = (n) =>
    new Intl.NumberFormat("es-ES", { maximumFractionDigits: 2 }).format(n) + " %";
  const euro = (n) =>
    new Intl.NumberFormat("es-ES", {
      style: "currency",
      currency: "EUR",
      maximumFractionDigits: 0,
    }).format(n);
  function bar(p) {
    const root = el("span", null, "axa-allocation");
    root.setAttribute(
      "aria-label",
      p.allocation
        .map(
          (n, i) => ["Renta fija", "Multiactivo", "Renta variable"][i] + ": " + n + " %",
        )
        .join(", "),
    );
    p.allocation.forEach((n, i) => {
      if (n) {
        const segment = el("span");
        segment.style.width = n + "%";
        segment.dataset.asset = i;
        root.append(segment);
      }
    });
    return root;
  }
  function decorate(radio, name) {
    const p = find(name);
    if (!p) return;
    const label = radio.closest("label");
    label.classList.add("axa-choice");
    label.style.setProperty("--portfolio-color", colors[data.portfolios.indexOf(p)]);
    const copy = label.querySelector(".product-choice-copy");
    copy.append(
      el("small", "Riesgo " + p.risk + "/7", "axa-risk"),
      bar(p),
      el("small", p.profile, "axa-profile"),
    );
  }
  function table(headers, rows) {
    const wrap = el("div", null, "axa-table-wrap"),
      table = el("table");
    const head = el("thead"),
      tr = el("tr");
    headers.forEach((h) => {
      const th = el("th", h);
      th.scope = "col";
      tr.append(th);
    });
    head.append(tr);
    const body = el("tbody");
    rows.forEach((cells) => {
      const r = el("tr");
      cells.forEach((cell) => {
        const td = el("td");
        td.append(cell instanceof Node ? cell : document.createTextNode(String(cell)));
        r.append(td);
      });
      body.append(r);
    });
    table.append(head, body);
    wrap.append(table);
    return wrap;
  }
  function link(url, text) {
    if (!url || !/^https:\/\//i.test(url)) return el("span", "No verificado");
    const a = el("a", text);
    a.href = url;
    a.target = "_blank";
    a.rel = "noopener noreferrer";
    return a;
  }
  function details(name) {
    const p = find(name);
    if (!p) return null;
    const root = el("details", null, "axa-reference");
    root.style.setProperty("--portfolio-color", colors[data.portfolios.indexOf(p)]);
    const summary = el("summary");
    summary.append(
      el("strong", "Conocer " + p.name),
      el("span", "Composición, rentabilidad y costes ↗"),
    );
    root.append(summary);
    const intro = el("div", null, "axa-reference-intro");
    intro.append(
      el("h5", p.name),
      el("p", p.profile),
      el(
        "span",
        "Riesgo " + p.risk + " de 7 · Horizonte del indicador: 15 años",
        "axa-risk",
      ),
      bar(p),
    );
    root.append(intro);
    const tabs = el("div", null, "axa-reference-tabs");
    tabs.setAttribute("role", "group");
    tabs.setAttribute("aria-label", "Información de " + p.name);
    const content = el("div", null, "axa-reference-content");
    const panels = {};
    const composition = el("section");
    composition.append(
      el("h6", "Cómo se distribuye"),
      el(
        "p",
        p.allocation
          .map(
            (n, i) =>
              ["Renta fija", "Multiactivo", "Renta variable"][i] + ": " + percent(n),
          )
          .join(" · "),
        "axa-caption",
      ),
      el(
        "p",
        "Distribución por tipos de fondos, no exposición efectiva a bolsa. Composición de agosto de 2026.",
        "axa-caption",
      ),
    );
    composition.append(
      table(
        ["Fondo", "Peso", "Identificador / consulta"],
        p.holdings.map(([name, weight]) => {
          const isin = data.fundIsins[names.indexOf(name)],
            f = data.funds[isin];
          const source = el("span");
          source.append(
            el("small", isin),
            document.createElement("br"),
            link(f?.morningstar || f?.source, "Consultar fondo ↗"),
          );
          return [name, percent(weight), source];
        }),
      ),
    );
    if (p.changed)
      composition.append(
        el(
          "p",
          "Esta cartera cambió de composición respecto al histórico mostrado.",
          "axa-caption",
        ),
      );
    panels.composition = composition;
    const returns = el("section");
    returns.append(el("h6", "Histórico 2021–2025"));
    returns.append(
      table(
        ["Año", "Rentabilidad"],
        p.values.map((n, i) => [data.historyYears[i], percent(n)]),
      ),
    );
    returns.append(
      el(
        "p",
        "Media aritmética: " +
          percent(p.values.reduce((a, b) => a + b, 0) / 5) +
          ". Datos aproximados redondeados, netos de gastos de fondos y antes de cargos de póliza. Fuentes AXA: diciembre de 2025. La composición puede haber cambiado y las rentabilidades pasadas no garantizan resultados futuros.",
        "axa-caption",
      ),
    );
    panels.returns = returns;
    const scenarios = el("section");
    scenarios.append(
      el("h6", "Escenarios del documento de datos fundamentales"),
      el(
        "p",
        "Ejemplo: 1.000 € al año. Capital neto de costes del producto, antes de impuestos personales. No son previsiones.",
        "axa-caption",
      ),
    );
    scenarios.append(
      table(
        ["Escenario", "1 año", "8 años", "15 años"],
        p.scenarios.map((amounts, i) => [
          ["Tensión", "Desfavorable", "Moderado", "Favorable"][i],
          ...amounts.map(
            (n, j) => euro(n) + " · " + percent(p.scenarioRates[i][j]) + " anual",
          ),
        ]),
      ),
    );
    scenarios.append(
      el(
        "p",
        "KID: " +
          data.kidDate +
          ". El escenario a 1 año no implica disponibilidad: el rescate no está permitido durante el primer año.",
        "axa-caption",
      ),
    );
    panels.scenarios = scenarios;
    const costs = el("section"),
      index = data.portfolios.indexOf(p);
    costs.append(
      el("h6", "Impacto anual de los costes · KID"),
      el(
        "p",
        "Ejemplo oficial de 1.000 € anuales durante 15 años. Reducción del rendimiento anual; no son cargos directos sobre cada prima.",
        "axa-caption",
      ),
    );
    costs.append(
      table(
        ["Concepto", "Impacto anual"],
        data.kidCosts[index].map((n, i) => [
          ["Entrada", "Gestión y funcionamiento", "Operaciones", "Total"][i],
          percent(n),
        ]),
      ),
    );
    costs.append(
      el(
        "p",
        "Producto completo: no se añade de nuevo el 0,85 %. Entrada es el impacto anualizado a 15 años. Comisiones de rendimiento: 0 % en estos ejemplos; salida al final de 15 años: no aplicable. Cálculos redondeados. KID " +
          data.kidDate +
          ".",
        "axa-caption",
      ),
    );
    costs.append(
      el("h6", "Cargos sobre aportaciones"),
      table(
        ["Duración del plan", "Primeros 4 años", "Desde el año 5"],
        [
          ["15 años", "10 %", "3 %"],
          ["16–20 años", "13 %", "3 %"],
          ["21–25 años", "16 %", "3 %"],
          ["26 años o más", "19 %", "3 %"],
        ],
      ),
    );
    costs.append(
      el(
        "p",
        "Aportaciones adicionales: 3 %. Gestión patrimonial de la póliza: 0,85 % anual sobre saldo, adicional al gasto de los fondos; ya contemplada en los indicadores KID anteriores. Fuente: nota informativa AXA, agosto de 2026.",
        "axa-caption",
      ),
    );
    costs.append(
      el("h6", "Gastos publicados de los fondos"),
      el(
        "p",
        "Tarifas públicas de cada clase; no acreditan el coste efectivo negociado dentro del PIAS. No se suman a los indicadores KID para evitar duplicidades.",
        "axa-caption",
      ),
    );
    costs.append(
      table(
        ["Fondo / ISIN", "Gasto corriente", "Entrada máxima", "Fuente / fecha"],
        p.holdings.map(([name]) => {
          const isin = data.fundIsins[names.indexOf(name)],
            f = data.funds[isin];
          const source = el("span");
          source.append(
            link(f?.morningstar, "Morningstar ↗"),
            document.createElement("br"),
          );
          if (f?.source && f.source !== f.morningstar)
            source.append(
              link(f.source, f.sourceName || "Fuente ↗"),
              document.createElement("br"),
            );
          source.append(el("small", f?.date || "Pendiente"));
          return [
            name + " · " + isin,
            f?.ongoing == null ? "No verificado" : percent(f.ongoing),
            f?.entry == null ? "No consta" : percent(f.entry),
            source,
          ];
        }),
      ),
    );
    costs.append(
      el(
        "p",
        "«No consta» no significa 0 %. Los gastos no incluyen necesariamente transacciones o comisiones de éxito. Consulta de fuentes de la presentación: 15/10/2026; algunos datos corresponden a 2025. Los huecos se conservan sin estimar.",
        "axa-caption",
      ),
    );
    panels.costs = costs;
    [
      ["composition", "Composición"],
      ["returns", "Histórico"],
      ["scenarios", "Escenarios"],
      ["costs", "Costes"],
    ].forEach(([key, label]) => {
      const b = el("button", label);
      b.type = "button";
      b.setAttribute("aria-pressed", String(key === "composition"));
      b.addEventListener("click", () => {
        Object.entries(panels).forEach(([k, panel]) => (panel.hidden = k !== key));
        tabs
          .querySelectorAll("button")
          .forEach((button) => button.setAttribute("aria-pressed", String(button === b)));
      });
      tabs.append(b);
      panels[key].hidden = key !== "composition";
      content.append(panels[key]);
    });
    root.append(
      tabs,
      content,
      el(
        "p",
        data.source +
          " · Composición: " +
          data.compositionDate +
          " · KID: " +
          data.kidDate +
          ". Referencia de la documentación aportada, sin actualización automática.",
        "axa-caption axa-source",
      ),
    );
    return root;
  }
  window.AxaPortfolios = { decorate, details, find };
})();
