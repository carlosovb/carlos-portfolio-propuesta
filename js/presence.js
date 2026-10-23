// Estado de conexión efímero: actualización ligera y sin datos de clientes.
(() => {
  const backend = window.PortfolioBackend;
  let active = false,
    version = 0,
    timer,
    sessionId = null,
    rows = null,
    checkedAt = 0,
    pending = null;
  const widgets = [...document.querySelectorAll("[data-panel-presence]")];
  function render() {
    const fresh = rows !== null && Date.now() - checkedAt < 95000;
    for (const host of widgets) {
      const opened = host.querySelector("details")?.open;
      host.replaceChildren();
      const details = document.createElement("details"),
        summary = document.createElement("summary"),
        list = document.createElement("div");
      details.className = "presence-summary";
      details.open = !!opened;
      summary.textContent = fresh
        ? rows.length +
          (rows.length === 1 ? " consultor conectado" : " consultores conectados")
        : "Conexión del equipo: comprobando…";
      summary.className = fresh ? "presence-ready" : "";
      list.className = "presence-list";
      if (fresh) {
        for (const row of rows) {
          const item = document.createElement("span");
          item.textContent = row.name;
          list.append(item);
        }
        if (!rows.length)
          list.textContent = "No hay consultores conectados en este momento.";
      } else
        list.textContent = "El estado de conexión no está disponible en este momento.";
      details.append(summary, list);
      host.append(details);
    }
    document.querySelectorAll("[data-presence-user]").forEach((badge) => {
      const connected =
        fresh && rows.some((row) => row.user_id === badge.dataset.presenceUser);
      badge.dataset.state = !fresh ? "unknown" : connected ? "online" : "offline";
      badge.textContent = !fresh
        ? "Comprobando conexión"
        : connected
          ? "Conectado"
          : "Sin conexión";
    });
  }
  function badge(id) {
    const el = document.createElement("span");
    el.className = "consultant-presence";
    el.dataset.presenceUser = id;
    const fresh = rows !== null && Date.now() - checkedAt < 95000;
    const online = fresh && rows.some((row) => row.user_id === id);
    el.dataset.state = !fresh ? "unknown" : online ? "online" : "offline";
    el.textContent = !fresh
      ? "Comprobando conexión"
      : online
        ? "Conectado"
        : "Sin conexión";
    return el;
  }
  async function refresh() {
    if (!active) return;
    if (pending) return pending;
    const ticket = version,
      id = sessionId;
    pending = (async () => {
      try {
        const result = await backend.updatePresence(id, true);
        if (active && ticket === version) {
          if (!Array.isArray(result)) throw Error("Invalid presence");
          rows = result;
          checkedAt = Date.now();
        }
      } catch {
        if (active && ticket === version) {
          rows = null;
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
    rows = null;
    render();
    refresh();
    timer = setInterval(refresh, 25000);
  }
  function stop() {
    const id = sessionId,
      oldPending = pending;
    active = false;
    version++;
    clearInterval(timer);
    timer = null;
    sessionId = null;
    pending = null;
    rows = null;
    render();
    if (!id) return Promise.resolve();
    return Promise.race([
      (async () => {
        await oldPending;
        await backend.updatePresence(id, false);
      })().catch(() => {}),
      new Promise((resolve) => setTimeout(resolve, 2500)),
    ]);
  }
  document.addEventListener("visibilitychange", () => {
    if (active && document.visibilityState === "visible") refresh();
  });
  window.addEventListener("online", refresh);
  window.addEventListener("pagehide", () => {
    stop();
  });
  window.addEventListener("pageshow", (event) => {
    if (event.persisted && !document.getElementById("panel-screen")?.hidden) start();
  });
  window.PanelPresence = { start, stop, badge, refresh };
  render();
})();
