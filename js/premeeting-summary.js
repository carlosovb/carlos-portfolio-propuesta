// Resumen seguro: todos los textos de los clientes se insertan con textContent.
(() => {
  const M = window.PremeetingModel;
  const euro = (value) =>
    new Intl.NumberFormat("es-ES", {
      style: "currency",
      currency: "EUR",
      maximumFractionDigits: 2,
    }).format(value);
  const node = (tag, text, cls) => {
    const el = document.createElement(tag);
    if (text !== undefined) el.textContent = text;
    if (cls) el.className = cls;
    return el;
  };
  const format = (m, unit = "€") =>
    M.amount(m) === null
      ? M.statuses[m?.status] || "Sin indicar"
      : unit === "€"
        ? euro(m.value)
        : `${m.value} meses`;
  function render(data, host, edit) {
    host.replaceChildren();
    host.classList.add("premeeting-summary");
    const total = M.calculate(data);
    host.append(
      node(
        "h3",
        data.mode === "couple"
          ? "Vuestra economía, de un vistazo"
          : "Tu economía, de un vistazo",
      ),
    );
    host.append(
      node(
        "p",
        "Estimación mensual: las pagas extra se reparten entre 12 meses. El ahorro acumulado no se suma a los ingresos. Las cuotas de préstamos e hipoteca se cuentan una sola vez.",
      ),
    );
    if (total.incomplete)
      host.append(
        node(
          "p",
          "Cálculo incompleto: faltan cantidades. Los totales incluyen únicamente los importes indicados y pueden cambiar al completar los datos.",
          "premeeting-warning",
        ),
      );
    const metrics = node("div", undefined, "premeeting-totals");
    const max = Math.max(total.income, total.expenses, 1);
    [
      ["Ingresos indicados", total.income],
      ["Gastos indicados", total.expenses],
      ["Disponible estimado", total.available],
    ].forEach(([label, value], i) => {
      const card = node("article", undefined, "premeeting-metric");
      card.dataset.kind = ["income", "expense", "available"][i];
      if (i === 2 && value < 0) card.dataset.negative = "true";
      card.append(
        node("small", ["ENTRA", "SALE", "TU MARGEN"][i], "premeeting-metric-kicker"),
      );
      card.append(node("span", label), node("strong", euro(value)));
      if (i < 2) {
        const bar = node(
          "span",
          undefined,
          "premeeting-bar" + (i === 1 ? " expense" : ""),
        );
        bar.style.width = `${Math.max(1, (value / max) * 100)}%`;
        card.append(bar);
      }
      metrics.append(card);
    });
    host.append(metrics);
    const breakdown = node("div", undefined, "premeeting-breakdown");
    data.people.forEach((person, i) => {
      const result = total.people[i];
      const card = node("article", undefined, "premeeting-person-total");
      const heading = node("div", undefined, "premeeting-person-total-heading");
      heading.append(
        node("span", person.first_name.slice(0, 1).toUpperCase(), "premeeting-initial"),
        node("h4", result.name),
      );
      card.append(heading);
      const list = node("dl");
      [
        ["Ingresos", result.income, "income"],
        ["Gastos personales", result.expenses, "expense"],
        [
          data.mode === "couple"
            ? "Margen antes de gastos comunes"
            : "Disponible estimado",
          result.available,
          "available",
        ],
      ].forEach(([label, value, kind]) => {
        const row = node("div");
        row.dataset.kind = kind;
        if (value < 0) row.dataset.negative = "true";
        row.append(node("dt", label), node("dd", euro(value)));
        list.append(row);
      });
      card.append(list);
      breakdown.append(card);
    });
    host.append(node("h3", "El desglose, sin duplicar gastos"), breakdown);
    if (data.mode === "couple") {
      const shared = node("article", undefined, "premeeting-shared-total");
      shared.append(
        node("small", "UNA SOLA VEZ"),
        node("h4", "Gastos compartidos"),
        node("strong", euro(total.shared)),
        node(
          "p",
          "Se descuentan del total conjunto. No están incluidos en los gastos personales de ninguno de los dos.",
        ),
      );
      host.append(shared);
    }
    host.append(
      node(
        "p",
        data.mode === "couple"
          ? "Disponible conjunto = ingresos de ambos − gastos personales de ambos − gastos compartidos."
          : "Disponible estimado = ingresos indicados − gastos indicados.",
        "premeeting-calculation-note",
      ),
    );
    function section(title, values, step) {
      const details = node("details");
      details.open = true;
      details.append(node("summary", title));
      const dl = node("dl");
      values.forEach(([key, value]) => {
        const row = node("div");
        row.append(node("dt", key), node("dd", value));
        dl.append(row);
      });
      details.append(dl);
      details.open = title === "Contacto";
      if (edit) {
        const button = node("button", "Corregir este apartado", "premeeting-secondary");
        button.type = "button";
        button.addEventListener("click", () => edit(step));
        details.append(button);
      }
      host.append(details);
    }
    section(
      "Contacto",
      [
        ["Modalidad", data.mode === "couple" ? "En pareja" : "Individual"],
        ["Correo", data.contact.email],
        ["Teléfono", data.contact.phone],
      ],
      0,
    );
    data.people.forEach((p, i) => {
      const name = `${p.first_name} ${p.last_name}`;
      section(
        name,
        [
          ["Edad", p.age],
          ["Ocupación", p.occupation],
          ["Situación laboral", p.employment],
        ],
        0,
      );
      section(
        `${name} · Objetivos`,
        p.goals.length
          ? p.goals.map((g) => [
              g.label,
              g.priority ? `Prioridad ${g.priority}` : "Sin prioridad indicada",
            ])
          : [["Objetivos", "Sin seleccionar"]],
        1,
      );
      section(
        `${name} · Ingresos`,
        M.income.map(([key, label]) => [label, format(p.income[key])]),
        2,
      );
      expensesSection(`${name} · Gastos personales`, p);
      assetsSection(`${name} · Ahorro y productos`, p);
      section(
        `${name} · Estimación individual`,
        [
          ["Ingresos mensuales indicados", euro(total.people[i].income)],
          ["Gastos personales indicados", euro(total.people[i].expenses)],
          ["Disponible antes de gastos compartidos", euro(total.people[i].available)],
        ],
        5,
      );
    });
    function expensesSection(title, g) {
      const rows = M.expenses.map(([key, label]) => [label, format(g.expenses[key])]);
      rows.push(["Meses pendientes de hipoteca", format(g.mortgage_months, "meses")]);
      g.loans.forEach((l) => {
        rows.push(
          [`Préstamo: ${l.label} · cuota mensual`, format(l.payment)],
          ["Meses pendientes", format(l.months, "meses")],
        );
      });
      if (!g.loans.length) rows.push(["Otros préstamos", "Ninguno añadido"]);
      section(title, rows, 3);
    }
    function assetsSection(title, g) {
      section(
        title,
        g.assets_skipped
          ? [["Apartado", "Prefiere comentarlo en la reunión"]]
          : g.assets.length
            ? g.assets.map((a) => [
                a.product + (a.label ? ` · ${a.label}` : ""),
                format(a.amount),
              ])
            : [["Productos", "Ninguno añadido"]],
        4,
      );
    }
    if (data.mode === "couple") {
      section(
        "Objetivos compartidos",
        data.shared.goals.length
          ? data.shared.goals.map((g) => [
              g.label,
              g.priority ? `Prioridad ${g.priority}` : "Sin prioridad indicada",
            ])
          : [["Objetivos", "Sin seleccionar"]],
        1,
      );
      expensesSection("Gastos compartidos · una sola vez", data.shared);
      assetsSection("Dinero y productos compartidos · una sola vez", data.shared);
      section(
        "Reparto del cálculo conjunto",
        [
          ["Gastos compartidos indicados", euro(total.shared)],
          [
            "Cálculo",
            "Ingresos de ambos − gastos personales de ambos − gastos compartidos. No se asigna un reparto individual de los gastos comunes.",
          ],
        ],
        5,
      );
    }
    return total;
  }
  window.PremeetingSummary = { render, euro };
})();
