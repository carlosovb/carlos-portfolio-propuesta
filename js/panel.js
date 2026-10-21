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
  let epoch = 0;
  let view = "home";
  let page = 0;
  let selected = null;
  let searchTimer;
  let inactivityTimer;
  let loadingVersion = 0;
  let mutationPending = false;
  let account = null;

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
    setView(account?.profile_complete === false ? "profile" : "home");
  }

  function renderIdentity() {
    const profile = account?.profile;
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
        15 * 60 * 1000,
      );
  }

  async function logout(message = "Has cerrado sesión.") {
    active = false;
    epoch++;
    loadingVersion++;
    clearTimeout(inactivityTimer);
    clearTimeout(searchTimer);
    selected = null;
    get("request-dialog").close();
    get("request-details").replaceChildren();
    get("request-title").textContent = "";
    get("request-search").value = "";
    get("recent-requests").replaceChildren();
    get("request-list").replaceChildren();
    ["pending-count", "contacted-count", "scheduled-count"].forEach((id) => {
      get(id).textContent = "—";
    });
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
    notice("login-notice", message);
    await backend.signOut();
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
      if (link.origin !== 'https://carlosovb.github.io' || link.pathname !== '/carlos-portfolio-propuesta/cuenta/' || !link.hash.startsWith('#token_hash=')) throw new Error('Invalid invitation');
      get('invitation-url').value = link.href;
      get('invitation-email').textContent = email;
      get('invitation-result').hidden = false;
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
    get('invitation-url').value = '';
    get('invitation-email').textContent = '';
    get('invitation-result').hidden = true;
  }
  get('invite-consultant-form').elements.email.addEventListener('input', clearInvitation);
  get('copy-invitation').addEventListener('click', async () => {
    if (!active || account?.role !== 'admin' || !get('invitation-url').value) return;
    try {
      await navigator.clipboard.writeText(get('invitation-url').value);
      notice('invite-notice', 'Enlace copiado. Ya puedes pegarlo en tu correo.');
    } catch {
      get('invitation-url').focus();
      get('invitation-url').select();
      notice('invite-notice', 'Selecciona y copia el enlace con el menú de tu dispositivo.');
    }
  });

  function row(item) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "request-row";
    const text = document.createElement("span");
    const name = document.createElement("strong");
    name.textContent = item.full_name;
    const subtitle = document.createElement("small");
    subtitle.textContent = `${date(item.created_at)} · ${item.reasons.join(" · ") || "Consulta general"}`;
    text.append(name, subtitle);
    const badge = document.createElement("span");
    badge.className = "request-status";
    badge.textContent = statuses[item.status];
    button.append(text, badge);
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
    } else target.append(...rows.map(row));
  }

  async function load() {
    if (!active) return;
    const snapshot = epoch;
    const version = ++loadingVersion;
    const valid = () => active && epoch === snapshot && version === loadingVersion;
    get("refresh-button").disabled = true;
    notice("panel-notice", "Actualizando…");
    try {
      if (view === "consultants") {
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
          state.textContent = !member.enabled
            ? "Acceso desactivado"
            : member.complete
              ? "Perfil completado"
              : "Pendiente de activar";
          row.append(identity, state);
          get("consultant-list").append(row);
        });
      } else if (view === "profile") {
        const details = await backend.getPanelAccess();
        if (!valid()) return;
        account = details;
        renderIdentity();
        renderProfile();
      } else if (view === "home" && account?.role !== "admin") {
        if (!valid()) return;
        renderIdentity();
      } else if (view === "home") {
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
        const result = await backend.listRequests({
          name: get("request-search").value,
          page,
        });
        if (!valid()) return;
        if (page > 0 && !result.rows.length) {
          page--;
          return load();
        }
        renderList("request-list", result.rows);
        get("request-total").textContent = `${result.total} solicitudes`;
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
    if (!active || !["home", "requests", "profile", "consultants"].includes(next)) return;
    if (account?.profile_complete === false && next !== "profile") next = "profile";
    if (["requests", "consultants"].includes(next) && account?.role !== "admin")
      next = "home";
    if (next !== "consultants") clearInvitation();
    view = next;
    get("home-view").hidden = view !== "home";
    get("requests-view").hidden = view !== "requests";
    get("profile-view").hidden = view !== "profile";
    get("consultants-view").hidden = view !== "consultants";
    get("panel-title").textContent =
      view === "consultants"
        ? "Tu equipo."
        : view === "profile"
          ? "Mi perfil."
          : view === "requests"
            ? "Tus solicitudes."
            : account?.profile?.first_name
              ? `Hola, ${account.profile.first_name}.`
              : "Tu espacio de trabajo.";
    document.querySelectorAll("#panel-navigation button").forEach((button) => {
      if (button.dataset.view === view) button.setAttribute("aria-current", "page");
      else button.removeAttribute("aria-current");
    });
    document.querySelector(".panel-sidebar").classList.remove("menu-open");
    document.querySelector(".panel-menu-toggle").setAttribute("aria-expanded", "false");
    load();
  }

  function openRequest(item) {
    selected = item;
    get("request-title").textContent = item.full_name;
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
    fields.forEach(([label, value]) => {
      const term = document.createElement("dt"),
        description = document.createElement("dd");
      term.textContent = label;
      description.textContent = value;
      details.append(term, description);
    });
    get("request-status").value = item.status;
    notice("dialog-notice", "");
    get("request-dialog").showModal();
  }

  async function mutate(remove) {
    if (!active || !selected || mutationPending) return;
    if (remove && !confirm("¿Eliminar definitivamente esta solicitud?")) return;
    const snapshot = epoch;
    const id = selected.id;
    mutationPending = true;
    get("save-status").disabled = true;
    get("delete-request").disabled = true;
    try {
      if (remove) await backend.deleteRequest(id);
      else await backend.updateStatus(id, get("request-status").value);
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
    if (!backend.ready) return;
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
  get("refresh-button").addEventListener("click", load);
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
