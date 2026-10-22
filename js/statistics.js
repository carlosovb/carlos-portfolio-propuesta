// Resúmenes calculados en el servidor; sin nombres ni contratos de clientes.
(() => {
  const host = document.getElementById("statistics-view");
  const backend = window.PortfolioBackend;
  const currentMonth = () =>
    new Intl.DateTimeFormat("sv-SE", {
      timeZone: "Atlantic/Canary",
      year: "numeric",
      month: "2-digit",
    }).format(new Date());
  let epoch = 0,
    from = currentMonth(),
    to = currentMonth(),
    scope = "own",
    chartMetric = "units",
    data,
    loading = false,
    error = "";
  const monthName = (value) =>
    new Intl.DateTimeFormat("es-ES", {
      month: "short",
      year: "numeric",
      timeZone: "UTC",
    }).format(new Date(value.slice(0, 7) + "-01T12:00:00Z"));
  function monthsBetween(start, end) {
    const result = [];
    let y = Number(start.slice(0, 4)),
      m = Number(start.slice(5, 7));
    while (y + "-" + String(m).padStart(2, "0") <= end.slice(0, 7)) {
      result.push(y + "-" + String(m).padStart(2, "0"));
      if (++m === 13) {
        m = 1;
        y++;
      }
    }
    return result;
  }
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
    loading = false;
    error = "";
    host.replaceChildren();
  }
  async function load() {
    const ticket = ++epoch;
    loading = true;
    error = "";
    render();
    try {
      const result = await backend.getUnitStatistics(from, to);
      if (ticket !== epoch) return;
      data = result;
      loading = false;
      render();
    } catch {
      if (ticket !== epoch) return;
      loading = false;
      error =
        "No se han podido cargar las estadísticas. Revisa el periodo y vuelve a pulsar «Ver periodo».";
      render();
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
    const form = n("form", undefined, "stats-range-form");
    const controls = {};
    for (const [key, label, value] of [
      ["from", "Desde", from],
      ["to", "Hasta", to],
    ]) {
      const field = n("label", label),
        input = n("input");
      input.type = "month";
      input.name = key;
      input.value = value;
      input.required = true;
      input.min = "2000-01";
      input.max = currentMonth();
      input.disabled = loading;
      field.append(input);
      form.append(field);
      window.DatePicker.mount(input);
      controls[key] = input;
    }
    const rangeError = n("p", undefined, "stats-range-error");
    rangeError.setAttribute("role", "alert");
    rangeError.hidden = true;
    function valid() {
      const bad = controls.from.value > controls.to.value;
      rangeError.hidden = !bad;
      rangeError.textContent = bad
        ? "El mes inicial debe ser anterior o igual al mes final."
        : "";
      return !bad;
    }
    controls.from.addEventListener("change", valid);
    controls.to.addEventListener("change", valid);
    const apply = n("button", "Ver periodo", "panel-secondary stats-range-apply");
    apply.type = "submit";
    apply.disabled = loading;
    form.addEventListener("submit", (event) => {
      event.preventDefault();
      if (loading || !valid() || !form.reportValidity()) return;
      from = controls.from.value;
      to = controls.to.value;
      load();
    });
    form.append(apply, rangeError);
    const presets = n("div", undefined, "stats-range-presets");
    for (const [label, start, end] of [
      ["Este mes", currentMonth(), currentMonth()],
      ["Este año", currentMonth().slice(0, 4) + "-01", currentMonth()],
      ["Todo el historial", data?.first_month?.slice(0, 7) || "2000-01", currentMonth()],
    ]) {
      const b = n("button", label);
      b.type = "button";
      b.disabled = loading;
      b.onclick = () => {
        from = start;
        to = end;
        load();
      };
      presets.append(b);
    }
    form.append(presets);
    hero.append(copy, form);
    host.append(hero);
    if (loading) {
      const note = n("p", "Preparando la producción del periodo…", "stats-loading");
      note.setAttribute("role", "status");
      host.append(note);
      return;
    }
    if (error) {
      const note = n("p", error, "stats-warning");
      note.setAttribute("role", "status");
      host.append(note);
      return;
    }
    if (!data) return;
    const rangeLabel = n(
      "p",
      from === to
        ? monthName(from)
        : "De " +
            monthName(from) +
            " a " +
            monthName(to) +
            " · meses completos incluidos",
      "stats-period-label",
    );
    host.append(rangeLabel);
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
    function drawChart() {
      chart.replaceChildren();
      const multiple = from !== to;
      chart.append(n("h3", multiple ? "El ritmo del periodo." : "El ritmo del mes."));
      const days = data.days?.[scope] || [],
        monthly = data.months?.[scope] || [];
      const series = multiple
        ? monthsBetween(from, to).map((month) => ({
            ...monthly.find((row) => row.month.slice(0, 7) === month),
            month,
          }))
        : Array.from({ length: data.last_day }, (_, i) => ({
            ...days.find((row) => Number(row.day) === i + 1),
            day: i + 1,
          }));
      const parts = [
        ["own", "Propias"],
        ["team", "Generado por el equipo"],
      ];
      const value = (row, key) => Number(row[key + "_" + chartMetric] || 0);
      const format = (value) =>
        chartMetric === "euros" ? eur(value) : num(value) + " U";
      const max = Math.max(
        1,
        ...series.flatMap((row) => parts.map(([key]) => value(row, key))),
      );
      const controls = n("div", undefined, "stats-chart-controls");
      controls.setAttribute("role", "group");
      controls.setAttribute("aria-label", "Medida del gráfico");
      for (const [key, label] of [
        ["units", "Unidades"],
        ["euros", "Euros"],
      ]) {
        const b = n("button", label);
        b.type = "button";
        b.dataset.metric = key;
        b.setAttribute("aria-pressed", String(chartMetric === key));
        b.onclick = () => {
          chartMetric = key;
          drawChart();
          chart
            .querySelector('[data-metric="' + key + '"]')
            .focus({ preventScroll: true });
        };
        controls.append(b);
      }
      const legend = n("div", undefined, "stats-chart-legend");
      for (const [key, label] of parts) {
        const item = n("span", label);
        item.dataset.series = key;
        legend.append(item);
      }
      chart.append(controls, legend);
      chart.append(
        n(
          "p",
          (chartMetric === "euros" ? "Euros calculados" : "Unidades") +
            " · " +
            (multiple ? "por mes" : "por día"),
          "stats-caption",
        ),
      );
      const scroll = n("div", undefined, "stats-chart-scroll"),
        bars = n("div", undefined, "stats-bars");
      bars.dataset.period = multiple ? "months" : "days";
      bars.dataset.metric = chartMetric;
      bars.setAttribute(
        "aria-label",
        (chartMetric === "euros" ? "Euros" : "Unidades") +
          (multiple ? " por mes" : " por día") +
          "; propias y equipo, con desglose en la tabla inferior",
      );
      series.forEach((row) => {
        const label = multiple ? monthName(row.month) : String(row.day),
          bar = n("div");
        bar.title =
          label +
          " · Propias: " +
          format(value(row, "own")) +
          " · Equipo: " +
          format(value(row, "team")) +
          (row.pending ? " · Importe incompleto" : "");
        for (const [key, name] of parts) {
          const fill = n("span");
          fill.dataset.series = key;
          fill.style.height = (value(row, key) / max) * 100 + "%";
          fill.title = name + ": " + format(value(row, key));
          bar.append(fill);
        }
        bar.append(n("small", label));
        bars.append(bar);
      });
      scroll.append(bars);
      chart.append(scroll);
      const detail = n("details"),
        summary = n("summary", multiple ? "Ver desglose mensual" : "Ver desglose diario");
      detail.append(summary);
      const daily = n("table"),
        head = n("thead"),
        header = n("tr");
      ["Mes", "Propias", "Generado por el equipo"].forEach((label, i) =>
        header.append(n("th", i === 0 && !multiple ? "Día" : label)),
      );
      head.append(header);
      daily.append(head);
      const body = n("tbody");
      (multiple ? series : days).forEach((row) => {
        const tr = n("tr");
        tr.append(
          n("td", multiple ? monthName(row.month) : String(row.day)),
          n("td", format(value(row, "own"))),
          n("td", format(value(row, "team")) + (row.pending ? " · Incompleto" : "")),
        );
        body.append(tr);
      });
      if (!multiple && !days.length) {
        const tr = n("tr"),
          td = n("td", "Todavía no hay firmas registradas en este mes.");
        td.colSpan = 3;
        tr.append(td);
        body.append(tr);
      }
      daily.append(body);
      detail.append(daily);
      chart.append(detail);
    }
    drawChart();
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
