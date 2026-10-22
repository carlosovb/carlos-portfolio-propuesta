/* Cartera privada: los clientes reales permanecen en Supabase y en memoria durante la sesión. */
(() => {
  const backend = window.PortfolioBackend,
    parser = window.ClientImport;
  const get = (id) => document.getElementById(id);
  const el = (tag, className, text) => {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text != null) node.textContent = text;
    return node;
  };
  let account = null,
    visible = false,
    revision = 0,
    page = 0,
    demo = false,
    busy = false,
    rows = [],
    pending = null,
    searchTimer;
  let operation = 0;
  let dialogScroll = null;
  const compactClient = matchMedia("(max-width: 850px)");
  compactClient.addEventListener("change", (event) => {
    const additional = get("client-detail-fields").querySelector(".client-additional");
    if (additional) additional.open = !event.matches;
  });
  const category = (row) =>
    row.category ||
    (parser.normalize(row.client_type) === "cliente"
      ? "client"
      : parser.normalize(row.client_type) === "interesado"
        ? "interested"
        : "other");
  const priority = (row) => ({ client: 0, interested: 1, other: 2 })[category(row)];
  const selection = new Set();
  const name = (row) => [row.first_name, row.last_name].filter(Boolean).join(" ");
  const formatDate = (value) =>
    value
      ? new Intl.DateTimeFormat("es-ES", { dateStyle: "medium", timeZone: "UTC" }).format(
          new Date(value + "T12:00:00Z"),
        )
      : "Sin indicar";
  const notice = (message) => {
    get("clients-notice").textContent = message;
    get("clients-notice").hidden = !message;
  };
  const examples = () => [
    {
      id: "demo-1",
      client_type: "Cliente",
      status: "Activo",
      first_name: "Lucía",
      last_name: "Martín · Ejemplo",
      email: "lucia@example.invalid",
      phone: "000 000 001",
      birth_date: "1992-05-12",
      street_type: "Calle",
      street: "Ejemplo",
      street_number: "12",
      postal_code: "35001",
      locality: "Las Palmas de Gran Canaria",
    },
    {
      id: "demo-2",
      client_type: "Cliente",
      status: "Activo",
      first_name: "Daniel",
      last_name: "Pérez · Ejemplo",
      email: "daniel@example.invalid",
      phone: "000 000 002",
      birth_date: "1988-11-03",
      street_type: "Avenida",
      street: "Demostración",
      street_number: "8",
      postal_code: "15001",
      locality: "A Coruña",
    },
    {
      id: "demo-3",
      client_type: "Interesado",
      status: "Activo",
      first_name: "Sofía",
      last_name: "León · Ejemplo",
      email: "sofia@example.invalid",
      phone: "000 000 003",
      birth_date: "1995-02-24",
      street_type: "Calle",
      street: "Referencia",
      street_number: "4",
      postal_code: "35002",
      locality: "Las Palmas de Gran Canaria",
    },
  ];
  let demoRows = examples();
  function clearPreview() {
    pending = null;
    get("clients-preview").hidden = true;
    get("clients-preview-sample").replaceChildren();
    get("clients-import-issues").replaceChildren();
  }
  function syncDemo() {
    get("clients-demo-banner").hidden = !demo;
    get("clients-demo-toggle").textContent = demo
      ? "Volver a mis clientes ↗"
      : "Ver ejemplo ↗";
  }
  function syncSelection() {
    get("clients-bulk").hidden = !selection.size;
    get("clients-selected-count").textContent = selection.size + " seleccionados";
    get("clients-delete-selected").disabled = busy || !selection.size;
    get("clients-select-all").checked = rows.length > 0 && selection.size === rows.length;
    get("clients-select-all").indeterminate =
      selection.size > 0 && selection.size < rows.length;
  }
  function detail(row, opener = document.activeElement) {
    if (!visible || !account) return;
    dialogScroll = {
      x: window.scrollX,
      y: window.scrollY,
      opener,
    };
    get("client-detail-name").textContent = name(row);
    get("client-detail-demo").hidden = !demo;
    const fields = get("client-detail-fields");
    fields.replaceChildren();
    get("client-detail-category").textContent =
      category(row) === "client"
        ? "Cliente"
        : category(row) === "interested"
          ? "Interesado"
          : row.client_type || "Ficha personal";
    get("client-detail-status").textContent = row.status || "Estado sin indicar";
    const groups = [
      [
        "Contacto",
        [
          ["Teléfono", row.phone],
          ["Correo electrónico", row.email],
        ],
      ],
      ["Datos personales", [["Fecha de nacimiento", formatDate(row.birth_date)]]],
      [
        "Dirección",
        [
          [
            "Domicilio",
            [row.street_type, row.street, row.street_number].filter(Boolean).join(" "),
          ],
          ["Localidad", row.locality],
          ["Código postal", row.postal_code],
        ],
      ],
    ];
    const additional = el("details", "client-additional");
    additional.open = !compactClient.matches;
    additional.append(el("summary", "", "Datos personales y dirección"));
    groups.forEach(([title, values], index) => {
      const section = el("section", "client-info-section");
      section.append(el("h3", "", title));
      const dl = el("dl");
      values.forEach(([label, value]) => {
        const line = el("div", "client-field");
        line.append(el("dt", "", label), el("dd", "", value || "Sin indicar"));
        dl.append(line);
      });
      section.append(dl);
      (index === 0 ? fields : additional).append(section);
    });
    fields.append(additional);
    get("client-detail-dialog").showModal();
    get("client-detail-dialog").scrollTop = 0;
    window.ClientProducts.open(row, demo);
    get("client-detail-close").focus({ preventScroll: true });
    window.scrollTo({ left: dialogScroll.x, top: dialogScroll.y, behavior: "instant" });
  }
  function companyMarks(row) {
    const marks = el("span", "client-company-marks");
    const companies = [
      ...new Set(
        (row.companies || []).map((value) => window.PortfolioCompanies.label(value)),
      ),
    ];
    marks.hidden = !companies.length;
    companies.forEach((value) => {
      const company = window.PortfolioCompanies.find(value);
      const label = el(
        "span",
        "client-company-mark",
        company?.id === "intesa" ? "Intesa" : value,
      );
      label.dataset.company = company?.id || "other";
      label.title = value;
      marks.append(label);
    });
    marks.setAttribute("aria-label", "Compañías contratadas");
    return marks;
  }
  window.addEventListener("client-products-changed", (event) => {
    if (!visible || demo !== event.detail.demo) return;
    const row = rows.find((r) => r.id === event.detail.clientId);
    if (!row) return;
    row.companies = event.detail.companies;
    const tr = Array.from(get("clients-list").children).find(
      (el) => el.dataset.clientId === row.id,
    );
    tr?.querySelector(".client-company-marks")?.replaceWith(companyMarks(row));
  });
  function render(result) {
    rows = result.rows;
    selection.clear();
    syncDemo();
    get("clients-list").replaceChildren();
    for (const row of rows) {
      const tr = el("tr");
      tr.dataset.category = category(row);
      tr.dataset.clientId = row.id;
      const selectCell = el("td", "client-select-cell");
      const checkbox = el("input", "bulk-checkbox");
      checkbox.type = "checkbox";
      checkbox.setAttribute("aria-label", "Seleccionar " + name(row));
      checkbox.addEventListener("change", () => {
        checkbox.checked ? selection.add(row.id) : selection.delete(row.id);
        syncSelection();
      });
      selectCell.append(checkbox);
      const identity = el("td", "client-identity");
      const monogram = el(
        "span",
        "client-monogram",
        name(row)
          .split(" ")
          .filter(Boolean)
          .slice(0, 2)
          .map((s) => s[0])
          .join(""),
      );
      monogram.setAttribute("aria-hidden", "true");
      const title = el("span");
      title.append(
        el("strong", "", name(row)),
        el(
          "small",
          "client-category",
          category(row) === "client"
            ? "Cliente"
            : category(row) === "interested"
              ? "Interesado"
              : row.client_type || "Sin clasificar",
        ),
      );
      title.append(companyMarks(row));
      identity.append(monogram, title);
      const contact = el("td", "client-contact");
      contact.dataset.label = "Contacto";
      contact.append(
        el("span", "", row.phone || "Sin teléfono"),
        el("small", "", row.email || "Sin correo"),
      );
      const locality = el("td", "client-locality");
      locality.dataset.label = "Localidad";
      locality.append(
        el("span", "", row.locality || "Sin indicar"),
        el("small", "", row.postal_code || ""),
      );
      const status = el("td", "client-state");
      status.dataset.label = "Estado";
      status.append(el("span", "client-status", row.status || "Sin indicar"));
      const action = el("td", "client-action");
      const open = el("button", "panel-text-button", "Ver ficha ↗");
      open.type = "button";
      open.setAttribute("aria-label", "Ver ficha de " + name(row));
      open.addEventListener("click", () => detail(row, open));
      tr.addEventListener("click", (event) => {
        if (
          event.target.closest("button,input,label,a,select,textarea") ||
          window.getSelection()?.toString()
        )
          return;
        detail(row, open);
      });
      action.append(open);
      tr.append(selectCell, identity, contact, locality, status, action);
      get("clients-list").append(tr);
    }
    const stats = result.stats;
    get("clients-count").textContent = stats.clients;
    get("clients-localities-count").textContent = stats.localities;
    get("clients-interested-count").textContent = stats.interested;
    get("clients-total").textContent =
      result.total +
      " " +
      (result.total === 1 ? "registro" : "registros") +
      (get("clients-search").value ? " en esta búsqueda" : "");
    get("clients-table-wrap").hidden = !rows.length;
    get("clients-empty").hidden = !!rows.length;
    get("clients-bulk").hidden = true;
    get("clients-pagination").hidden = !rows.length;
    get("clients-empty").textContent = get("clients-search").value
      ? "No hay clientes que coincidan con tu búsqueda."
      : "Todavía no tienes clientes importados. Sube tu informe o abre el ejemplo para ver cómo quedará.";
    get("clients-previous").disabled = page === 0;
    get("clients-next").disabled = (page + 1) * 25 >= result.total;
    get("clients-page-label").textContent = "Página " + (page + 1);
    syncSelection();
  }
  async function load(details) {
    if (details) account = details;
    if (!account) return;
    visible = true;
    const snapshot = ++revision;
    try {
      let result;
      if (demo) {
        const query = parser.normalize(get("clients-search").value);
        const matches = demoRows
          .filter((row) => parser.normalize(Object.values(row).join(" ")).includes(query))
          .sort(
            (a, b) =>
              priority(a) - priority(b) || a.last_name.localeCompare(b.last_name, "es"),
          );
        result = {
          rows: matches.slice(page * 25, (page + 1) * 25),
          total: matches.length,
          stats: {
            clients: demoRows.filter((row) => category(row) === "client").length,
            interested: demoRows.filter((row) => category(row) === "interested").length,
            localities: new Set(demoRows.map((row) => row.locality)).size,
          },
        };
      } else result = await backend.listClients(get("clients-search").value, page);
      if (snapshot !== revision || !visible) return;
      if (page > 0 && !result.rows.length) {
        page--;
        return load();
      }
      render(result);
      notice("");
    } catch (error) {
      if (snapshot !== revision || !visible) return;
      rows = [];
      selection.clear();
      get("clients-list").replaceChildren();
      get("clients-table-wrap").hidden = true;
      get("clients-bulk").hidden = true;
      get("clients-pagination").hidden = true;
      get("clients-empty").hidden = true;
      ["clients-count", "clients-localities-count", "clients-interested-count"].forEach(
        (id) => (get(id).textContent = "—"),
      );
      get("clients-total").textContent = "";
      notice(
        error.status === 404
          ? "La cartera todavía no está configurada. Puedes ver el ejemplo mientras se completa."
          : "No se ha podido cargar tu cartera. Pulsa Actualizar para intentarlo de nuevo.",
      );
    }
  }
  function hide() {
    get("clients-bulk").hidden = true;
    window.ClientProducts.reset();
    visible = false;
    dialogScroll = null;
    operation++;
    busy = false;
    get("clients-file").disabled = false;
    get("clients-file").value = "";
    revision++;
    clearTimeout(searchTimer);
    clearPreview();
    get("client-detail-dialog").close();
    get("client-detail-name").textContent = "";
    get("client-detail-fields").replaceChildren();
  }
  function reset() {
    hide();
    account = null;
    busy = false;
    page = 0;
    demo = false;
    demoRows = examples();
    rows = [];
    selection.clear();
    get("clients-list").replaceChildren();
    get("clients-file").value = "";
    get("clients-file").disabled = false;
    get("clients-search").value = "";
    get("clients-total").textContent = "";
    ["clients-count", "clients-localities-count", "clients-interested-count"].forEach(
      (id) => (get(id).textContent = "—"),
    );
    get("clients-bulk").hidden = true;
    get("clients-table-wrap").hidden = true;
    get("clients-pagination").hidden = true;
    get("clients-selected-count").textContent = "0 seleccionados";
    notice("");
    syncDemo();
  }
  get("clients-demo-toggle").addEventListener("click", () => {
    if (!visible || busy) return;
    demo = !demo;
    demoRows = examples();
    page = 0;
    get("clients-search").value = "";
    clearPreview();
    load();
  });
  get("clients-search").addEventListener("input", () => {
    if (!visible) return;
    page = 0;
    clearTimeout(searchTimer);
    searchTimer = setTimeout(() => load(), 250);
  });
  get("clients-previous").addEventListener("click", () => {
    if (!visible || busy || page === 0) return;
    page--;
    load();
  });
  get("clients-next").addEventListener("click", () => {
    if (!visible || busy || get("clients-next").disabled) return;
    page++;
    load();
  });
  get("client-detail-close").addEventListener("click", () =>
    get("client-detail-dialog").close(),
  );
  // Cierra solo si el gesto empieza y termina en el fondo exterior.
  const clientDialog = get("client-detail-dialog");
  let backdropPressed = false;
  const outsideClientDialog = (event) => {
    const rect = clientDialog.getBoundingClientRect();
    return (
      event.clientX < rect.left ||
      event.clientX > rect.right ||
      event.clientY < rect.top ||
      event.clientY > rect.bottom
    );
  };
  clientDialog.addEventListener("pointerdown", (event) => {
    backdropPressed = event.target === clientDialog && outsideClientDialog(event);
  });
  clientDialog.addEventListener("click", (event) => {
    if (backdropPressed && event.target === clientDialog && outsideClientDialog(event))
      clientDialog.close();
    backdropPressed = false;
  });
  get("client-detail-dialog").addEventListener("close", () => {
    window.ClientProducts.reset();
    const saved = dialogScroll;
    dialogScroll = null;
    get("client-detail-fields").replaceChildren();
    get("client-detail-name").textContent = "";
    if (saved && visible) {
      if (saved.opener?.isConnected) saved.opener.focus({ preventScroll: true });
      window.scrollTo({ left: saved.x, top: saved.y, behavior: "instant" });
    }
  });
  get("clients-cancel-import").addEventListener("click", () => {
    if (busy) return;
    clearPreview();
    notice("");
  });
  get("clients-file").addEventListener("change", async (event) => {
    const file = event.target.files?.[0];
    if (!file || !account || !visible || busy) return;
    const initiatingAccount = account;
    if (demo) {
      demo = false;
      page = 0;
      get("clients-search").value = "";
      await load();
    }
    if (!visible || account !== initiatingAccount) return;
    clearPreview();
    const snapshot = revision,
      ticket = ++operation;
    busy = true;
    get("clients-file").disabled = true;
    notice("Leyendo el Excel y comprobando duplicados…");
    try {
      const parsed = await parser.read(file);
      if (snapshot !== revision || !visible) return;
      const result = await backend.importClients(parsed.rows, true);
      if (snapshot !== revision || !visible) return;
      pending = { ...parsed, result };
      get("clients-preview-new").textContent = result.added;
      get("clients-preview-duplicates").textContent = result.duplicates;
      get("clients-preview-invalid").textContent = result.invalid + parsed.issues.length;
      get("clients-preview-help").textContent =
        parsed.received +
        " filas leídas. Se comparan nombre, apellidos y fecha de nacimiento cuando está disponible. No se modifican los clientes existentes.";
      get("clients-confirm-import").disabled = !result.added;
      parsed.issues
        .slice(0, 10)
        .forEach((issue) =>
          get("clients-import-issues").append(
            el("li", "", "Fila " + issue.row + ": " + issue.message),
          ),
        );
      get("clients-preview-sample").append(
        el(
          "p",
          "panel-muted",
          "Primeros registros del archivo (pueden incluir repetidos):",
        ),
      );
      parsed.rows.slice(0, 3).forEach((row) => {
        const sample = el("div");
        sample.append(
          el("strong", "", name(row)),
          el("span", "", row.locality || "Sin localidad"),
        );
        get("clients-preview-sample").append(sample);
      });
      get("clients-preview").hidden = false;
      notice("Vista previa preparada. Confirma para añadir solo los clientes nuevos.");
      get("clients-preview").scrollIntoView({ block: "nearest", behavior: "smooth" });
    } catch (error) {
      if (snapshot === revision && visible)
        notice(
          error.status
            ? "No se ha podido comprobar la importación. No se ha guardado ningún dato."
            : error.message,
        );
    } finally {
      if (ticket === operation) {
        busy = false;
        get("clients-file").disabled = false;
        get("clients-file").value = "";
      }
    }
  });
  get("clients-confirm-import").addEventListener("click", async () => {
    if (!pending || !account || !visible || busy || demo) return;
    const data = pending,
      snapshot = revision,
      ticket = ++operation,
      initiatingAccount = account;
    busy = true;
    get("clients-confirm-import").disabled = true;
    get("clients-file").disabled = true;
    notice("Añadiendo los clientes nuevos…");
    try {
      const result = await backend.importClients(data.rows, false);
      if (snapshot !== revision || !visible) return;
      clearPreview();
      page = 0;
      await load();
      if (!visible || account !== initiatingAccount) return;
      notice(
        result.added +
          " clientes añadidos · " +
          result.duplicates +
          " repetidos omitidos · " +
          (result.invalid + data.issues.length) +
          " por revisar.",
      );
    } catch {
      if (snapshot === revision && visible) {
        notice(
          "No se ha confirmado la importación. Actualiza tu cartera antes de volver a intentarlo; los duplicados se omitirán.",
        );
        get("clients-confirm-import").disabled = false;
      }
    } finally {
      if (ticket === operation) {
        busy = false;
        get("clients-file").disabled = false;
        syncSelection();
      }
    }
  });
  get("clients-select-all").addEventListener("change", (event) => {
    selection.clear();
    if (event.target.checked) rows.forEach((row) => selection.add(row.id));
    get("clients-list")
      .querySelectorAll('input[type="checkbox"]')
      .forEach((input) => (input.checked = event.target.checked));
    syncSelection();
  });
  get("clients-delete-selected").addEventListener("click", async () => {
    if (!selection.size || busy || !visible || !account) return;
    if (
      !confirm(
        "¿Eliminar " +
          selection.size +
          " clientes seleccionados" +
          (demo ? " de este ejemplo" : " de tu cartera") +
          "? También se eliminarán sus productos, unidades y comisiones registradas.",
      )
    )
      return;
    busy = true;
    const snapshot = revision,
      ids = [...selection],
      ticket = ++operation,
      initiatingAccount = account;
    get("clients-file").disabled = true;
    syncSelection();
    try {
      let removed;
      if (demo) {
        demoRows = demoRows.filter((row) => !selection.has(row.id));
        removed = ids.length;
      } else removed = await backend.deleteClients(ids);
      if (snapshot !== revision || !visible) return;
      await load();
      if (!visible || account !== initiatingAccount) return;
      notice(removed + " clientes eliminados" + (demo ? " del ejemplo." : "."));
    } catch {
      if (snapshot === revision && visible)
        notice(
          "No se ha podido completar la eliminación. Actualiza tu cartera para comprobar el resultado.",
        );
    } finally {
      if (ticket === operation) {
        busy = false;
        get("clients-file").disabled = false;
        syncSelection();
      }
    }
  });
  window.ClientsPanel = { load, hide, reset };
})();
