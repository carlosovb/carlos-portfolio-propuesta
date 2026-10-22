/* Datos privados en memoria; nunca se guardan clientes en el navegador. */
(() => {
  const backend = window.PortfolioBackend;
  const get = (id) => document.getElementById(id);
  const dialog = get("clients-trash-dialog"),
    list = get("clients-trash-list");
  const notice = get("clients-trash-notice");
  let generation = 0,
    page = 0,
    busy = false;
  const make = (tag, text, className) => {
    const node = document.createElement(tag);
    if (text) node.textContent = text;
    if (className) node.className = className;
    return node;
  };
  const date = (value) =>
    new Intl.DateTimeFormat("es-ES", { dateStyle: "medium", timeStyle: "short" }).format(
      new Date(value),
    );
  async function load() {
    const ticket = ++generation;
    busy = true;
    notice.textContent = "Cargando eliminados…";
    list.replaceChildren();
    get("clients-trash-prev").disabled = get("clients-trash-next").disabled = true;
    try {
      const result = await backend.deletedClients(page);
      if (ticket !== generation || !dialog.open) return;
      if (!result.rows.length && page > 0) {
        page--;
        return load();
      }
      notice.textContent = result.rows.length ? "" : "No hay clientes en Eliminados.";
      for (const row of result.rows) {
        const article = make("article", "", "trash-client");
        const info = make("div");
        info.append(
          make("h3", [row.first_name, row.last_name].filter(Boolean).join(" ")),
          make(
            "p",
            (row.recoverable
              ? "Recuperable hasta el "
              : "Plazo vencido · eliminación pendiente desde el ") + date(row.purge_at),
            "panel-muted",
          ),
        );
        const actions = make("div", "", "trash-actions");
        const action = (label, method, dangerous = false) => {
          const button = make(
            "button",
            label,
            dangerous ? "invitation-delete" : "panel-secondary",
          );
          button.type = "button";
          button.addEventListener("click", async () => {
            if (busy || ticket !== generation) return;
            if (
              dangerous &&
              !(await window.SiteConfirm.ask(
                "¿Eliminar definitivamente este cliente? Se borrarán sus datos personales y productos. Las unidades y comisiones históricas se conservarán. No se podrá recuperar la ficha.",
              ))
            )
              return;
            busy = true;
            list.querySelectorAll("button").forEach((b) => (b.disabled = true));
            try {
              await backend[method](row.id);
              if (ticket !== generation || !dialog.open) return;
              await window.ClientsPanel.load();
              if (ticket !== generation || !dialog.open) return;
              await load();
              if (dialog.open)
                notice.textContent = dangerous
                  ? "Cliente eliminado definitivamente."
                  : "Cliente recuperado con sus productos e historial.";
            } catch {
              if (ticket === generation && dialog.open) {
                notice.textContent =
                  "No se ha podido completar la acción. Puede que el plazo haya vencido. Cierra y vuelve a abrir Eliminados para actualizarlo.";
                list.querySelectorAll("button").forEach((b) => (b.disabled = false));
              }
            } finally {
              if (ticket === generation) busy = false;
            }
          });
          actions.append(button);
        };
        if (row.recoverable) action("Recuperar cliente", "restoreDeletedClient");
        if (result.admin) action("Eliminar definitivamente", "purgeDeletedClient", true);
        article.append(info, actions);
        list.append(article);
      }
      get("clients-trash-page").textContent =
        `${page + 1} de ${Math.max(1, Math.ceil(result.total / 25))}`;
      get("clients-trash-prev").disabled = page === 0;
      get("clients-trash-next").disabled = (page + 1) * 25 >= result.total;
    } catch {
      if (ticket === generation && dialog.open)
        notice.textContent =
          "No se ha podido cargar Eliminados. Cierra la ventana y vuelve a intentarlo.";
    } finally {
      if (ticket === generation) busy = false;
    }
  }
  function reset() {
    generation++;
    busy = false;
    page = 0;
    if (dialog.open) dialog.close();
    list.replaceChildren();
    notice.textContent = "";
    get("clients-trash-page").textContent = "";
  }
  get("clients-trash-open").addEventListener("click", () => {
    reset();
    dialog.showModal();
    load();
  });
  get("clients-trash-close").addEventListener("click", reset);
  dialog.addEventListener("close", () => {
    if (!dialog.open) reset();
  });
  dialog.addEventListener("click", (event) => {
    const bounds = dialog.getBoundingClientRect();
    if (
      event.target === dialog &&
      (event.clientX < bounds.left ||
        event.clientX > bounds.right ||
        event.clientY < bounds.top ||
        event.clientY > bounds.bottom)
    )
      reset();
  });
  for (const [id, delta] of [
    ["clients-trash-prev", -1],
    ["clients-trash-next", 1],
  ])
    get(id).addEventListener("click", () => {
      if (!busy) {
        page += delta;
        load();
      }
    });
  window.ClientTrash = { reset };
})();
