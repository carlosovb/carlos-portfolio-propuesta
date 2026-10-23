// Datos de clientes y credenciales solo en memoria; nunca en localStorage ni GitHub.
(() => {
  const backend = window.PortfolioBackend;
  const get = (id) => document.getElementById(id);
  const statuses = {
    pending: "Pendiente de contactar",
    contacted: "Contactado",
    scheduled: "Cita acordada",
  };
  const date = (value) =>
    new Intl.DateTimeFormat("es-ES", {
      dateStyle: "medium",
      timeZone: "Atlantic/Canary",
    }).format(new Date(value));
  let active = false;
  let loggingOut = false;
  let epoch = 0;
  let view = "home";
  let page = 0;
  let selected = null;
  let searchTimer;
  let inactivityTimer;
  let loadingVersion = 0;
  let mutationPending = false;
  let account = null;
  let bulkRunning = false;
  let menuAnimation;
  const bulkLists = Object.fromEntries(
    ["recent-requests", "request-list", "consultant-list"].map((id) => [
      id,
      { items: new Map(), selected: new Set() },
    ]),
  );

  function updateBulk(id) {
    const data = bulkLists[id];
    const bar = document.querySelector('[data-bulk-toolbar="' + id + '"]');
    bar.hidden = account?.role !== "admin" || !data.selected.size;
    const all = bar.querySelector("[data-bulk-all]");
    all.checked = data.items.size > 0 && data.selected.size === data.items.size;
    all.indeterminate = data.selected.size > 0 && data.selected.size < data.items.size;
    all.disabled = mutationPending;
    bar.querySelector("[data-bulk-count]").textContent =
      data.selected.size + " seleccionadas";
    bar.querySelector("[data-bulk-delete]").disabled =
      !data.selected.size || mutationPending;
    get(id)
      .querySelectorAll(".bulk-checkbox")
      .forEach((input) => {
        input.checked = data.selected.has(input.value);
        input.disabled = mutationPending;
      });
  }

  function resetBulk() {
    Object.entries(bulkLists).forEach(([id, data]) => {
      data.items.clear();
      data.selected.clear();
      updateBulk(id);
    });
  }

  function selectableRow(id, itemId, name, content) {
    const data = bulkLists[id];
    data.items.set(itemId, name);
    const wrapper = document.createElement("div");
    wrapper.className = "bulk-row";
    const input = document.createElement("input");
    input.type = "checkbox";
    input.className = "bulk-checkbox";
    input.value = itemId;
    input.setAttribute("aria-label", "Seleccionar " + name);
    input.addEventListener("change", () => {
      if (!mutationPending) {
        if (input.checked) data.selected.add(itemId);
        else data.selected.delete(itemId);
      }
      updateBulk(id);
    });
    wrapper.append(input, content);
    return wrapper;
  }

  document.querySelectorAll("[data-bulk-all]").forEach((input) =>
    input.addEventListener("change", () => {
      const id = input.dataset.bulkAll;
      if (!active || account?.role !== "admin" || mutationPending) return;
      const data = bulkLists[id];
      data.selected = input.checked ? new Set(data.items.keys()) : new Set();
      updateBulk(id);
    }),
  );

  document.querySelectorAll("[data-bulk-delete]").forEach((button) =>
    button.addEventListener("click", async () => {
      if (!active || account?.role !== "admin" || mutationPending) return;
      const listId = button.dataset.bulkDelete;
      const ids = [...bulkLists[listId].selected];
      if (!ids.length) return;
      const invitations = listId === "consultant-list";
      if (
        !(await window.SiteConfirm.ask(
          "¿Eliminar definitivamente " +
            ids.length +
            (invitations
              ? " invitaciones seleccionadas? Sus enlaces dejarán de funcionar."
              : " solicitudes seleccionadas?"),
        ))
      )
        return;
      mutationPending = true;
      bulkRunning = true;
      const snapshot = epoch;
      let removed = 0,
        failed = 0;
      Object.keys(bulkLists).forEach(updateBulk);
      clearInvitation();
      try {
        for (const id of ids) {
          if (!active || epoch !== snapshot) break;
          try {
            if (invitations) await backend.deletePendingInvitation(id);
            else await backend.deleteRequest(id);
            removed++;
          } catch (error) {
            failed++;
            if (error.status === 401 || error.status === 403) break;
          }
          if (active && epoch === snapshot)
            notice(
              "panel-notice",
              "Eliminación en curso: " + (removed + failed) + " de " + ids.length + ".",
            );
        }
      } finally {
        bulkRunning = false;
        mutationPending = false;
        if (active && epoch === snapshot) {
          resetBulk();
          await load();
          const remaining = ids.length - removed;
          notice(
            "panel-notice",
            removed +
              " eliminada(s)." +
              (remaining
                ? " No se ha confirmado la eliminación de " +
                  remaining +
                  ". Revisa el listado actualizado antes de reintentar."
                : " El listado está actualizado."),
          );
        }
      }
    }),
  );

  function notice(id, text) {
    get(id).textContent = text;
    get(id).hidden = !text;
  }

  function enterPanel() {
    account = backend.panelAccess;
    active = true;
    epoch++;
    get("login-screen").hidden = true;
    get("panel-screen").hidden = false;
    resetInactivity();
    renderIdentity();
    window.PanelPresence?.start();
    setView(account?.profile_complete === false ? "profile" : "home");
  }

  function renderIdentity() {
    const profile = account?.profile;
    get("my-profile-name").textContent =
      [profile?.first_name, profile?.last_name].filter(Boolean).join(" ") ||
      "Tu perfil profesional.";
    get("my-position-help").textContent =
      account?.role === "admin"
        ? "Gestiona tu puesto y consulta tu lugar en el equipo."
        : "Tu puesto y responsable los asigna el administrador.";
    get("consultant-display-name").textContent = profile
      ? `${profile.first_name} ${profile.last_name}`
      : "Mi cuenta";
    get("consultant-display-role").textContent =
      account?.role === "admin" ? "Administrador" : "Consultor · RED";
    document.querySelectorAll("[data-admin-only]").forEach((element) => {
      element.hidden = account?.role !== "admin";
    });
    get("consultant-home").hidden = account?.role === "admin";
  }

  function renderProfile() {
    const form = get("profile-form");
    const profile = account?.profile;
    form.elements.first_name.value = profile?.first_name || "";
    form.elements.last_name.value = profile?.last_name || "";
    form.elements.phone.value = profile?.phone || "";
    get("profile-email").value = account?.email || "";
    get("profile-role").value =
      account?.role === "admin" ? "Administrador" : "Consultor · RED";
    get("save-profile").disabled = !account?.profile_enabled;
    notice(
      "profile-setup-notice",
      !account?.profile_enabled
        ? "Falta activar la configuración de perfiles en Supabase. Tu acceso actual sigue funcionando."
        : !account?.profile_complete
          ? "Completa tu nombre, apellidos y teléfono para terminar de preparar tu cuenta."
          : "",
    );
  }

  function resetInactivity() {
    clearTimeout(inactivityTimer);
    if (active)
      inactivityTimer = setTimeout(
        () => logout("La sesión se ha cerrado por inactividad."),
        30 * 60 * 1000,
      );
  }

  async function logout(message = "Has cerrado sesión.") {
    if (loggingOut) return;
    loggingOut = true;
    get("login-button").disabled = true;
    active = false;
    const presenceStopped = window.PanelPresence?.stop();
    epoch++;
    loadingVersion++;
    clearTimeout(inactivityTimer);
    clearTimeout(searchTimer);
    selected = null;
    get("request-dialog").close();
    window.CareerPlan?.close();
    window.TeamPanel?.reset();
    window.ClientsPanel?.reset();
    window.PremeetingPanel?.reset();
    window.ResourcesPanel?.reset();
    window.StatisticsPanel?.reset();
    window.DashboardPanel?.reset();
    get("request-details").replaceChildren();
    get("request-title").textContent = "";
    get("request-initials").textContent = "";
    get("request-current-status").textContent = "";
    get("request-current-status").removeAttribute("data-status");
    get("request-total").textContent = "";
    Object.keys(statuses).forEach(
      (status) => (get("requests-" + status + "-count").textContent = "—"),
    );
    get("request-search").value = "";
    get("recent-requests").replaceChildren();
    get("request-list").replaceChildren();
    ["pending-count", "contacted-count", "scheduled-count"].forEach((id) => {
      get(id).textContent = "—";
    });
    document.body.classList.remove("team-workspace");
    get("panel-screen").hidden = true;
    get("login-screen").hidden = false;
    get("login-form").reset();
    get("profile-form").reset();
    get("password-form").reset();
    get("invite-consultant-form").reset();
    clearInvitation();
    get("consultant-list").replaceChildren();
    notice("invite-notice", "");
    account = null;
    resetBulk();
    notice("login-notice", message);
    await presenceStopped;
    await backend.signOut();
    loggingOut = false;
    get("login-button").disabled = !backend.ready;
  }

  get("invite-consultant-form").addEventListener("submit", async (event) => {
    event.preventDefault();
    if (!active || account?.role !== "admin" || mutationPending) return;
    const snapshot = epoch;
    const button = get("invite-consultant-button");
    const email = event.currentTarget.elements.email.value.trim().toLowerCase();
    if (!/^[^\s@]+@ovb\.es$/.test(email)) {
      notice("invite-notice", "Introduce un correo corporativo @ovb.es.");
      return;
    }
    mutationPending = true;
    button.disabled = true;
    clearInvitation();
    notice("invite-notice", "Generando enlace…");
    try {
      const result = await backend.inviteConsultant(email);
      if (!active || epoch !== snapshot) return;
      const link = new URL(result.invitation_url);
      if (
        link.origin !== "https://carlosovb.github.io" ||
        link.pathname !== "/carlos-portfolio-propuesta/cuenta/" ||
        !link.hash.startsWith("#token_hash=")
      )
        throw new Error("Invalid invitation");
      get("invitation-url").value = link.href;
      get("invitation-email").textContent = email;
      get("invitation-result").hidden = false;
      notice(
        "invite-notice",
        "Enlace generado. Cópialo y envíaselo al consultor desde tu correo.",
      );
      await load();
    } catch (error) {
      if (!active || epoch !== snapshot) return;
      notice(
        "invite-notice",
        error.status === 404
          ? "Falta desplegar la función de invitaciones en Supabase."
          : "No se ha podido generar el enlace. Comprueba que la función esté actualizada en Supabase y que la cuenta no esté ya activada.",
      );
    } finally {
      mutationPending = false;
      button.disabled = false;
    }
  });

  function clearInvitation() {
    get("invitation-url").value = "";
    get("invitation-email").textContent = "";
    get("invitation-result").hidden = true;
  }
  get("invite-consultant-form").elements.email.addEventListener("input", clearInvitation);
  get("copy-invitation").addEventListener("click", async () => {
    if (!active || account?.role !== "admin" || !get("invitation-url").value) return;
    if (
      await window.PortfolioClipboard.copy(
        get("invitation-url").value,
        get("copy-invitation"),
      )
    ) {
      notice("invite-notice", "Enlace copiado. Ya puedes pegarlo en tu correo.");
    } else {
      get("invitation-url").focus();
      get("invitation-url").select();
      notice(
        "invite-notice",
        "Selecciona y copia el enlace con el menú de tu dispositivo.",
      );
    }
  });

  const initials = (name) =>
    name
      .trim()
      .split(/\s+/)
      .slice(0, 2)
      .map((word) => word[0])
      .join("")
      .toUpperCase();

  function row(item) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "request-row request-client-row";
    button.dataset.status = item.status;
    const portrait = document.createElement("span");
    portrait.className = "request-monogram";
    portrait.textContent = initials(item.full_name);
    portrait.setAttribute("aria-hidden", "true");
    const text = document.createElement("span");
    text.className = "request-row-content";
    const heading = document.createElement("span");
    heading.className = "request-row-heading";
    const name = document.createElement("strong");
    name.textContent = item.full_name;
    const badge = document.createElement("span");
    badge.className = "request-status";
    badge.textContent = statuses[item.status];
    badge.dataset.status = item.status;
    heading.append(name, badge);
    const subtitle = document.createElement("span");
    subtitle.className = "request-reason";
    subtitle.textContent = item.reasons.join(" · ") || "Consulta general";
    const contact = document.createElement("span");
    contact.className = "request-contact-preview";
    [item.phone, item.email].filter(Boolean).forEach((value) => {
      const detail = document.createElement("span");
      detail.textContent = value;
      contact.append(detail);
    });
    const footer = document.createElement("span");
    footer.className = "request-row-footer";
    const received = document.createElement("span");
    received.textContent = "Recibida el " + date(item.created_at);
    const hint = document.createElement("span");
    hint.className = "request-open-hint";
    hint.textContent = "Ver solicitud ↗";
    footer.append(received, hint);
    text.append(heading, subtitle, contact, footer);
    button.append(portrait, text);
    button.addEventListener("click", () => openRequest(item));
    return button;
  }

  function renderList(id, rows) {
    const target = get(id);
    target.replaceChildren();
    if (!rows.length) {
      const empty = document.createElement("p");
      empty.className = "panel-empty";
      empty.textContent = "No hay solicitudes para mostrar.";
      target.append(empty);
    } else
      target.append(
        ...rows.map((item) => selectableRow(id, item.id, item.full_name, row(item))),
      );
    updateBulk(id);
  }

  async function load() {
    if (!active || bulkRunning) return;
    resetBulk();
    const snapshot = epoch;
    const version = ++loadingVersion;
    const valid = () => active && epoch === snapshot && version === loadingVersion;
    get("refresh-button").disabled = true;
    notice("panel-notice", "Actualizando…");
    try {
      if (view === "statistics") {
        await window.StatisticsPanel.load(account);
      } else if (view === "resources") {
        await window.ResourcesPanel.load(account);
      } else if (view === "premeeting") {
        await window.PremeetingPanel.load(account);
      } else if (view === "clients") {
        await window.ClientsPanel.load(account);
      } else if (view === "team") {
        await window.TeamPanel.load(account);
      } else if (view === "consultants") {
        get("consultant-list").replaceChildren();
        const members = await backend.listConsultants();
        if (!valid()) return;
        if (!members.length)
          get("consultant-list").textContent =
            "Todavía no has invitado a ningún consultor.";
        members.forEach((member) => {
          const row = document.createElement("article");
          row.className = "request-row";
          const identity = document.createElement("span");
          const name = document.createElement("strong");
          name.textContent = member.name || member.email;
          const email = document.createElement("small");
          email.textContent = member.email;
          identity.append(name, email);
          const state = document.createElement("span");
          state.className = "request-status";
          state.dataset.status = !member.enabled
            ? "disabled"
            : member.complete
              ? "scheduled"
              : "pending";
          state.textContent = !member.enabled
            ? "Acceso desactivado"
            : member.complete
              ? "Perfil completado"
              : "Pendiente de activar";
          row.append(identity, state);
          if (member.can_delete && member.user_id) {
            const remove = document.createElement("button");
            remove.type = "button";
            remove.className = "invitation-delete";
            remove.setAttribute("aria-label", "Eliminar invitación de " + member.email);
            const icon = document.createElementNS("http://www.w3.org/2000/svg", "svg");
            icon.setAttribute("viewBox", "0 0 24 24");
            icon.setAttribute("aria-hidden", "true");
            icon.innerHTML =
              '<path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13M10 11v5M14 11v5" />';
            const label = document.createElement("span");
            label.textContent = "Eliminar invitación";
            remove.append(icon, label);
            remove.addEventListener("click", async () => {
              if (!active || account?.role !== "admin" || mutationPending) return;
              if (
                !(await window.SiteConfirm.ask(
                  "¿Eliminar la invitación de " +
                    member.email +
                    "? Su enlace dejará de funcionar.",
                ))
              )
                return;
              mutationPending = true;
              remove.disabled = true;
              const snapshot = epoch;
              try {
                await backend.deletePendingInvitation(member.user_id);
                if (!active || epoch !== snapshot) return;
                clearInvitation();
                notice(
                  "invite-notice",
                  "Invitación eliminada. Su enlace ya no permite activar la cuenta.",
                );
                await load();
              } catch {
                if (!active || epoch !== snapshot) return;
                clearInvitation();
                notice(
                  "invite-notice",
                  "No se ha confirmado la eliminación. Actualiza el listado: si ya ha completado el perfil y creado su contraseña, la cuenta deja de ser una invitación pendiente. Si sigue pendiente, comprueba que has ejecutado el SQL actualizado.",
                );
                await load();
              } finally {
                mutationPending = false;
                remove.disabled = false;
              }
            });
            row.append(remove);
          }
          get("consultant-list").append(
            member.can_delete && member.user_id
              ? selectableRow("consultant-list", member.user_id, member.email, row)
              : row,
          );
        });
        updateBulk("consultant-list");
      } else if (view === "profile") {
        const details = await backend.getPanelAccess();
        if (!valid()) return;
        account = details;
        renderIdentity();
        renderProfile();
        await window.TeamPanel.loadProfile(account);
      } else if (view === "home") {
        await window.DashboardPanel.load(account);
        if (!valid()) return;
        if (account?.role !== "admin") {
          renderIdentity();
          notice("panel-notice", "");
          return;
        }
        const [counts, latest] = await Promise.all([
          backend.counts(),
          backend.listRequests({ pageSize: 5 }),
        ]);
        if (!valid()) return;
        get("pending-count").textContent = counts.pending;
        get("contacted-count").textContent = counts.contacted;
        get("scheduled-count").textContent = counts.scheduled;
        renderList("recent-requests", latest.rows);
      } else {
        const [result, counts] = await Promise.all([
          backend.listRequests({ name: get("request-search").value, page }),
          backend.counts(),
        ]);
        if (!valid()) return;
        if (page > 0 && !result.rows.length) {
          page--;
          return load();
        }
        Object.keys(statuses).forEach((status) => {
          get("requests-" + status + "-count").textContent = counts[status];
        });
        renderList("request-list", result.rows);
        get("request-total").textContent =
          `${result.total} ${result.total === 1 ? "solicitud" : "solicitudes"}`;
        get("page-label").textContent = `Página ${page + 1}`;
        get("previous-page").disabled = page === 0;
        get("next-page").disabled = (page + 1) * 25 >= result.total;
      }
      notice("panel-notice", "");
    } catch (error) {
      if (!valid()) return;
      if (error.status === 401 || error.status === 403)
        await logout("Tu sesión ya no está disponible. Vuelve a entrar.");
      else {
        // No mantener resultados antiguos en pantalla si la actualización falla.
        get("recent-requests").replaceChildren();
        get("request-list").replaceChildren();
        Object.keys(statuses).forEach(
          (status) => (get("requests-" + status + "-count").textContent = "—"),
        );
        get("request-total").textContent = "";
        get("consultant-list").replaceChildren();
        notice(
          "panel-notice",
          "No se ha podido cargar este apartado. Comprueba su configuración en Supabase y vuelve a intentarlo con Actualizar.",
        );
      }
    } finally {
      if (version === loadingVersion) get("refresh-button").disabled = false;
    }
  }

  function setView(next) {
    if (bulkRunning) return;
    if (
      !active ||
      ![
        "home",
        "requests",
        "profile",
        "consultants",
        "team",
        "clients",
        "premeeting",
        "resources",
        "statistics",
      ].includes(next)
    )
      return;
    if (account?.profile_complete === false && next !== "profile") next = "profile";
    if (["requests", "consultants"].includes(next) && account?.role !== "admin")
      next = "home";
    if (next !== "consultants") clearInvitation();
    view = next;
    document.querySelector(".panel-retention").hidden =
      !["home", "requests"].includes(view) || account?.role !== "admin";
    document.body.classList.toggle("team-workspace", view === "team");
    window.ClientsPanel?.hide();
    window.PremeetingPanel?.hide();
    window.ResourcesPanel?.hide();
    window.StatisticsPanel?.reset();
    get("statistics-view").hidden = view !== "statistics";
    window.DashboardPanel?.reset();
    get("resources-view").hidden = view !== "resources";
    get("premeeting-view").hidden = view !== "premeeting";
    get("clients-view").hidden = view !== "clients";
    get("home-view").hidden = view !== "home";
    get("requests-view").hidden = view !== "requests";
    get("profile-view").hidden = view !== "profile";
    get("team-view").hidden = view !== "team";
    get("consultants-view").hidden = view !== "consultants";
    get("panel-title").textContent =
      view === "statistics"
        ? "Tus estadísticas."
        : view === "resources"
          ? "Herramientas y recursos."
          : view === "premeeting"
            ? "Antes de la reunión."
            : view === "clients"
              ? "Tus clientes."
              : view === "team"
                ? "Nuestro equipo."
                : view === "consultants"
                  ? "Tu equipo."
                  : view === "profile"
                    ? "Mi perfil."
                    : view === "requests"
                      ? "Tus solicitudes."
                      : "Tu panel.";
    document.querySelectorAll("#panel-navigation button").forEach((button) => {
      if (button.dataset.view === view) button.setAttribute("aria-current", "page");
      else button.removeAttribute("aria-current");
    });
    document.querySelector(".panel-sidebar").classList.remove("menu-open");
    document.querySelector(".panel-menu-toggle").setAttribute("aria-expanded", "false");
    menuAnimation?.cancel();
    if (!matchMedia("(prefers-reduced-motion: reduce)").matches) {
      const section = get(view + "-view");
      menuAnimation = section.animate(
        [
          { opacity: 0, transform: "translateY(8px)" },
          { opacity: 1, transform: "translateY(0)" },
        ],
        { duration: 180, easing: "ease-out" },
      );
    }
    load();
  }

  function openRequest(item) {
    if (mutationPending) return;
    selected = item;
    get("request-title").textContent = item.full_name;
    get("request-initials").textContent = initials(item.full_name);
    get("request-current-status").textContent = statuses[item.status];
    get("request-current-status").dataset.status = item.status;
    const details = get("request-details");
    details.replaceChildren();
    const fields = [
      ["Teléfono", item.phone],
      ["Correo", item.email],
      ["Motivos", item.reasons.join(" · ") || "Sin especificar"],
      ["Franja de llamada", item.call_time],
      ["Comentario", item.comment || "Sin comentario"],
      ["Recibida", date(item.created_at)],
      ["Caduca", date(item.expires_at)],
    ];
    fields.forEach(([label, value], index) => {
      const group = document.createElement("div");
      group.className = "request-detail-field";
      if ([2, 3, 4].includes(index)) group.classList.add("request-detail-wide");
      const term = document.createElement("dt"),
        description = document.createElement("dd");
      term.textContent = label;
      description.textContent = value;
      group.append(term, description);
      details.append(group);
    });
    get("request-status")
      .querySelectorAll("input")
      .forEach((input) => {
        input.checked = input.value === item.status;
      });
    notice("dialog-notice", "");
    get("request-dialog").showModal();
  }

  async function mutate(remove) {
    if (!active || !selected || mutationPending) return;
    if (
      remove &&
      !(await window.SiteConfirm.ask("¿Eliminar definitivamente esta solicitud?"))
    )
      return;
    const snapshot = epoch;
    const id = selected.id;
    mutationPending = true;
    get("save-status").disabled = true;
    get("delete-request").disabled = true;
    try {
      if (remove) await backend.deleteRequest(id);
      else
        await backend.updateStatus(
          id,
          get("request-status").querySelector("input:checked").value,
        );
      if (snapshot !== epoch || !active) return;
      selected = null;
      get("request-dialog").close();
      await load();
    } catch (error) {
      if (snapshot === epoch && active) notice("dialog-notice", error.message);
    } finally {
      mutationPending = false;
      get("save-status").disabled = false;
      get("delete-request").disabled = false;
    }
  }

  get("login-button").disabled = !backend.ready;
  notice(
    "login-notice",
    backend.ready
      ? "Acceso exclusivo para la cuenta autorizada."
      : "El panel está preparado. Falta conectar el almacenamiento privado para activar el acceso.",
  );
  get("login-form").addEventListener("submit", async (event) => {
    event.preventDefault();
    if (!backend.ready || loggingOut) return;
    const form = event.currentTarget;
    get("login-button").disabled = true;
    notice("login-notice", "Comprobando acceso…");
    try {
      await backend.signIn(
        form.elements.email.value.trim(),
        form.elements.password.value,
      );
      form.reset();
      enterPanel();
    } catch {
      form.elements.password.value = "";
      notice(
        "login-notice",
        "No se ha podido acceder. Comprueba tus datos y que tu cuenta esté autorizada.",
      );
    } finally {
      get("login-button").disabled = false;
    }
  });

  document
    .querySelectorAll("[data-view]")
    .forEach((button) =>
      button.addEventListener("click", () => setView(button.dataset.view)),
    );
  get("logout-button").addEventListener("click", () => logout());
  get("profile-form").addEventListener("submit", async (event) => {
    event.preventDefault();
    if (!active || !account?.profile_enabled) return;
    const snapshot = epoch;
    const form = event.currentTarget;
    get("save-profile").disabled = true;
    notice("profile-notice", "Guardando…");
    try {
      const details = await backend.saveProfile({
        first_name: form.elements.first_name.value.trim(),
        last_name: form.elements.last_name.value.trim(),
        phone: form.elements.phone.value.trim(),
      });
      if (!active || epoch !== snapshot) return;
      account = details;
      renderIdentity();
      renderProfile();
      notice("profile-notice", "Tus datos se han guardado.");
    } catch {
      if (active && epoch === snapshot)
        notice(
          "profile-notice",
          "No se han podido guardar los datos. Revisa los campos y vuelve a intentarlo.",
        );
    } finally {
      get("save-profile").disabled = !account?.profile_enabled;
    }
  });
  get("password-form").addEventListener("submit", async (event) => {
    event.preventDefault();
    if (!active) return;
    const form = event.currentTarget;
    if (form.elements.new_password.value !== form.elements.confirm_password.value) {
      notice("password-notice", "Las contraseñas nuevas no coinciden.");
      return;
    }
    const snapshot = epoch;
    get("change-password").disabled = true;
    notice("password-notice", "Comprobando y actualizando contraseña…");
    try {
      await backend.changePassword(
        form.elements.current_password.value,
        form.elements.new_password.value,
      );
      if (epoch === snapshot && active)
        await logout("Contraseña actualizada. Entra de nuevo con tu nueva contraseña.");
    } catch {
      if (epoch === snapshot && active)
        notice(
          "password-notice",
          "No se ha confirmado el cambio. Comprueba tu contraseña actual o utiliza la recuperación de acceso.",
        );
    } finally {
      form.reset();
      get("change-password").disabled = false;
    }
  });
  get("refresh-button").addEventListener("click", () => {
    backend.invalidateCache();
    load();
  });
  get("previous-page").addEventListener("click", () => {
    page = Math.max(0, page - 1);
    load();
  });
  get("next-page").addEventListener("click", () => {
    page++;
    load();
  });
  get("request-search").addEventListener("input", () => {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(() => {
      page = 0;
      load();
    }, 250);
  });
  get("close-dialog").addEventListener("click", () => get("request-dialog").close());
  get("save-status").addEventListener("click", () => mutate(false));
  get("delete-request").addEventListener("click", () => mutate(true));
  document.querySelector(".panel-menu-toggle").addEventListener("click", (event) => {
    const open = document.querySelector(".panel-sidebar").classList.toggle("menu-open");
    event.currentTarget.setAttribute("aria-expanded", String(open));
  });
  ["pointerdown", "keydown", "scroll"].forEach((name) =>
    addEventListener(name, resetInactivity, { passive: true }),
  );
  addEventListener("pagehide", () => {
    logout("");
  });
  addEventListener("pageshow", (event) => {
    if (event.persisted) location.reload();
  });

  const themeButton = document.querySelector(".theme");
  let selectedTheme = document.documentElement.dataset.theme;
  themeButton.addEventListener("click", () => {
    const theme = selectedTheme === "dark" ? "light" : "dark";
    selectedTheme = theme;
    const render = () => {
      document.documentElement.dataset.theme = theme;
      themeButton.textContent = theme === "dark" ? "☀" : "☾";
      themeButton.setAttribute(
        "aria-label",
        theme === "dark" ? "Activar modo claro" : "Activar modo oscuro",
      );
    };
    if (window.transitionPortfolioTheme) window.transitionPortfolioTheme(render);
    else render();
    try {
      localStorage.setItem("carlos-theme", theme);
    } catch {}
    themeButton.setAttribute(
      "aria-label",
      theme === "dark" ? "Activar modo claro" : "Activar modo oscuro",
    );
  });

  // Acceso desde el formulario de la página principal, sin pedir la contraseña otra vez.
  if (backend.ready) {
    get("login-button").disabled = true;
    backend
      .resumePanelRedirect()
      .then((restored) => {
        if (restored) enterPanel();
      })
      .finally(() => {
        get("login-button").disabled = false;
      });
  }
})();
