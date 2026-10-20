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

  function notice(id, text) {
    get(id).textContent = text;
    get(id).hidden = !text;
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
    notice("login-notice", message);
    await backend.signOut();
  }

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
    notice("panel-notice", "Cargando solicitudes…");
    try {
      if (view === "home") {
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
        notice(
          "panel-notice",
          "No se han podido cargar las solicitudes. Puedes volver a intentarlo con Actualizar.",
        );
      }
    } finally {
      if (version === loadingVersion) get("refresh-button").disabled = false;
    }
  }

  function setView(next) {
    view = next;
    get("home-view").hidden = view !== "home";
    get("requests-view").hidden = view !== "requests";
    get("panel-title").textContent =
      view === "home" ? "Bienvenido, Carlos." : "Tus solicitudes.";
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
      active = true;
      epoch++;
      get("login-screen").hidden = true;
      get("panel-screen").hidden = false;
      resetInactivity();
      setView("home");
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
  themeButton.addEventListener("click", () => {
    const theme = document.documentElement.dataset.theme === "dark" ? "light" : "dark";
    document.documentElement.dataset.theme = theme;
    try {
      localStorage.setItem("carlos-theme", theme);
    } catch {}
    themeButton.setAttribute(
      "aria-label",
      theme === "dark" ? "Activar modo claro" : "Activar modo oscuro",
    );
  });
})();
