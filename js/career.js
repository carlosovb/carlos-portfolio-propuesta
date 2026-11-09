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
  const demo = ["localhost", "127.0.0.1", "[::1]"].includes(location.hostname) &&
    new URLSearchParams(location.search).get("demo") === "promociones"
    ? { today: "2026-11-07", reviewer: false, row: null } : null;
  async function promotionQuery(name, args) {
    if (!demo) return window.PortfolioBackend.panelQuery(name, args);
    if (name === "list_career_requests") return {
      today: demo.today,
      targets: demo.row || demo.reviewer ? [] : ["team_manager"],
      rows: demo.row ? [{
        ...demo.row, is_own: !demo.reviewer, can_review: demo.reviewer,
        quarter_checks: [{
          start: "2027-01-01", ends_on: "2027-04-01", minimum: null,
          collaborators: [
            { name: "Ana Pérez", position: "financial_consultant", minimum: 300, own_only: true, recorded: 320 },
            { name: "Mario Ruiz", position: "financial_consultant", minimum: 300, own_only: true, recorded: 240 },
            { name: "Sara López", position: "financial_trainee", minimum: null, own_only: true, recorded: 110 },
          ].map((person) => ({ ...person, recorded: demo.today >= "2027-04-01" ? person.recorded : 0 })),
        }],
      }] : [],
    };
    if (name === "request_career_promotion") {
      demo.row = {
        id: "ejemplo", status: "requested", target_code: "team_manager", consultant: "Lucía Martín",
        quarter_start: "2027-01-01", ends_on: "2027-04-01",
        progress: [
          { start: "2027-01-01", own: 450, team: 650 },
          { start: "2027-02-01", own: 520, team: 830 },
          { start: "2027-03-01", own: 600, team: 950 },
        ],
      };
      return;
    }
    demo.row.status = { approve: "tracking", deny: "denied", complete: "completed",
      reject: "unsuccessful", cancel: "cancelled" }[args.p_action];
    demo.row.decision_note = args.p_note;
    if (args.p_action === "complete") window.CareerTrophies.showCelebration({
      name: demo.row.consultant, position: "Gestor de Equipo", position_code: "team_manager",
    }, "Ejemplo local · Tu trofeo quedaría en la vitrina de Equipo.", true);
  }
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
      const heading = node("div", undefined, "career-map-heading");
      heading.append(intro, button("Mis promociones ↗", () => showRequests(), "panel-secondary"));
      content.append(heading);
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
            const name = r.roles?.join(" o ") || levels.find((l) => l.short === r.role).name,
              option = node("div", undefined, "career-team-option");
            option.append(node("strong", String(r.count)), node("span", name + (r.direct ? " directos · Se pueden combinar · Estado Activo pendiente de validar" : "")));
            const icons = node("div", undefined, "career-people-icons");
            icons.setAttribute("aria-hidden", "true");
            for (let i = 0; i < r.count; i++) icons.append(node("span", r.roles?.join("/") || r.role));
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
      if (level.code === "team_manager") list.append(node("li", "Se requieren al menos 9 meses desde el inicio en OVB."));
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
  async function showRequests() {
    const host = node("section", undefined, "career-requests");
    const title = node("h2", "Mis promociones");
    title.id = "career-title";
    title.tabIndex = -1;
    const status = node("p", "Cargando promociones…");
    status.setAttribute("role", "status");
    host.append(button("← Plan de carrera", () => show(null), "panel-text-button"), title, status);
    content.replaceChildren(host);
    if (!dialog.open) dialog.showModal();
    title.focus({ preventScroll: true });
    if (demo) {
      const controls = node("div", undefined, "career-request-actions");
      controls.append(button(demo.reviewer ? "Ver como consultora" : "Ver como responsable", () => {
        demo.reviewer = !demo.reviewer;
        void showRequests();
      }));
      if (demo.row?.status === "tracking" && demo.today < demo.row.ends_on) {
        const started = demo.today >= demo.row.quarter_start;
        controls.append(button(started ? "Simular fin del periodo" : "Simular inicio del periodo", () => {
          demo.today = started ? demo.row.ends_on : demo.row.quarter_start;
          void showRequests();
        }));
      }
      controls.append(button("Reiniciar ejemplo", () => {
        Object.assign(demo, { today: "2026-11-07", reviewer: false, row: null });
        void showRequests();
      }));
      host.append(node("p", "Ejemplo local · Datos ficticios y reloj simulado.", "eyebrow"), controls);
    }
    const displayDate = (value) => new Intl.DateTimeFormat("es-ES", {
      dateStyle: "medium", timeZone: "UTC",
    }).format(new Date(value + "T00:00:00Z"));
    const checkpoint = (label, recorded, minimum, own, closed) => {
      const missing = Math.max(0, minimum - recorded);
      const units = own ? " U propias" : " U totales";
      return node("p", label + " · " + number(recorded) + " / " + number(minimum) + units +
        (missing ? " · " + (closed ? "No cumplido. " : "") + "Faltan " + number(missing) + " U"
          : closed ? " · Cumplido" : " · Mínimo alcanzado, trimestre abierto"));
    };
    const act = async (control, rpc, args, confirmation) => {
      if (control.disabled) return;
      control.disabled = true;
      try {
        if (confirmation && !(await window.SiteConfirm.ask(confirmation))) return;
        await promotionQuery(rpc, args);
        if (host.isConnected) await showRequests();
        if (!demo) void window.PanelInsights?.refreshNotifications();
      } catch {
        status.textContent = "No se ha podido completar la operación. Revisa el estado de la solicitud.";
      } finally {
        control.disabled = false;
      }
    };
    try {
      const result = await promotionQuery("list_career_requests");
      if (!host.isConnected) return;
      const today = result.today;
      status.textContent = result.targets.length
        ? "Ya cumples los requisitos para solicitar tu entrada en promoción."
        : "Seguimiento por trimestres o semestres naturales.";
      if (result.targets.length) {
        const form = node("form", undefined, "career-request-form");
        const label = node("label", "Puesto al que quieres promocionar");
        const select = node("select");
        for (const code of result.targets) {
          const option = node("option", levels.find((l) => l.code === code)?.name || code);
          option.value = code;
          select.append(option);
        }
        label.append(select);
        const submit = node("button", "Avisar a mi responsable", "btn");
        submit.type = "submit";
        form.append(label, submit);
        form.addEventListener("submit", (event) => {
          event.preventDefault();
          void act(submit, "request_career_promotion", { p_target: select.value },
            "¿Enviar la solicitud a tu responsable directo?");
        });
        host.append(form);
      }
      if (!result.rows.length) host.append(node("p", "Todavía no hay solicitudes."));
      for (const row of result.rows) {
        const level = levels.find((l) => l.code === row.target_code);
        const card = node("article", undefined, "career-request-card");
        const labels = {
          requested: "Pendiente de revisión",
          tracking: today < row.quarter_start ? "Programada" : today < row.ends_on ? "En seguimiento" : "Pendiente de resolución",
          completed: "Ascenso confirmado",
          cancelled: "Cancelada",
          denied: "Entrada denegada",
          unsuccessful: "Ascenso no concedido",
        };
        card.append(node("p", labels[row.status], "eyebrow"),
          node("h3", level?.name || row.target_code));
        if (!row.is_own) card.append(node("p", row.consultant));
        card.append(node("p", "Inicio previsto " + displayDate(row.quarter_start) +
          " · Validación a partir del " + displayDate(row.ends_on)));
        if (row.decision_note) card.append(node("p", row.decision_note));
        if (["tracking", "completed", "unsuccessful"].includes(row.status)) {
          const totals = row.progress.reduce((sum, month) => ({
            own: sum.own + Number(month.own), team: sum.team + Number(month.team),
          }), { own: 0, team: 0 });
          const units = ({ own, team }) => number(own) + " U propias · " + number(team) +
            " U del equipo · " + number(Number(own) + Number(team)) + " U totales";
          card.append(node("strong", "Acumulado · " + units(totals)));
          for (const month of row.progress) {
            const block = node("section", undefined, "career-request-quarter");
            const label = new Intl.DateTimeFormat("es-ES", { month: "long", year: "numeric", timeZone: "UTC" })
              .format(new Date(month.start + "T00:00:00Z"));
            const combined = !["financial_consultant_senior_i", "financial_consultant_senior_ii"].includes(row.target_code);
            block.append(node("strong", label), node("p", combined
              ? number(Number(month.own) + Number(month.team)) + " U totales" : units(month)));
            card.append(block);
          }
          for (const quarter of row.quarter_checks || []) {
            const closed = today >= quarter.ends_on;
            const block = node("section", undefined, "career-request-quarter");
            block.append(node("h4", (quarter.own_only ? "Trimestre previo · " : "Trimestre · ") + displayDate(quarter.start)));
            if (quarter.minimum != null)
              block.append(checkpoint("Regla 100 %", quarter.recorded, quarter.minimum, quarter.own_only, closed));
            if (quarter.alternative != null)
              block.append(checkpoint("Regla 125 %", quarter.recorded, quarter.alternative, quarter.own_only, closed));
            if (quarter.historical)
              block.append(checkpoint("Producción propia histórica al cierre", quarter.historical.recorded,
                quarter.historical.minimum, true, closed));
            if (!quarter.own_only) {
              block.append(node("strong", "Estado Activo según unidades · Colaboradores directos"));
              if (row.target_code === "team_manager") {
                const missing = Math.max(0, 3 - quarter.collaborators.length);
                block.append(node("p", quarter.collaborators.length + " FT o FC directos registrados · " +
                  (missing ? "Faltan " + missing + " para llegar a 3" : "Recuento de 3 cubierto")));
              }
              if (!quarter.collaborators.length) block.append(node("p", "Sin colaboradores computables registrados."));
              for (const person of quarter.collaborators) {
                const role = levels.find((level) => level.code === person.position)?.short || person.position;
                const label = person.name + " · " + role;
                block.append(person.minimum == null
                  ? node("p", label + " · " + number(person.recorded) + " U propias · Validación manual. El plan no fija un mínimo numérico de FT.")
                  : checkpoint(label, person.recorded, person.minimum, person.own_only, closed));
              }
            }
            card.append(block);
          }
        }
        const actions = node("div", undefined, "career-request-actions");
        const action = (label, name, confirmation) => {
          const control = button(label, () => act(control, "review_career_request", {
            p_id: row.id, p_action: name,
          }, confirmation));
          actions.append(control);
        };
        const decline = (label, name) => {
          const form = node("form", undefined, "career-request-form");
          const field = node("label", "Motivo de la decisión");
          const reason = node("input");
          reason.required = true;
          reason.maxLength = 500;
          field.append(reason);
          const submit = node("button", label, "panel-secondary");
          form.append(field, submit);
          form.addEventListener("submit", (event) => {
            event.preventDefault();
            if (!reason.value.trim()) return reason.focus();
            void act(submit, "review_career_request", {
              p_id: row.id, p_action: name, p_note: reason.value.trim(),
            }, "¿Guardar esta decisión y avisar al consultor?");
          });
          card.append(form);
        };
        if (row.can_review && row.status === "requested") {
          action("Aprobar entrada", "approve", "¿Has comprobado los requisitos para aprobar la entrada?");
          decline("Denegar entrada", "deny");
        }
        if (row.can_review && row.status === "tracking" && today >= row.ends_on) {
          action("Confirmar ascenso", "complete", "Revisa los mínimos trimestrales, el Estado Activo del equipo y la aprobación formal. ¿Confirmar el ascenso?");
          decline("No conceder ascenso", "reject");
        }
        if (row.is_own && (row.status === "requested" || (row.status === "tracking" && today < row.ends_on)))
          action("Cancelar solicitud", "cancel", "¿Cancelar esta solicitud de promoción?");
        card.append(actions);
        host.append(card);
      }
    } catch {
      status.textContent = "El seguimiento de promociones no está disponible en esta conexión.";
    }
  }
  const legend = document.getElementById("career-levels");
  function renderNextRoles(code) {
    legend.replaceChildren();
    if (!code) {
      legend.append(
        node(
          "p",
          "Tu administrador debe asignarte un puesto para mostrar tus siguientes objetivos.",
        ),
      );
      return;
    }
    const goals = window.CareerProgress.calculate(
      { user_id: "current", position_code: code },
      [],
    ).map((goal) => goal.level);
    if (goals.length === 1) {
      const following = window.CareerProgress.calculate(
        { user_id: "current", position_code: goals[0].code },
        [],
      ).map((goal) => goal.level);
      const next =
        following.find((level) => level.path === "Dirección de equipo") || following[0];
      if (next) goals.push(next);
    }
    for (const level of goals.slice(0, 2)) {
      const b = button("", () => show(level), "career-chip");
      b.title = level.name;
      b.setAttribute("aria-label", "Ver requisitos de " + level.name);
      b.dataset.career = level.code;
      b.append(
        node("span", level.short),
        node("strong", level.name),
        node("b", "×" + number(level.factor)),
      );
      legend.append(b);
    }
    if (!goals.length)
      legend.append(node("p", "Ya ocupas el último puesto incluido en el plan."));
  }
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
  function renderProgress(member, directory, counts, production) {
    const host = document.getElementById("team-member-progress");
    host.replaceChildren();
    host.append(
      node("p", "Tu siguiente paso", "eyebrow"),
      node("h3", "Lo que falta para avanzar."),
    );
    const goals = window.CareerProgress.calculate(member, [], counts, production);
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
            node(
              "small",
              units.recorded === null
                ? "Cuánto falta: pendiente de registrar unidades"
                : number(units.recorded) +
                    " U registradas · Faltan " +
                    number(units.missing) +
                    " U" +
                    (units.incomplete ? " · Recuento incompleto" : ""),
            ),
          );
          box.append(item);
        }
        if (rule.team.length) {
          box.append(node("p", rule.team.some((team) => team.direct) ? "Colaboradores directos" : "Colaboradores de toda su rama", "career-progress-label"));
          rule.team.forEach((team, index) => {
            if (index) box.append(node("p", "O bien", "career-or"));
            const line = node("div", undefined, "career-team-progress");
            if (team.direct) {
              line.append(node("strong", team.count + " " + (team.roles?.join(" o ") || team.role) + " directos"),
                node("p", "Estado Activo durante al menos un trimestre. Pendiente de validación."));
              box.append(line);
              return;
            }
            line.dataset.missing = team.missing;
            const role = levels.find((l) => l.short === team.role);
            line.append(
              node(
                "strong",
                team.missing
                  ? "Faltan " + team.missing + " " + team.role
                  : "Cantidad cubierta · " + team.role,
              ),
              node("span", role.name),
            );
            const progress = node("progress");
            progress.max = team.count;
            progress.value = Math.min(team.observed, team.count);
            progress.setAttribute(
              "aria-label",
              team.role + ": " + team.observed + " de " + team.count,
            );
            const caption = node("div", undefined, "career-progress-caption");
            caption.append(
              node("span", team.observed + " de " + team.count + " registrados"),
              node(
                "b",
                Math.round((Math.min(team.observed, team.count) / team.count) * 100) +
                  " %",
              ),
            );
            line.append(caption, progress);
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
        "Unidades según firmas registradas y trimestres naturales. Los recuentos usan el puesto exacto registrado de cada persona en su rama; Estado Activo y criterios de calidad pendientes de validar.",
        "career-progress-footnote",
      ),
    );
  }
  window.CareerPlan = {
    renderProgress,
    close: () => dialog.close(),
    markCurrent: renderNextRoles,
    showRequests,
    async loadNotice() {
      const notice = document.getElementById("career-entry-notice");
      notice.hidden = true;
      try {
        const result = await promotionQuery("list_career_requests");
        if (window.PanelNavigation.current() !== "home") return;
        const due = result.rows.some((row) => row.can_review &&
          row.status === "tracking" && result.today >= row.ends_on);
        notice.hidden = !result.targets.length && !due &&
          !result.rows.some((row) => row.can_review && row.status === "requested");
        notice.textContent = result.targets.length
          ? "Ya puedes solicitar tu entrada en promoción ↗" : "Tienes promociones pendientes de revisar ↗";
        if (!demo && due) void window.PanelInsights?.refreshNotifications();
      } catch {}
    },
  };
  document.getElementById("career-entry-notice").addEventListener("click", showRequests);
  if (demo) void showRequests();
})();
