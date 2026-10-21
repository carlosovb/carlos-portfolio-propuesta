// Biblioteca compartida. Los documentos se descargan con sesión y nunca son públicos.
(() => {
  const get = (id) => document.getElementById(id),
    backend = window.PortfolioBackend;
  const applicationRoot = new URL("../", document.currentScript.src);
  let version = 0,
    active = false,
    rows = [],
    company = null,
    product = null,
    account = null,
    busy = false,
    selection = new Set();
  const blobs = new Set();
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
  const say = (text) => {
    get("resources-notice").textContent = text;
    get("resources-notice").hidden = !text;
  };
  function hide() {
    version++;
    active = false;
    rows = [];
    selection.clear();
    get("resources-browser").replaceChildren();
    get("resource-form").reset();
    syncKind();
    get("resource-delete-selected").disabled = true;
    say("");
  }
  function reset() {
    hide();
    blobs.forEach((url) => URL.revokeObjectURL(url));
    blobs.clear();
    company = null;
    product = null;
    account = null;
    get("resource-consultant-name").textContent = "";
    get("resource-personal-link").value = "";
    get("resource-open-link").removeAttribute("href");
    get("resource-open-link").hidden = true;
  }
  async function load(details) {
    hide();
    active = true;
    account = details;
    const ticket = version;
    say("Cargando tus recursos…");
    get("resource-admin").hidden = details?.role !== "admin";
    try {
      const [list, me] = await Promise.all([
        backend.listResources(),
        backend.getMyTeamProfile(),
      ]);
      if (!active || version !== ticket) return;
      rows = list;
      const link = new URL("previo/", applicationRoot);
      link.searchParams.set("consultor", me.user_id);
      get("resource-personal-link").value = link.href;
      get("resource-open-link").href = link.href;
      get("resource-open-link").hidden = false;
      get("resource-consultant-name").textContent = [
        details.profile?.first_name,
        details.profile?.last_name,
      ]
        .filter(Boolean)
        .join(" ");
      render();
      say("");
    } catch {
      if (active && version === ticket)
        say(
          "No se han podido cargar los recursos. Pulsa Actualizar para volver a intentarlo.",
        );
    }
  }
  function render() {
    const host = get("resources-browser");
    host.replaceChildren();
    selection.clear();
    get("resource-delete-selected").disabled = true;
    get("resource-select-all").checked = false;
    const nav = node("div", undefined, "resource-breadcrumb");
    nav.append(
      button(
        "Todas las compañías",
        () => {
          company = null;
          product = null;
          render();
        },
        "panel-text-button",
      ),
    );
    if (company)
      nav.append(
        node("span", "/"),
        button(
          company,
          () => {
            product = null;
            render();
          },
          "panel-text-button",
        ),
      );
    if (product) nav.append(node("span", "/"), node("strong", product));
    host.append(nav);
    const list = rows.filter(
      (r) => (!company || r.company === company) && (!product || r.product === product),
    );
    get("resource-bulk").hidden =
      account?.role !== "admin" || !company || !product || !list.length;
    if (!company || !product) {
      const grid = node("div", undefined, "resource-grid"),
        key = company ? "product" : "company";
      [...new Set(list.map((r) => r[key]))]
        .sort((a, b) => a.localeCompare(b, "es"))
        .forEach((name) => {
          const count = list.filter((r) => r[key] === name).length;
          const card = button(
            "",
            () => {
              company ? (product = name) : (company = name);
              render();
            },
            "resource-folder",
          );
          card.append(
            node("span", company ? "PRODUCTO" : "COMPAÑÍA", "resource-eyebrow"),
            node("strong", name),
            node("small", `${count} ${count === 1 ? "recurso" : "recursos"} · Abrir ↗`),
          );
          grid.append(card);
        });
      host.append(grid);
      if (!list.length)
        host.append(
          node(
            "p",
            "La biblioteca está preparada. Los documentos y enlaces aparecerán aquí cuando el administrador los añada.",
            "workspace-empty",
          ),
        );
      return;
    }
    [false, true].forEach((archived) => {
      const group = list.filter((r) => r.archived === archived);
      if (!group.length) return;
      host.append(
        node(
          "h3",
          archived ? "Archivo · versiones anteriores" : "Documentación disponible",
        ),
      );
      group
        .sort((a, b) => b.created_at.localeCompare(a.created_at))
        .forEach((row) => {
          const card = node("article", undefined, "resource-document");
          card.dataset.archived = String(archived);
          if (account.role === "admin") {
            const check = node("input");
            check.type = "checkbox";
            check.dataset.resourceId = row.id;
            check.setAttribute("aria-label", "Seleccionar " + row.title);
            check.addEventListener("change", () => {
              check.checked ? selection.add(row.id) : selection.delete(row.id);
              updateSelection();
            });
            card.append(check);
          }
          const text = node("div");
          text.append(
            node("small", row.kind === "file" ? "PDF" : "ENLACE EXTERNO"),
            node("strong", row.title),
            node(
              "span",
              "Subido el " + new Date(row.created_at).toLocaleDateString("es-ES"),
            ),
          );
          card.append(text);
          const open = button("Abrir ↗", () => openResource(row, open));
          card.append(open);
          if (account.role === "admin")
            card.append(
              button(
                archived ? "Restaurar" : "Archivar",
                async () => {
                  const ticket = version;
                  try {
                    await backend.archiveResource(row.id, !archived);
                    if (active && ticket === version) await load(account);
                  } catch {
                    if (active && ticket === version)
                      say("No se ha podido cambiar el archivo.");
                  }
                },
                "panel-text-button",
              ),
            );
          host.append(card);
        });
    });
  }
  function updateSelection() {
    get("resource-delete-selected").disabled = !selection.size || busy;
    get("resource-delete-selected").textContent = selection.size
      ? `Eliminar seleccionados (${selection.size})`
      : "Eliminar seleccionados";
  }
  async function openResource(row, button) {
    if (row.kind === "link") {
      try {
        const url = new URL(row.url);
        if (url.protocol !== "https:") return;
        window.open(url.href, "_blank", "noopener,noreferrer");
      } catch {}
      return;
    }
    const tab = window.open("about:blank", "_blank");
    if (!tab) {
      say("Permite abrir una pestaña para ver el PDF.");
      return;
    }
    tab.opener = null;
    const ticket = version;
    button.disabled = true;
    try {
      const blob = await backend.resourcePdf(row.storage_path);
      if (!active || ticket !== version) {
        tab.close();
        return;
      }
      const url = URL.createObjectURL(blob);
      blobs.add(url);
      tab.location.replace(url);
    } catch {
      tab.close();
      if (active && ticket === version)
        say("No se ha podido abrir el PDF. Comprueba tu sesión.");
    } finally {
      button.disabled = false;
    }
  }
  function syncKind() {
    const file = get("resource-kind").value === "file";
    get("resource-file-label").hidden = !file;
    get("resource-url-label").hidden = file;
    get("resource-file").required = file;
    get("resource-url").required = !file;
  }
  get("resource-kind").addEventListener("change", syncKind);
  get("resource-form").addEventListener("submit", async (event) => {
    event.preventDefault();
    if (busy || account?.role !== "admin" || !active) return;
    const fields = Object.fromEntries(new FormData(event.currentTarget));
    fields.company = fields.company.trim();
    fields.product = fields.product.trim();
    fields.title = fields.title.trim();
    fields.url = fields.url.trim();
    if (fields.kind === "link") {
      try {
        const u = new URL(fields.url);
        if (u.protocol !== "https:" || u.username || u.password) throw Error();
        fields.url = u.href;
      } catch {
        say("Utiliza un enlace https:// válido.");
        return;
      }
    }
    const file = get("resource-file").files[0],
      ticket = version;
    busy = true;
    get("resource-save").disabled = true;
    say("Guardando recurso…");
    try {
      await backend.addResource(fields, file);
      if (active && ticket === version) {
        get("resource-form").reset();
        get("resource-admin").open = false;
        company = fields.company;
        product = fields.product;
        await load(account);
      }
    } catch {
      if (active && ticket === version)
        say(
          "No se ha podido guardar. Comprueba los datos y utiliza un PDF válido de hasta 10 MB.",
        );
    } finally {
      busy = false;
      get("resource-save").disabled = false;
    }
  });
  get("resource-select-all").addEventListener("change", (event) => {
    document.querySelectorAll("[data-resource-id]").forEach((c) => {
      c.checked = event.target.checked;
      c.checked
        ? selection.add(c.dataset.resourceId)
        : selection.delete(c.dataset.resourceId);
    });
    updateSelection();
  });
  get("resource-delete-selected").addEventListener("click", async () => {
    if (
      busy ||
      account?.role !== "admin" ||
      !selection.size ||
      !confirm(`¿Eliminar definitivamente ${selection.size} recursos seleccionados?`)
    )
      return;
    const ticket = version,
      chosen = rows.filter((r) => selection.has(r.id));
    busy = true;
    updateSelection();
    let failed = 0;
    for (const row of chosen) {
      if (!active || version !== ticket) break;
      try {
        if (!(await backend.deleteResource(row))) failed++;
      } catch {
        failed++;
      }
    }
    busy = false;
    if (active && version === ticket) {
      await load(account);
      if (failed)
        say(
          "No se ha confirmado la eliminación de todos los recursos. Revisa el listado antes de reintentar.",
        );
    }
  });
  get("resource-copy-link").addEventListener("click", async () => {
    const text = get("resource-personal-link").value;
    if (!text) return;
    try {
      await navigator.clipboard.writeText(text);
      say("Tu enlace personal se ha copiado.");
    } catch {
      get("resource-personal-link").select();
      say("Selecciona y copia tu enlace desde el campo.");
    }
  });
  window.ResourcesPanel = { load, hide, reset };
})();
