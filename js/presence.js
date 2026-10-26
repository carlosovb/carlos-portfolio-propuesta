// Presencia y registro agregado del panel. Sin información de clientes.
(() => {
  const backend = window.PortfolioBackend;
  let active = false,
    version = 0,
    timer,
    sessionId = null,
    people = null,
    events = [],
    checkedAt = 0,
    pending = null;
  const roleNames = {
    financial_trainee: "FT",
    financial_consultant: "FC",
    financial_consultant_senior_i: "FC I",
    financial_consultant_senior_ii: "FC II",
    team_manager: "GE",
    zone_coordinator: "CZ",
    agency_director: "DA",
    regional_director: "DR",
    national_director: "DN",
  };
  const node = (tag, text, cls) => {
    const n = document.createElement(tag);
    if (text != null) n.textContent = text;
    if (cls) n.className = cls;
    return n;
  };
  const stamp = (value) => {
    const d = new Date(value);
    return value && !Number.isNaN(d.getTime())
      ? new Intl.DateTimeFormat("es-ES", {
          dateStyle: "medium",
          timeStyle: "short",
          timeZone: "Atlantic/Canary",
        }).format(d)
      : null;
  };
  const fresh = () => people !== null && Date.now() - checkedAt < 95000;
  const find = (id) => people?.find((p) => p.user_id === id);
  const connectionText = (p) =>
    p?.last_connected_at
      ? "Última conexión: " + stamp(p.last_connected_at)
      : p?.last_seen_at
        ? "Última actividad: " + stamp(p.last_seen_at)
        : "Sin conexiones registradas";
  const models = [...document.querySelectorAll("[data-panel-presence]")].map((host) => {
    const details = node("details", null, "presence-summary"),
      summary = node("summary"),
      panel = node("div", null, "presence-list"),
      tabs = node("div", null, "presence-tabs"),
      body = node("div", null, "presence-body"),
      latest = node("small", null, "presence-latest-change");
    tabs.setAttribute("role", "group");
    tabs.setAttribute("aria-label", "Información de conexiones");
    const model = { details, summary, panel, tabs, body, latest, tab: "online" };
    for (const [key, label] of [
      ["online", "Ahora"],
      ["last", "Última conexión"],
      ["activity", "Actividad"],
    ]) {
      const button = node("button", label);
      button.type = "button";
      button.dataset.presenceTab = key;
      button.addEventListener("click", () => {
        model.tab = key;
        renderWidget(model);
      });
      tabs.append(button);
    }
    details.addEventListener("toggle", () => {
      if (details.open && active && Date.now() - checkedAt > 5000) refresh();
    });
    panel.append(tabs, body);
    details.append(summary, panel);
    host.replaceChildren(details, latest);
    return model;
  });
  function role(p) {
    const n = node("span", roleNames[p?.position_code] || "—", "presence-role");
    n.dataset.position = p?.position_code || "unassigned";
    n.title = p?.position || "Puesto pendiente de asignar";
    return n;
  }
  function person(p, showLast) {
    const item = node("div", null, "presence-person"),
      info = node("span", null, "presence-person-info");
    info.append(node("strong", p.name, "presence-name"));
    if (p.office_code) info.append(node("small", p.office_code));
    const state = node(
      "small",
      p.online ? "Conectado" : "Sin conexión",
      "presence-person-state",
    );
    state.dataset.state = p.online ? "online" : "offline";
    info.append(state);
    const text = showLast
      ? connectionText(p)
      : p.last_connected_at
        ? "Conectado desde " + stamp(p.last_connected_at)
        : "Conexión detectada";
    info.append(node("small", text, "presence-person-time"));
    item.append(role(p), info);
    return item;
  }
  function renderWidget(m) {
    const ready = fresh(),
      online = ready ? people.filter((p) => p.online) : [];
    const text = ready
      ? online.length +
        (online.length === 1 ? " consultor conectado" : " consultores conectados")
      : "Conexión del equipo: comprobando…";
    if (m.summary.textContent !== text) m.summary.textContent = text;
    m.summary.className = ready ? "presence-ready" : "";
    for (const b of m.tabs.children)
      b.setAttribute("aria-pressed", String(b.dataset.presenceTab === m.tab));
    m.tabs.hidden = !ready;
    const scroll = m.panel.scrollTop;
    m.body.replaceChildren();
    if (!ready) {
      m.body.append(
        node(
          "p",
          "El estado de conexión no está disponible en este momento.",
          "presence-empty",
        ),
      );
      m.latest.hidden = true;
      m.latest.textContent = "";
      return;
    }
    if (m.tab === "activity") {
      for (const event of events) {
        const row = node("div", null, "presence-event"),
          info = node("div");
        row.dataset.kind = event.kind;
        info.append(
          node("strong", event.name),
          node(
            "span",
            event.kind === "connected"
              ? "Se ha conectado"
              : event.inferred
                ? "Desconexión detectada"
                : "Se ha desconectado",
          ),
        );
        const time = node("time", stamp(event.occurred_at));
        time.dateTime = event.occurred_at;
        info.append(time);
        if (event.inferred)
          info.append(node("small", "Hora estimada por falta de actividad"));
        row.append(role(find(event.user_id)), info);
        m.body.append(row);
      }
      if (!events.length)
        m.body.append(
          node(
            "p",
            "Todavía no hay conexiones registradas. Los movimientos se guardan desde la activación de esta función.",
            "presence-empty",
          ),
        );
      m.body.append(
        node(
          "p",
          "Si una ventana se cierra sin avisar, la desconexión se detecta tras unos 90 segundos.",
          "presence-footnote",
        ),
      );
    } else {
      const rows =
        m.tab === "online"
          ? online
          : [...people].sort(
              (a, b) =>
                Number(b.online) - Number(a.online) ||
                (Date.parse(b.last_connected_at) || 0) -
                  (Date.parse(a.last_connected_at) || 0),
            );
      for (const p of rows) m.body.append(person(p, m.tab === "last"));
      if (!rows.length)
        m.body.append(
          node(
            "p",
            m.tab === "online"
              ? "No hay consultores conectados en este momento."
              : "Todavía no hay consultores disponibles.",
            "presence-empty",
          ),
        );
    }
    m.panel.scrollTop = scroll;
    const event = events[0];
    m.latest.hidden = !event;
    m.latest.textContent = event
      ? event.name +
        " · " +
        (event.kind === "connected"
          ? "Se ha conectado"
          : event.inferred
            ? "Desconexión detectada"
            : "Se ha desconectado") +
        " · " +
        stamp(event.occurred_at)
      : "";
  }
  function paintBadge(el) {
    const p = find(el.dataset.presenceUser),
      ready = fresh(),
      online = ready && !!p?.online;
    el.dataset.state = !ready ? "unknown" : online ? "online" : "offline";
    el.textContent = !ready
      ? "Comprobando conexión"
      : online
        ? "Conectado"
        : "Sin conexión";
    el.title = ready ? connectionText(p) : "Estado de conexión pendiente de actualizar";
  }
  function render() {
    models.forEach((m) => {
      if (!active) {
        m.tab = "online";
        m.details.open = false;
      }
      renderWidget(m);
    });
    document.querySelectorAll("[data-presence-user]").forEach(paintBadge);
    document.querySelectorAll("[data-presence-detail]").forEach((el) => {
      const p = find(el.dataset.presenceDetail);
      el.querySelector(".presence-last-connection").textContent = fresh()
        ? connectionText(p)
        : "Comprobando última conexión…";
    });
  }
  function badge(id) {
    const n = node("span", null, "consultant-presence");
    n.dataset.presenceUser = id;
    paintBadge(n);
    return n;
  }
  function details(id) {
    const box = node("div", null, "presence-detail");
    box.dataset.presenceDetail = id;
    box.append(
      badge(id),
      node(
        "small",
        fresh() ? connectionText(find(id)) : "Comprobando última conexión…",
        "presence-last-connection",
      ),
    );
    return box;
  }
  function update(id, connected) {
    return (backend.updateConnectionPresence || backend.updatePresence).call(
      backend,
      id,
      connected,
    );
  }
  async function refresh() {
    if (!active) return;
    if (pending) return pending;
    const ticket = version,
      id = sessionId;
    pending = (async () => {
      try {
        const result = await update(id, true);
        if (active && ticket === version) {
          if (Array.isArray(result)) {
            people = result.map((p) => ({ ...p, online: true }));
            events = [];
          } else if (Array.isArray(result?.people) && Array.isArray(result?.events)) {
            people = result.people;
            events = result.events;
          } else throw Error("Invalid presence");
          checkedAt = Date.now();
        }
      } catch {
        if (active && ticket === version) {
          people = null;
          events = [];
        }
      } finally {
        if (ticket === version) {
          pending = null;
          render();
        }
      }
    })();
    return pending;
  }
  function start() {
    if (active) return;
    active = true;
    version++;
    sessionId = crypto.randomUUID();
    people = null;
    events = [];
    render();
    refresh();
    timer = setInterval(refresh, 25000);
  }
  function stop() {
    const id = sessionId;
    active = false;
    version++;
    clearInterval(timer);
    timer = null;
    sessionId = null;
    pending = null;
    people = null;
    events = [];
    checkedAt = 0;
    render();
    if (!id) return Promise.resolve();
    // El cierre se envía de inmediato; el servidor ignora heartbeats tardíos de esta pestaña.
    return Promise.race([
      update(id, false).catch(() => {}),
      new Promise((resolve) => setTimeout(resolve, 2500)),
    ]);
  }
  document.addEventListener("pointerdown", (event) => {
    document.querySelectorAll(".presence-summary[open]").forEach((d) => {
      if (!d.contains(event.target)) d.open = false;
    });
  });
  document.addEventListener(
    "keydown",
    (event) => {
      if (event.key !== "Escape") return;
      const opened = [...document.querySelectorAll(".presence-summary[open]")];
      if (!opened.length) return;
      event.preventDefault();
      event.stopPropagation();
      const focused = opened.find((d) => d.contains(document.activeElement)) || opened[0];
      opened.forEach((d) => (d.open = false));
      focused.querySelector("summary").focus({ preventScroll: true });
    },
    true,
  );
  document.addEventListener("visibilitychange", () => {
    if (active && document.visibilityState === "visible") refresh();
  });
  window.addEventListener("online", refresh);
  window.addEventListener("offline", () => {
    if (active) {
      people = null;
      events = [];
      checkedAt = 0;
      render();
    }
  });
  window.addEventListener("pagehide", () => stop());
  window.addEventListener("pageshow", (event) => {
    if (event.persisted && !document.getElementById("panel-screen")?.hidden) start();
  });
  window.PanelPresence = { start, stop, badge, details, refresh };
  render();
})();
