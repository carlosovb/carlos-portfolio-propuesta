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
  let transition;
  function animate(target) {
    transition?.cancel();
    if (!matchMedia("(prefers-reduced-motion: reduce)").matches)
      transition = target.animate(
        [
          { opacity: 0, transform: "translateY(10px)" },
          { opacity: 1, transform: "none" },
        ],
        { duration: 220, easing: "cubic-bezier(.2,.8,.2,1)" },
      );
  }
  function step(level) {
    const b = button("", () => show(level), "career-level career-step");
    b.dataset.career = level.code;
    b.append(
      node("span", level.short, "career-step-code"),
      node("strong", level.name),
      node("b", "×" + number(level.factor), "career-step-rate"),
      node("span", "Explorar ↗", "career-step-link"),
    );
    return b;
  }
  function show(level) {
    content.replaceChildren();
    if (!level) {
      const intro = node("header", undefined, "career-map-intro");
      intro.append(node("p", "TU DESARROLLO PROFESIONAL", "eyebrow"));
      const title = node("h2", "Cada paso, una nueva posibilidad.");
      title.id = "career-title";
      title.tabIndex = -1;
      intro.append(
        title,
        node(
          "p",
          "Elige tu camino. Pulsa un escalón y descubre qué necesitas para llegar.",
        ),
      );
      content.append(intro);
      const lanes = node("div", undefined, "career-lanes");
      for (const [path, caption] of [
        ["Inicio", "Construye tu base"],
        ["Especialización", "Profundiza en tu profesión"],
        ["Dirección de equipo", "Crece con tu equipo"],
      ]) {
        const lane = node("section", undefined, "career-lane");
        lane.dataset.path = path;
        lane.append(node("small", caption), node("h3", path));
        levels.filter((l) => l.path === path).forEach((l) => lane.append(step(l)));
        lanes.append(lane);
      }
      content.append(lanes);
    } else {
      content.append(
        button("← Todos los puestos", () => show(null), "panel-text-button"),
      );
      const layout = node("div", undefined, "career-detail-layout"),
        rail = node("nav", undefined, "career-detail-rail");
      rail.setAttribute("aria-label", "Escalones del plan");
      levels.forEach((l) => {
        const b = button("", () => show(l), "career-rail-button");
        b.dataset.active = String(l.code === level.code);
        b.append(node("b", l.short), node("span", l.name));
        rail.append(b);
      });
      layout.append(rail);
      const main = node("div", undefined, "career-detail-main"),
        hero = node("header", undefined, "career-detail-hero");
      hero.append(node("span", level.short, "career-hero-code"));
      const names = node("div");
      const title = node("h2", level.name);
      title.id = "career-title";
      title.tabIndex = -1;
      names.append(node("p", level.path, "eyebrow"), title);
      hero.append(names);
      const rate = node("div", undefined, "career-hero-rate");
      rate.append(
        node("strong", "×" + number(level.factor)),
        node("span", number(level.factor) + " €/unidad"),
      );
      hero.append(rate);
      main.append(hero);
      const modes = node("div", undefined, "career-rule-switch"),
        sheet = node("div", undefined, "career-rule-sheet");
      modes.setAttribute("aria-label", "Regla de promoción");
      main.append(modes, sheet);
      function renderRule(extra, active) {
        modes
          .querySelectorAll("button")
          .forEach((b) => b.setAttribute("aria-pressed", String(b === active)));
        sheet.replaceChildren();
        const rule = extra ? level.extra : level.base;
        sheet.append(
          node(
            "p",
            extra ? "Más producción, un equipo menor." : "El recorrido de referencia.",
            "career-rule-caption",
          ),
        );
        if (!rule) {
          sheet.append(
            node(
              "p",
              "El documento no especifica una alternativa del 125 % para este puesto.",
              "career-rule-unavailable",
            ),
          );
          return;
        }
        const production = node("section", undefined, "career-production");
        production.append(node("h3", "01 · Tu producción"));
        if (rule.start)
          production.append(node("p", "Inicio de la actividad.", "career-start"));
        for (const [key, label] of [
          ["quarter", "Unidades trimestrales"],
          ["totalQuarter", "Producción total trimestral"],
          ["historical", "Producción propia histórica"],
        ])
          if (rule[key] !== undefined) {
            const metric = node("div", undefined, "career-volume");
            metric.append(
              node("strong", number(rule[key])),
              node("b", "U"),
              node("span", label),
            );
            production.append(metric);
          }
        sheet.append(production);
        const team = node("section", undefined, "career-team");
        team.append(node("h3", "02 · Tu equipo"));
        if (rule.team) {
          team.append(
            node(
              "p",
              rule.team.length > 1
                ? "Una de estas dos alternativas:"
                : "Colaboradores requeridos:",
            ),
          );
          rule.team.forEach((r, index) => {
            if (index) team.append(node("span", "O BIEN", "career-alternative"));
            const other = levels.find((l) => l.short === r.role),
              option = node("div", undefined, "career-team-option");
            option.append(node("strong", String(r.count)), node("span", other.name));
            const icons = node("div", undefined, "career-people-icons");
            icons.setAttribute("aria-hidden", "true");
            for (let i = 0; i < r.count; i++) icons.append(node("span", r.role));
            option.append(icons);
            team.append(option);
          });
        } else
          team.append(
            node(
              "p",
              "Sin mínimo de colaboradores indicado para este puesto.",
              "career-team-none",
            ),
          );
        sheet.append(team);
        animate(sheet);
      }
      for (const [label, extra] of [
        ["100 %", false],
        ["125 %", true],
      ]) {
        const b = button(label, () => renderRule(extra, b), "career-rule-tab");
        b.disabled = extra && !level.extra;
        if (b.disabled) b.title = "El documento no detalla esta alternativa";
        modes.append(b);
      }
      renderRule(false, modes.firstElementChild);
      const conditions = node("details", undefined, "career-conditions");
      conditions.append(node("summary", "Condiciones y criterios del plan"));
      const list = node("ul");
      for (const text of [
        "Se cumplen conjuntamente la producción indicada y una de las alternativas de equipo.",
        "Los colaboradores deben estar en Estado Activo y cumplir los criterios de calidad.",
        "El 125 % aumenta la producción exigida en un 25 %; la producción propia histórica se mantiene.",
        "Plan basado en méritos, producción, equipo y profesionalidad.",
      ])
        list.append(node("li", text));
      conditions.append(
        list,
        node(
          "p",
          "Fuente: documento facilitado por Carlos. La asignación la realiza el administrador.",
        ),
      );
      main.append(conditions);
      layout.append(main);
      content.append(layout);
    }
    if (!dialog.open) dialog.showModal();
    dialog.scrollTop = 0;
    document.getElementById("career-title").focus({ preventScroll: true });
    animate(content);
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
  function renderProgress(member, directory, counts) {
    const host = document.getElementById("team-member-progress");
    host.replaceChildren();
    host.append(
      node("p", "Tu siguiente paso", "eyebrow"),
      node("h3", "Lo que falta para avanzar."),
    );
    const goals = window.CareerProgress.calculate(member, [], counts);
    if (!goals.length) {
      host.append(
        node(
          "p",
          member.position_code
            ? "El documento no define otro puesto posterior en esta vía."
            : "Asigna un puesto para consultar los siguientes objetivos.",
        ),
      );
      return;
    }
    const tabs = node("div", undefined, "career-goal-tabs");
    const body = node("div", undefined, "career-goal-body");
    host.append(tabs, body);
    function select(goal, active) {
      tabs
        .querySelectorAll("button")
        .forEach((b) => b.setAttribute("aria-pressed", String(b === active)));
      body.replaceChildren();
      const title = node("div", undefined, "career-goal-title");
      title.append(
        node("h4", goal.level.name),
        node("strong", "×" + number(goal.level.factor)),
      );
      body.append(title);
      for (const [label, rule] of [
        ["100 %", goal.base],
        ["125 %", goal.extra],
      ]) {
        if (!rule) continue;
        const box = node("section", undefined, "career-progress-rule");
        box.append(node("h4", "Objetivo " + label));
        for (const units of rule.units) {
          const names = {
            quarter: "Unidades trimestrales",
            totalQuarter: "Producción total trimestral",
            historical: "Producción propia histórica",
          };
          const item = node("div", undefined, "career-unit-pending");
          item.append(
            node("strong", number(units.required) + " U"),
            node("span", names[units.kind]),
            node("small", "Cuánto falta: pendiente de registrar unidades"),
          );
          box.append(item);
        }
        if (rule.team.length) {
          box.append(node("p", "Colaboradores de toda su rama", "career-progress-label"));
          rule.team.forEach((team, index) => {
            if (index) box.append(node("p", "O bien", "career-or"));
            const line = node("div", undefined, "career-team-progress");
            line.dataset.missing = team.missing;
            const role = levels.find((l) => l.short === team.role);
            line.append(
              node(
                "strong",
                team.missing
                  ? "Faltan " + team.missing + " " + team.role
                  : "Cantidad cubierta · " + team.role,
              ),
              node(
                "span",
                role.name +
                  " · " +
                  team.observed +
                  " registrados / " +
                  team.count +
                  " requeridos",
              ),
            );
            const progress = node("progress");
            progress.max = team.count;
            progress.value = Math.min(team.observed, team.count);
            progress.setAttribute(
              "aria-label",
              team.role + ": " + team.observed + " de " + team.count,
            );
            line.append(progress);
            box.append(line);
          });
        } else
          box.append(
            node("p", "El puesto no exige un mínimo de colaboradores en el documento."),
          );
        body.append(box);
      }
      body.append(
        button(
          "Ver requisitos completos ↗",
          () => show(goal.level),
          "panel-text-button",
        ),
      );
      if (!matchMedia("(prefers-reduced-motion: reduce)").matches)
        body.animate(
          [
            { opacity: 0, transform: "translateY(8px)" },
            { opacity: 1, transform: "none" },
          ],
          { duration: 200, easing: "ease-out" },
        );
    }
    goals.forEach((goal) => {
      const b = button(goal.level.name, () => select(goal, b), "panel-secondary");
      b.setAttribute("aria-pressed", "false");
      tabs.append(b);
    });
    select(goals[0], tabs.firstElementChild);
    host.append(
      node(
        "p",
        "Las unidades todavía no se han incorporado a las estadísticas. Los recuentos usan el puesto exacto registrado de cada persona en su rama; Estado Activo y criterios de calidad pendientes de validar.",
        "career-progress-footnote",
      ),
    );
  }
  window.CareerPlan = {
    renderProgress,
    close: () => dialog.close(),
    markCurrent: (code) =>
      legend
        .querySelectorAll("button")
        .forEach((b) => b.toggleAttribute("data-current", b.dataset.career === code)),
  };
})();
