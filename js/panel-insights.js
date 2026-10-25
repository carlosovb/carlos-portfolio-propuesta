/* v0.6. Datos de actividad solo en memoria; cada consulta vuelve a validar sus permisos. */
(() => {
  const get = (id) => document.getElementById(id),
    backend = window.PortfolioBackend;
  const node = (tag, text, cls) => {
    const n = document.createElement(tag);
    if (text !== undefined) n.textContent = text;
    if (cls) n.className = cls;
    return n;
  };
  const button = (text, fn, cls = "panel-secondary") => {
    const b = node("button", text, cls);
    b.type = "button";
    b.addEventListener("click", fn);
    return b;
  };
  const date = (value) =>
    new Intl.DateTimeFormat("es-ES", {
      dateStyle: "medium",
      timeStyle: "short",
      timeZone: "Atlantic/Canary",
    }).format(new Date(value));
  let active = false,
    revision = 0,
    poll = null,
    startup = false,
    notifications = [],
    unread = 0,
    onlyUnread = false,
    noticeOffset = 0,
    notificationsTicket = 0;
  let activityOffset = 0,
    activityTotal = 0,
    activityTicket = 0,
    searchTicket = 0,
    searchTimer,
    openTicket = 0,
    previewURL = null;
  let historyClient = null,
    historyDemo = false,
    historyOffset = 0,
    historyTotal = 0,
    historyTicket = 0,
    noteBusy = false,
    noteRequest = null;
  const message = (text) => {
    get("panel-notice").textContent = text;
    get("panel-notice").hidden = !text;
  };
  function empty(host, text) {
    host.replaceChildren(node("p", text, "insight-empty"));
  }
  function canUse(ticket) {
    return active && ticket === revision;
  }
  function closePreview() {
    if (previewURL) {
      URL.revokeObjectURL(previewURL);
      previewURL = null;
    }
    get("insight-resource-body").replaceChildren();
    get("insight-resource-title").textContent = "";
  }
  function reset() {
    active = false;
    revision++;
    startup = false;
    clearInterval(poll);
    poll = null;
    clearTimeout(searchTimer);
    searchTicket++;
    notificationsTicket++;
    openTicket++;
    activityTicket++;
    notifications = [];
    unread = 0;
    onlyUnread = false;
    noticeOffset = 0;
    activityOffset = 0;
    activityTotal = 0;
    get("notifications-dialog").close();
    get("insight-resource-dialog").close();
    closePreview();
    closeHistory();
    for (const id of [
      "notifications-list",
      "recent-activity",
      "all-activity",
      "global-search-results",
    ])
      get(id).replaceChildren();
    get("global-search").value = "";
    get("notifications-count").hidden = true;
    get("notifications-count").textContent = "";
    get("notifications-open").setAttribute("aria-label", "Notificaciones");
    get("notifications-intro").textContent = "";
    get("global-search-summary").textContent =
      "Escribe al menos dos caracteres en el buscador del menú.";
  }
  function start(account) {
    if (active || !account || !account.profile_complete) return;
    active = true;
    revision++;
    startup = true;
    refreshNotifications(true);
    if (window.PanelNavigation.current() === "home") loadActivity();
    else if (window.PanelNavigation.current() === "search") search();
    else if (window.PanelNavigation.current() === "activity") loadActivity(true);
    poll = setInterval(() => {
      if (!document.hidden) refreshNotifications();
    }, 45000);
  }
  function tryStartup() {
    if (
      !active ||
      !startup ||
      !unread ||
      window.PanelNavigation.current() !== "home" ||
      document.querySelector("dialog[open]")
    )
      return;
    startup = false;
    onlyUnread = true;
    renderNotifications();
    get("notifications-title").textContent = "Tienes novedades.";
    get("notifications-dialog").showModal();
  }
  async function refreshNotifications(initial = false, append = false) {
    if (!active) return;
    const ticket = revision,
      request = ++notificationsTicket;
    try {
      const data = await backend.panelQuery("get_panel_notifications", {
        p_offset: append ? noticeOffset : 0,
      });
      if (!canUse(ticket) || request !== notificationsTicket) return;
      if (!data || !Array.isArray(data.rows) || !Number.isFinite(Number(data.unread)))
        throw Error("Invalid notices");
      unread = Number(data.unread);
      notifications = append
        ? [...new Map([...notifications, ...data.rows].map((r) => [r.id, r])).values()]
        : data.rows;
      noticeOffset = (append ? noticeOffset : 0) + data.rows.length;
      get("notifications-more").hidden = data.rows.length < 25;
      get("notifications-count").textContent = unread > 99 ? "99+" : String(unread);
      get("notifications-count").hidden = !unread;
      get("notifications-open").setAttribute(
        "aria-label",
        unread ? "Notificaciones: " + unread + " sin leer" : "Notificaciones",
      );
      get("notifications-open").title = "Notificaciones";
      renderNotifications();
      if (initial && !unread) startup = false;
      else if (initial || startup) tryStartup();
    } catch {
      if (!canUse(ticket) || request !== notificationsTicket) return;
      get("notifications-open").title =
        "No se han podido comprobar los avisos. Pulsa para reintentar.";
      if (get("notifications-dialog").open)
        empty(
          get("notifications-list"),
          "No se han podido cargar los avisos. Cierra y vuelve a abrir para reintentar.",
        );
    }
  }
  function renderNotifications() {
    const host = get("notifications-list");
    host.replaceChildren();
    get("notifications-title").textContent = "Notificaciones.";
    get("notifications-intro").textContent = unread
      ? unread + " " + (unread === 1 ? "aviso pendiente" : "avisos pendientes")
      : "Todo al día. No tienes avisos pendientes.";
    get("notifications-unread").setAttribute("aria-pressed", String(onlyUnread));
    get("notifications-read-all").hidden = !unread;
    const rows = notifications.filter((r) => !onlyUnread || !r.read_at);
    if (!rows.length)
      empty(
        host,
        onlyUnread
          ? "No hay avisos pendientes entre los mostrados."
          : "Las próximas novedades aparecerán aquí.",
      );
    for (const row of rows) {
      const article = node("article", undefined, "insight-notification");
      article.dataset.unread = String(!row.read_at);
      const open = button(
        "",
        async () => {
          get("notifications-dialog").close();
          get("notifications-open").focus({ preventScroll: true });
          const ok = await openTarget(row, open);
          if (ok && active) {
            await markRead(row.id);
          }
        },
        "insight-notification-open",
      );
      open.append(
        node("strong", row.title),
        node("span", row.detail),
        node("time", date(row.happened_at)),
      );
      article.append(open);
      if (!row.read_at)
        article.append(
          button(
            "Marcar como leído",
            () => markRead(row.id),
            "panel-text-button insight-read-one",
          ),
        );
      host.append(article);
    }
  }
  async function markRead(id = null) {
    if (!active) return;
    const ticket = revision;
    get("notifications-read-all").disabled = true;
    try {
      await backend.panelQuery("read_panel_notification", { p_id: id });
      if (canUse(ticket)) await refreshNotifications();
    } catch {
      if (canUse(ticket)) {
        get("notifications-intro").textContent =
          "No se ha confirmado la lectura. Vuelve a intentarlo.";
      }
    } finally {
      if (canUse(ticket)) get("notifications-read-all").disabled = false;
    }
  }
  function timeline(host, rows, links = true, append = false) {
    if (!append) host.replaceChildren();
    for (const row of rows) {
      const article = node("article", undefined, "insight-event");
      article.dataset.kind = row.kind.split(".")[0];
      const head = node("div", undefined, "insight-event-head");
      head.append(node("strong", row.title), node("time", date(row.happened_at)));
      article.append(head);
      if (row.client_name && links)
        article.append(node("span", row.client_name, "insight-client-name"));
      if (row.detail) article.append(node("p", row.detail, "insight-event-detail"));
      if (row.actor_name)
        article.append(node("small", "Por " + row.actor_name, "insight-event-author"));
      if (links && row.target_id && row.target_available !== false)
        article.append(
          button(
            "Ver " +
              ({
                client: "ficha",
                form: "formulario",
                resource: "recurso",
                team: "consultor",
              }[row.target_type] || "detalle") +
              " ↗",
            (event) => openTarget(row, event.currentTarget),
            "panel-text-button insight-event-link",
          ),
        );
      host.append(article);
    }
  }
  async function loadActivity(full = false, append = false) {
    if (!active) return;
    const ticket = revision,
      request = ++activityTicket;
    const host = get(full ? "all-activity" : "recent-activity");
    if (!append) empty(host, "Cargando tu actividad…");
    try {
      const data = await backend.panelQuery("get_panel_activity", {
        p_client: null,
        p_offset: full && append ? activityOffset : 0,
      });
      if (!canUse(ticket) || request !== activityTicket) return;
      if (!data || !Array.isArray(data.rows)) throw Error("Invalid activity");
      const rows = full ? data.rows : data.rows.slice(0, 6);
      if (!rows.length && !append) empty(host, "Tu próximo movimiento aparecerá aquí.");
      else timeline(host, rows, true, append);
      if (full) {
        activityOffset = (append ? activityOffset : 0) + data.rows.length;
        activityTotal = data.total;
        get("activity-more").hidden = activityOffset >= activityTotal;
      }
    } catch {
      if (canUse(ticket) && request === activityTicket) {
        if (!append) empty(host, "No se ha podido cargar tu actividad.");
        host.append(button("Reintentar", () => loadActivity(full, append)));
      }
    }
  }
  let recentRequest = 0;
  function closeHistory() {
    recentRequest++;
    historyClient = null;
    historyTicket++;
    historyOffset = 0;
    noteBusy = false;
    noteRequest = null;
    get("client-note").value = "";
    get("client-note-notice").textContent = "";
    get("client-history-list").replaceChildren();
    get("history-more").hidden = true;
    get("client-note-save").disabled = false;
    get("client-recent-event").textContent = "";
  }
  function openHistory(client, demo) {
    closeHistory();
    historyClient = client.id;
    historyDemo = demo;
    get("client-note-form").hidden = demo;
    if (demo)
      empty(
        get("client-history-list"),
        "El historial privado estará disponible con tus clientes reales.",
      );
    const target = client.id,
      ticket = revision,
      request = ++recentRequest;
    const recent = get("client-recent-event");
    recent.textContent = demo
      ? "El historial privado estará disponible con tus clientes reales."
      : "Consultando su última actividad…";
    if (!demo && active)
      backend
        .panelQuery("get_panel_activity", { p_client: target, p_offset: 0 })
        .then((data) => {
          if (!canUse(ticket) || historyClient !== target || recentRequest !== request)
            return;
          const event = data?.rows?.[0];
          recent.textContent = event
            ? event.title + " · " + date(event.happened_at)
            : "Todavía no hay movimientos registrados.";
        })
        .catch(() => {
          if (canUse(ticket) && historyClient === target && recentRequest === request)
            recent.textContent = "Consulta el historial para ver su actividad.";
        });
  }
  async function showHistory(append = false) {
    if (!active || !historyClient || historyDemo) return;
    const ticket = revision,
      request = ++historyTicket,
      target = historyClient,
      host = get("client-history-list");
    if (!append) empty(host, "Preparando su recorrido…");
    try {
      const data = await backend.panelQuery("get_panel_activity", {
        p_client: target,
        p_offset: append ? historyOffset : 0,
      });
      if (!canUse(ticket) || target !== historyClient || request !== historyTicket)
        return;
      if (!Array.isArray(data?.rows)) throw Error("Invalid history");
      historyOffset = (append ? historyOffset : 0) + data.rows.length;
      historyTotal = data.total;
      if (!append && data.rows[0])
        get("client-recent-event").textContent =
          data.rows[0].title + " · " + date(data.rows[0].happened_at);
      if (!data.rows.length && !append)
        empty(
          host,
          "Todavía no hay movimientos registrados. Puedes añadir la primera nota.",
        );
      else timeline(host, data.rows, false, append);
      get("history-more").hidden = historyOffset >= historyTotal;
    } catch {
      if (canUse(ticket) && target === historyClient && request === historyTicket) {
        if (!append) empty(host, "No se ha podido cargar el historial.");
        host.append(button("Reintentar", () => showHistory(append)));
      }
    }
  }
  get("client-note-form").addEventListener("submit", async (event) => {
    event.preventDefault();
    if (!active || !historyClient || historyDemo || noteBusy) return;
    const input = get("client-note"),
      text = input.value.trim();
    if (!text) return;
    const ticket = revision,
      target = historyClient;
    noteRequest ??= crypto.randomUUID();
    noteBusy = true;
    get("client-note-save").disabled = true;
    get("client-note-notice").textContent = "Guardando nota…";
    try {
      await backend.panelQuery("add_client_note", {
        p_client: target,
        p_text: text,
        p_request: noteRequest,
      });
      if (!canUse(ticket) || target !== historyClient) return;
      input.value = "";
      noteRequest = null;
      get("client-note-notice").textContent =
        "Nota guardada. Solo tú puedes consultarla.";
      await showHistory();
    } catch {
      if (canUse(ticket) && target === historyClient)
        get("client-note-notice").textContent =
          "No se ha confirmado el guardado. Conservamos el texto para que puedas reintentar.";
    } finally {
      if (canUse(ticket) && target === historyClient) {
        noteBusy = false;
        get("client-note-save").disabled = false;
      }
    }
  });
  get("client-note").addEventListener("input", () => {
    if (!noteBusy) noteRequest = null;
  });
  async function search() {
    if (!active) return;
    const ticket = revision,
      request = ++searchTicket,
      q = get("global-search").value.trim(),
      host = get("global-search-results");
    host.replaceChildren();
    if (q.length < 2) {
      get("global-search-summary").textContent =
        "Escribe al menos dos caracteres en el buscador del menú.";
      return;
    }
    get("global-search-summary").textContent = "Buscando «" + q + "»…";
    try {
      const data = await backend.panelQuery("search_panel", { p_query: q });
      if (
        !canUse(ticket) ||
        request !== searchTicket ||
        get("global-search").value.trim() !== q
      )
        return;
      if (
        !data ||
        !["clients", "consultants", "resources", "forms"].every((k) =>
          Array.isArray(data[k]),
        )
      )
        throw Error("Invalid search");
      let count = 0;
      for (const [key, label, type] of [
        ["clients", "Clientes e interesados", "client"],
        ["consultants", "Consultores", "team"],
        ["resources", "Herramientas y recursos", "resource"],
        ["forms", "Formularios recibidos", "form"],
      ]) {
        const rows = data?.[key] || [];
        count += rows.length;
        const section = node("section", undefined, "insight-search-group");
        section.append(node("h3", label + " · " + rows.length));
        if (!rows.length)
          section.append(node("p", "Sin coincidencias en este apartado.", "panel-muted"));
        for (const row of rows) {
          const b = button(
            "",
            (event) =>
              openTarget({ target_type: type, target_id: row.id }, event.currentTarget),
            "insight-search-result",
          );
          b.append(node("strong", row.label), node("span", row.meta), node("b", "↗"));
          section.append(b);
        }
        host.append(section);
      }
      get("global-search-summary").textContent = count
        ? count + " coincidencias mostradas para «" + q + "»."
        : "No hay coincidencias para «" + q + "». Prueba con otro nombre o término.";
    } catch {
      if (canUse(ticket) && request === searchTicket) {
        get("global-search-summary").textContent =
          "No se ha podido completar la búsqueda.";
        host.append(button("Reintentar", search));
      }
    }
  }
  async function runSearch() {
    if (!active) return;
    if (window.PanelNavigation.current() === "search") return search();
    await window.PanelNavigation.go("search");
  }
  get("global-search").addEventListener("input", () => {
    clearTimeout(searchTimer);
    searchTicket++;
    searchTimer = setTimeout(runSearch, 300);
  });
  get("global-search").addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      event.preventDefault();
      clearTimeout(searchTimer);
      runSearch();
    }
  });
  document.addEventListener("keydown", (event) => {
    if (active && (event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "k") {
      event.preventDefault();
      const sidebar = document.querySelector(".panel-sidebar");
      sidebar.classList.add("menu-open");
      document.querySelector(".panel-menu-toggle").setAttribute("aria-expanded", "true");
      get("global-search").focus();
      get("global-search").select();
    }
  });
  async function previewResource(id, ticket, request) {
    const row = await backend.panelQuery("get_panel_target", {
      p_type: "resource",
      p_id: id,
    });
    if (!canUse(ticket) || request !== openTicket) return false;
    if (!row) throw Error("El recurso ya no está disponible.");
    closePreview();
    get("insight-resource-title").textContent = row.title;
    const host = get("insight-resource-body");
    host.append(node("p", row.company + " · " + row.product, "panel-muted"));
    get("insight-resource-dialog").showModal();
    if (["link", "web"].includes(row.kind)) {
      const url = new URL(row.url);
      if (url.protocol !== "https:") throw Error("El enlace del recurso no es válido.");
      host.append(node("p", "Esta presentación se abre como una web."));
      const a = node("a", "Abrir presentación ↗", "btn");
      a.href = url.href;
      a.target = "_blank";
      a.rel = "noopener noreferrer";
      host.append(a);
      return true;
    }
    const loading = node("p", "Preparando documento…");
    host.append(loading);
    const blob = await backend.resourceFile(row.storage_path);
    if (!canUse(ticket) || request !== openTicket || !get("insight-resource-dialog").open)
      return false;
    loading.remove();
    const frame = node("iframe");
    frame.title = row.title;
    frame.referrerPolicy = "no-referrer";
    if (row.kind === "html") {
      frame.setAttribute("sandbox", "allow-scripts allow-presentation");
      frame.srcdoc = await blob.text();
    } else {
      previewURL = URL.createObjectURL(blob);
      frame.src = previewURL;
      const a = node("a", "Abrir PDF en otra pestaña ↗", "panel-text-button");
      a.href = previewURL;
      a.target = "_blank";
      a.rel = "noopener";
      host.append(a);
    }
    if (!canUse(ticket) || request !== openTicket) return false;
    host.append(frame);
    return true;
  }
  async function openTarget(row, source) {
    if (!active) return false;
    const ticket = revision,
      request = ++openTicket;
    if (source) source.disabled = true;
    try {
      if (row.target_type === "resource")
        return await previewResource(row.target_id, ticket, request);
      const section = { client: "clients", form: "premeeting", team: "team" }[
        row.target_type
      ];
      if (!section) return false;
      if (
        !(await window.PanelNavigation.go(section)) ||
        !canUse(ticket) ||
        request !== openTicket
      )
        return false;
      if (section === "clients") await window.ClientsPanel.openById(row.target_id);
      else if (section === "premeeting")
        await window.PremeetingPanel.openById(row.target_id);
      else window.TeamPanel.openById(row.target_id);
      return canUse(ticket);
    } catch (error) {
      if (canUse(ticket)) {
        message(
          error.message ||
            "No se ha podido abrir. Actualiza el panel y vuelve a intentarlo.",
        );
        if (get("insight-resource-dialog").open)
          get("insight-resource-body").append(
            node("p", "No se ha podido abrir el documento. Reintenta desde Recursos."),
          );
      }
      return false;
    } finally {
      if (source?.isConnected && canUse(ticket)) source.disabled = false;
    }
  }
  get("activity-more").addEventListener("click", async () => {
    const b = get("activity-more");
    b.disabled = true;
    try {
      await loadActivity(true, true);
    } finally {
      b.disabled = false;
    }
  });
  get("history-more").addEventListener("click", async () => {
    const b = get("history-more");
    b.disabled = true;
    try {
      await showHistory(true);
    } finally {
      b.disabled = false;
    }
  });
  get("notifications-more").addEventListener("click", async () => {
    const b = get("notifications-more");
    b.disabled = true;
    try {
      await refreshNotifications(false, true);
    } finally {
      b.disabled = false;
    }
  });
  get("notifications-open").addEventListener("click", () => {
    if (!active) return;
    onlyUnread = false;
    get("notifications-dialog").showModal();
    refreshNotifications();
  });
  get("notifications-unread").addEventListener("click", () => {
    onlyUnread = !onlyUnread;
    renderNotifications();
  });
  get("notifications-read-all").addEventListener("click", () => markRead());
  for (const dialog of [get("notifications-dialog"), get("insight-resource-dialog")]) {
    let outside = false;
    const beyond = (e) => {
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
      (e) => (outside = e.target === dialog && beyond(e)),
    );
    dialog.addEventListener("click", (e) => {
      if (outside && e.target === dialog && beyond(e)) dialog.close();
      outside = false;
    });
  }
  document
    .querySelectorAll("[data-insight-close]")
    .forEach((b) =>
      b.addEventListener("click", () => get(b.dataset.insightClose).close()),
    );
  get("insight-resource-dialog").addEventListener("close", () => {
    openTicket++;
    closePreview();
  });
  document.addEventListener("panel-view-changed", () => {
    if (active && startup) setTimeout(tryStartup, 0);
  });
  window.PanelInsights = {
    start,
    reset,
    loadActivity,
    search,
    openHistory,
    closeHistory,
    showHistory,
    refreshNotifications,
  };
})();
