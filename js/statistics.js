// Resúmenes calculados en el servidor; sin nombres ni contratos de clientes.
(() => {
  const host = document.getElementById("statistics-view");
  const backend = window.PortfolioBackend;
  let epoch = 0,
    month = new Intl.DateTimeFormat("sv-SE", {
      timeZone: "Atlantic/Canary",
      year: "numeric",
      month: "2-digit",
    }).format(new Date()),
    scope = "own",
    data;
  const n = (tag, text, cls) => {
    const el = document.createElement(tag);
    if (text !== undefined) el.textContent = text;
    if (cls) el.className = cls;
    return el;
  };
  const num = (value) =>
    new Intl.NumberFormat("es-ES", { maximumFractionDigits: 4 }).format(value || 0);
  const eur = (value) =>
    new Intl.NumberFormat("es-ES", { style: "currency", currency: "EUR" }).format(
      value || 0,
    );
  const names = { own: "Propias", team: "Equipo inferior", global: "Equipo completo" };
  function reset() {
    epoch++;
    data = null;
    host.replaceChildren();
  }
  async function load() {
    const ticket = ++epoch;
    host.replaceChildren(n("p", "Preparando tu producción…"));
    try {
      const result = await backend.getUnitStatistics(month);
      if (ticket !== epoch) return;
      data = result;
      render();
    } catch {
      if (ticket !== epoch) return;
      host.replaceChildren(
        n(
          "p",
          "No se han podido cargar las estadísticas. Pulsa Actualizar para reintentarlo.",
        ),
      );
    }
  }
  function render() {
    host.replaceChildren();
    const hero = n("div", undefined, "stats-heading");
    const copy = n("div");
    copy.append(
      n("p", "CADA FIRMA, UN PASO", "eyebrow"),
      n("h2", "Tu producción, en perspectiva."),
      n(
        "p",
        "Unidades firmadas y comisiones calculadas con los multiplicadores de cada firma.",
      ),
    );
    const label = n("label", "Mes de producción"),
      input = n("input");
    input.type = "month";
    input.value = month;
    input.min = "2000-01";
    input.max = new Intl.DateTimeFormat("sv-SE", {
      timeZone: "Atlantic/Canary",
      year: "numeric",
      month: "2-digit",
    }).format(new Date());
    input.addEventListener("change", () => {
      if (input.value && input.checkValidity()) {
        month = input.value;
        load();
      }
    });
    label.append(input);
    hero.append(copy, label);
    host.append(hero);
    const tabs = n("div", undefined, "stats-tabs");
    tabs.setAttribute("aria-label", "Ámbito de las estadísticas");
    Object.entries(names).forEach(([key, text]) => {
      const b = n("button", text);
      b.type = "button";
      b.setAttribute("aria-pressed", String(scope === key));
      b.onclick = () => {
        scope = key;
        render();
      };
      tabs.append(b);
    });
    host.append(tabs);
    const s = data.scopes[scope] || {},
      metrics = n("div", undefined, "stats-metrics");
    const total = Number(s.own_euros || 0) + Number(s.team_euros || 0);
    [
      ["Unidades firmadas", num(s.units) + " U", "units"],
      [
        scope === "team"
          ? "Comisión por tu equipo"
          : scope === "global"
            ? "Comisiones globales"
            : "Tu comisión propia",
        eur(total),
        "money",
      ],
      ["Comisiones pendientes de cálculo", String(s.pending || 0), "pending"],
    ].forEach(([label, value, kind]) => {
      const a = n("article", undefined, "stats-metric");
      a.dataset.kind = kind;
      a.append(n("small", label), n("strong", value));
      metrics.append(a);
    });
    host.append(metrics);
    const split = n("div", undefined, "stats-split");
    const own = n("article"),
      team = n("article");
    own.append(
      n("p", "PRODUCCIÓN PROPIA", "eyebrow"),
      n("strong", eur(s.own_euros)),
      n("span", num(s.own_units) + " U de firmas propias"),
    );
    team.append(
      n("p", "GENERADO POR EL EQUIPO", "eyebrow"),
      n("strong", eur(s.team_euros)),
      n("span", num(s.team_units) + " U vinculadas a comisiones de equipo"),
    );
    split.append(own, team);
    host.append(split);
    if (scope === "global")
      host.append(
        n(
          "p",
          "Las unidades firmadas se cuentan una sola vez. Las unidades vinculadas al equipo pueden aparecer en varios niveles; los euros suman cada comisión propia y cada diferencia positiva con el firmante.",
          "stats-caption",
        ),
      );
    const incomplete =
      scope === "global"
        ? data.incomplete_global
        : scope === "team"
          ? data.incomplete_team
          : data.undated_own;
    if (incomplete || s.pending) {
      const notice = n(
        "p",
        `${incomplete || 0} productos sin fecha o unidades completas${scope === "global" ? " en la organización" : scope === "team" ? " en tu rama inferior" : " entre tus clientes"}. No se asignan a ningún mes. Los importes mostrados incluyen solo las comisiones calculables.`,
        "stats-warning",
      );
      notice.setAttribute("role", "status");
      host.append(notice);
    }
    const chart = n("section", undefined, "stats-chart");
    chart.append(n("h3", "El ritmo del mes."));
    const days = data.days[scope] || [],
      max = Math.max(1, ...days.map((d) => Number(d.units)));
    const bars = n("div", undefined, "stats-bars");
    bars.setAttribute(
      "aria-label",
      "Unidades por día; desglose accesible en la tabla inferior",
    );
    for (let day = 1; day <= data.last_day; day++) {
      const d = days.find((x) => Number(x.day) === day) || {},
        bar = n("div"),
        fill = n("span");
      bar.title = `Día ${day}: ${num(d.units)} U · ${eur(d.euros)}${d.pending ? " · Importe incompleto" : ""}`;
      fill.style.height = (Number(d.units || 0) / max) * 100 + "%";
      bar.append(fill, n("small", String(day)));
      bars.append(bar);
    }
    chart.append(bars);
    const detail = n("details"),
      summary = n("summary", "Ver desglose diario");
    detail.append(summary);
    const daily = n("table");
    daily.innerHTML =
      "<thead><tr><th>Día</th><th>Unidades</th><th>Euros calculados</th></tr></thead>";
    const body = n("tbody");
    days.forEach((d) => {
      const tr = n("tr");
      tr.append(
        n("td", String(d.day)),
        n("td", num(d.units) + " U"),
        n("td", eur(d.euros) + (d.pending ? " · Incompleto" : "")),
      );
      body.append(tr);
    });
    if (!days.length) {
      const tr = n("tr"),
        td = n("td", "Todavía no hay firmas registradas en este mes.");
      td.colSpan = 3;
      tr.append(td);
      body.append(tr);
    }
    daily.append(body);
    detail.append(daily);
    chart.append(detail);
    host.append(chart);
    if (scope !== "own") {
      const people = n("section", undefined, "stats-people");
      people.append(
        n("h3", "Cada persona, su aportación."),
        n(
          "p",
          "Desglose de tu cuenta y de tus descendientes. El resto de la organización aparece únicamente en el total global.",
        ),
      );
      (data.people || []).forEach((p) => {
        const row = n("article", undefined, "stats-person");
        row.append(n("h4", p.name));
        const own = n("div"),
          team = n("div");
        own.append(
          n("small", "Propias"),
          n("strong", num(p.own_units) + " U"),
          n("span", eur(p.own_euros)),
        );
        team.append(
          n("small", "Gracias a su equipo"),
          n("strong", num(p.team_units) + " U"),
          n("span", eur(p.team_euros)),
        );
        row.append(own, team);
        if (p.pending) row.append(n("small", "Importes incompletos"));
        people.append(row);
      });
      host.append(people);
    }
  }
  window.StatisticsPanel = { load, reset };
})();
