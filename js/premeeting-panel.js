(() => {
  const get = (id) => document.getElementById(id),
    backend = window.PortfolioBackend;
  let currentAccount = null;
  let epoch = 0,
    active = false,
    page = 0,
    selected = new Set(),
    busy = false;
  const node = (tag, text, cls) => {
    const n = document.createElement(tag);
    if (text !== undefined) n.textContent = text;
    if (cls) n.className = cls;
    return n;
  };
  const notice = (text) => {
    get("premeeting-panel-notice").textContent = text;
    get("premeeting-panel-notice").hidden = !text;
  };
  const dialog = get("premeeting-detail");
  function reset() {
    epoch++;
    currentAccount = null;
    active = false;
    page = 0;
    selected.clear();
    get("premeeting-bulk").hidden = true;
    busy = false;
    get("premeeting-response-list").replaceChildren();
    get("premeeting-private-summary").replaceChildren();
    get("premeeting-recent").replaceChildren();
    get("premeeting-response-count").textContent = "—";
    get("premeeting-select-all").checked = false;
    get("premeeting-select-all").indeterminate = false;
    get("premeeting-delete-selected").disabled = true;
    get("premeeting-delete-selected").textContent = "Eliminar seleccionadas";
    dialog.close();
    notice("");
  }
  function hide() {
    reset();
  }
  async function load(account) {
    if (!account || account.profile_complete === false) return reset();
    currentAccount = account;
    active = true;
    const ticket = ++epoch;
    selected.clear();
    get("premeeting-delete-selected").disabled = true;
    get("premeeting-select-all").checked = false;
    get("premeeting-response-list").replaceChildren();
    notice("Cargando respuestas…");
    try {
      const result = await backend.listPremeetings(page);
      if (!active || ticket !== epoch) return;
      if (page > 0 && !result.rows.length) {
        page--;
        return load(account);
      }
      get("premeeting-response-count").textContent = String(result.total);
      get("premeeting-page-label").textContent = `Página ${page + 1}`;
      get("premeeting-previous").disabled = page === 0;
      get("premeeting-following").disabled = (page + 1) * 25 >= result.total;
      result.rows.forEach((row) => {
        const article = node("article", undefined, "premeeting-list-row"),
          label = node("label"),
          check = node("input"),
          text = node("span");
        check.type = "checkbox";
        check.dataset.responseId = row.id;
        check.setAttribute("aria-label", `Seleccionar respuesta de ${row.full_name}`);
        check.addEventListener("change", () => {
          check.checked ? selected.add(row.id) : selected.delete(row.id);
          selection();
        });
        text.append(
          node("strong", row.full_name),
          node(
            "small",
            `Recibido: ${new Date(row.created_at).toLocaleDateString("es-ES")} · Se elimina: ${new Date(row.expires_at).toLocaleDateString("es-ES")}`,
          ),
        );
        label.append(check, text);
        const open = node("button", "Ver respuestas ↗", "premeeting-secondary");
        open.type = "button";
        open.addEventListener("click", async () => {
          const version = epoch;
          open.disabled = true;
          notice("");
          try {
            const payload = await backend.getPremeeting(row.id);
            if (!active || version !== epoch) return;
            get("premeeting-detail-name").textContent = row.full_name;
            window.PremeetingSummary.render(payload, get("premeeting-private-summary"));
            dialog.showModal();
          } catch {
            if (active && version === epoch)
              notice(
                "No se ha podido abrir. La respuesta puede haber caducado; actualiza el listado.",
              );
          } finally {
            open.disabled = false;
          }
        });
        article.append(label, open);
        get("premeeting-response-list").append(article);
      });
      notice(
        result.rows.length
          ? ""
          : "Todavía no hay formularios recibidos. Copia el enlace para compartirlo con tu cliente.",
      );
    } catch {
      if (active && ticket === epoch)
        notice(
          "No se han podido cargar las respuestas. Vuelve a intentarlo con Actualizar.",
        );
    }
  }
  function selection() {
    get("premeeting-bulk").hidden = !selected.size;
    get("premeeting-delete-selected").disabled = !selected.size || busy;
    get("premeeting-delete-selected").textContent = selected.size
      ? `Eliminar seleccionadas (${selected.size})`
      : "Eliminar seleccionadas";
    const checks = [...document.querySelectorAll("[data-response-id]")];
    get("premeeting-select-all").checked =
      !!checks.length && selected.size === checks.length;
    get("premeeting-select-all").indeterminate =
      selected.size > 0 && selected.size < checks.length;
  }
  get("premeeting-select-all").addEventListener("change", (event) => {
    document.querySelectorAll("[data-response-id]").forEach((check) => {
      check.checked = event.target.checked;
      check.checked
        ? selected.add(check.dataset.responseId)
        : selected.delete(check.dataset.responseId);
    });
    selection();
  });
  get("premeeting-delete-selected").addEventListener("click", async () => {
    if (
      busy ||
      !selected.size ||
      !confirm(`¿Eliminar definitivamente ${selected.size} respuestas seleccionadas?`)
    )
      return;
    const version = epoch;
    busy = true;
    selection();
    try {
      await backend.deletePremeetings([...selected]);
      if (active && version === epoch) await load(currentAccount);
    } catch {
      if (active && version === epoch)
        notice("No se ha podido confirmar la eliminación. Actualiza el listado.");
    } finally {
      busy = false;
      selection();
    }
  });
  get("premeeting-previous").addEventListener("click", () => {
    if (page > 0) {
      page--;
      load(currentAccount);
    }
  });
  get("premeeting-following").addEventListener("click", () => {
    page++;
    load(currentAccount);
  });
  get("premeeting-detail-close").addEventListener("click", () => dialog.close());
  let outside = false;
  function isOutside(event) {
    const r = dialog.getBoundingClientRect();
    return (
      event.clientX < r.left ||
      event.clientX > r.right ||
      event.clientY < r.top ||
      event.clientY > r.bottom
    );
  }
  dialog.addEventListener(
    "pointerdown",
    (event) => (outside = event.target === dialog && isOutside(event)),
  );
  dialog.addEventListener("click", (event) => {
    if (outside && event.target === dialog && isOutside(event)) dialog.close();
    outside = false;
  });
  dialog.addEventListener("close", () => {
    get("premeeting-private-summary").replaceChildren();
    get("premeeting-detail-name").textContent = "";
  });
  window.PremeetingPanel = { load, reset, hide };
})();
