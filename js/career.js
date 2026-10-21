(() => {
  const levels = window.CareerLevels,
    dialog = document.getElementById("career-dialog"),
    content = document.getElementById("career-content");
  const number = (value) =>
    new Intl.NumberFormat("es-ES", { useGrouping: "always" }).format(value);
  const node = (tag, text, cls) => {
    const n = document.createElement(tag);
    if (text !== undefined) n.textContent = text;
    if (cls) n.className = cls;
    return n;
  };
  const button = (label, action, cls = "panel-secondary") => {
    const b = node("button", label, cls);
    b.type = "button";
    b.addEventListener("click", action);
    return b;
  };
  function card(level) {
    const b = button("", () => show(level), "career-level");
    b.dataset.career = level.code;
    b.append(
      node("small", level.path),
      node("strong", level.name),
      node("span", "×" + number(level.factor), "career-factor"),
      node("span", "Ver requisitos ↗", "career-action"),
    );
    return b;
  }
  function show(level) {
    content.replaceChildren();
    const heading = node("h2", level ? level.name : "Tu plan de carrera.");
    heading.id = "career-title";
    heading.tabIndex = -1;
    if (level)
      content.append(
        button("← Todos los puestos", () => show(null), "panel-text-button"),
      );
    content.append(
      node("p", level ? level.path : "Crecimiento profesional", "eyebrow"),
      heading,
    );
    if (!level) {
      content.append(
        node(
          "p",
          "Consulta cada puesto para ver su multiplicador, producción y equipo requerido.",
        ),
      );
      const grid = node("div", undefined, "career-grid");
      levels.forEach((l) => grid.append(card(l)));
      content.append(grid);
    } else {
      content.append(
        node(
          "p",
          "×" +
            number(level.factor) +
            " · " +
            number(level.factor) +
            " €/unidad según el documento",
          "career-detail-factor",
        ),
      );
      content.append(
        node(
          "p",
          "Se requieren todas las cifras de producción indicadas y una de las alternativas de colaboradores, cuando se especifiquen.",
        ),
      );
      const columns = node("div", undefined, "career-requirements");
      for (const [label, rule] of [
        ["Regla 100 %", level.base],
        ["Regla 125 %", level.extra],
      ]) {
        const box = node("section", undefined, "career-rule");
        box.append(node("h3", label));
        if (!rule) {
          box.append(
            node(
              "p",
              "El documento no especifica una alternativa del 125 % para este puesto.",
            ),
          );
          columns.append(box);
          continue;
        }
        if (rule.start) box.append(node("p", "Inicio de la actividad.", "career-start"));
        for (const [key, title] of [
          ["quarter", "Unidades trimestrales"],
          ["totalQuarter", "Producción total trimestral"],
          ["historical", "Producción propia histórica"],
        ]) {
          if (rule[key] !== undefined) {
            const metric = node("div", undefined, "career-metric");
            metric.append(node("strong", number(rule[key]) + " U"), node("span", title));
            box.append(metric);
          }
        }
        if (rule.team) {
          box.append(node("h4", "Colaboradores requeridos"));
          rule.team.forEach((requirement, index) => {
            if (index) box.append(node("p", "O bien", "career-or"));
            const other = levels.find((l) => l.short === requirement.role),
              people = node("div", undefined, "career-people");
            people.append(
              node("b", String(requirement.count)),
              node(
                "span",
                other.name +
                  (requirement.count > 1
                    ? " · " + requirement.count + " colaboradores"
                    : ""),
              ),
            );
            const icons = node("div", undefined, "career-people-icons");
            icons.setAttribute("aria-hidden", "true");
            for (let i = 0; i < requirement.count; i++)
              icons.append(node("span", requirement.role));
            people.append(icons);
            box.append(people);
          });
        } else if (!rule.start)
          box.append(
            node(
              "p",
              "Sin un mínimo de colaboradores indicado en el documento.",
              "career-no-team",
            ),
          );
        columns.append(box);
      }
      content.append(columns);
    }
    const notes = node("aside", undefined, "career-notes");
    notes.append(
      node("h3", "Condiciones del plan"),
      node(
        "p",
        "Plan basado en el principio de méritos, con criterios de producción, equipo y profesionalidad.",
      ),
    );
    const list = node("ul");
    for (const text of [
      "Los colaboradores deben estar en Estado Activo.",
      "Deben cumplirse los criterios de calidad.",
      "La regla del 125 % permite un equipo menor al superar la producción exigida en un 25 %, en los puestos que muestran esta alternativa.",
      "Los requisitos de producción propia histórica se mantienen en ambas reglas.",
    ])
      list.append(node("li", text));
    notes.append(
      list,
      node(
        "p",
        "Fuente: plan de carrera facilitado por Carlos. Consulta informativa; la asignación de puestos la realiza el administrador.",
      ),
    );
    content.append(notes);
    if (!dialog.open) dialog.showModal();
    dialog.scrollTop = 0;
    heading.focus({ preventScroll: true });
  }
  const legend = document.getElementById("career-levels");
  levels.forEach((level) => {
    const b = button("", () => show(level), "career-chip");
    b.title = level.name;
    b.setAttribute("aria-label", "Ver requisitos de " + level.name);
    b.dataset.career = level.code;
    b.append(node("span", level.short), node("b", "×" + number(level.factor)));
    legend.append(b);
  });
  for (const select of [
    document.getElementById("my-team-position"),
    document.querySelector("#team-assignment-form [name=position]"),
  ]) {
    select.replaceChildren();
    const empty = node("option", "Pendiente de asignar");
    empty.value = "";
    select.append(empty);
    for (const level of levels) {
      const option = node("option", level.name);
      option.value = level.code;
      select.append(option);
    }
  }
  document.getElementById("career-open").addEventListener("click", () => show(null));
  document.getElementById("career-close").addEventListener("click", () => dialog.close());
  let outside = false;
  const isOutside = (e) => {
    const r = dialog.getBoundingClientRect();
    return (
      e.clientX < r.left ||
      e.clientX > r.right ||
      e.clientY < r.top ||
      e.clientY > r.bottom
    );
  };
  dialog.addEventListener(
    "pointerdown",
    (e) => (outside = e.target === dialog && isOutside(e)),
  );
  dialog.addEventListener("click", (e) => {
    if (outside && e.target === dialog && isOutside(e)) dialog.close();
    outside = false;
  });
  window.CareerPlan = {
    close: () => dialog.close(),
    markCurrent: (code) =>
      legend
        .querySelectorAll("button")
        .forEach((b) => b.toggleAttribute("data-current", b.dataset.career === code)),
  };
})();
