(() => {
  const get = (id) => document.getElementById(id),
    backend = window.PortfolioBackend;
  let version = 0;
  function reset() {
    version++;
    get("dashboard-load-note").hidden = true;
    [
      "dashboard-clients",
      "dashboard-interested",
      "dashboard-forms",
      "dashboard-documents",
      "dashboard-position",
      "dashboard-factor",
    ].forEach((id) => (get(id).textContent = "—"));
    get("dashboard-name").textContent = "Tu espacio";
    get("dashboard-form-recent").replaceChildren();
    get("dashboard-doc-recent").replaceChildren();
  }
  async function load(account) {
    reset();
    const ticket = version;
    get("dashboard-name").textContent = account.profile?.first_name
      ? `Vamos a por ello, ${account.profile.first_name}.`
      : "Tu día, con perspectiva.";
    get("dashboard-date").textContent = new Intl.DateTimeFormat("es-ES", {
      weekday: "long",
      day: "numeric",
      month: "long",
    }).format(new Date());
    const results = await Promise.allSettled([
      backend.listClients(),
      backend.listPremeetings(),
      backend.listResources(),
      backend.getMyTeamProfile(),
    ]);
    if (ticket !== version) return;
    const [clients, forms, docs, me] = results.map((r) =>
      r.status === "fulfilled" ? r.value : null,
    );
    get("dashboard-clients").textContent = clients?.stats?.clients ?? "—";
    get("dashboard-interested").textContent = clients?.stats?.interested ?? "—";
    get("dashboard-forms").textContent = forms?.total ?? "—";
    get("dashboard-documents").textContent = docs
      ? docs.filter((d) => !d.archived).length
      : "—";
    get("dashboard-position").textContent = me?.position || "Consulta tu perfil";
    get("dashboard-factor").textContent = me?.multiplier
      ? `×${String(me.multiplier).replace(".", ",")}`
      : "—";
    function recent(id, rows, empty, formatter) {
      const host = get(id);
      host.replaceChildren();
      if (rows === null) {
        host.textContent = "No se ha podido cargar. Pulsa Actualizar para reintentar.";
        return;
      }
      if (!rows.length) {
        host.textContent = empty;
        return;
      }
      rows.slice(0, 3).forEach((row) => {
        const item = document.createElement("div");
        item.className = "dashboard-recent-row";
        const name = document.createElement("strong"),
          meta = document.createElement("small");
        name.textContent = formatter(row);
        meta.textContent = new Date(row.created_at).toLocaleDateString("es-ES");
        item.append(name, meta);
        host.append(item);
      });
    }
    recent(
      "dashboard-form-recent",
      forms?.rows ?? null,
      "Todo al día. Los nuevos formularios aparecerán aquí.",
      (r) => r.full_name,
    );
    recent(
      "dashboard-doc-recent",
      docs
        ? docs
            .filter((r) => !r.archived)
            .sort((a, b) => b.created_at.localeCompare(a.created_at))
        : null,
      "La biblioteca está lista para recibir los primeros documentos.",
      (r) => `${r.company} · ${r.title}`,
    );
    get("dashboard-load-note").hidden = results.every((r) => r.status === "fulfilled");
  }
  window.DashboardPanel = { load, reset };
})();
