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
    get("resource-bulk").hidden = true;
    version++;
    active = false;
    rows = [];
    selection.clear();
    get("resources-browser").replaceChildren();
    get("resource-form").reset();
    get("resource-admin").hidden = true;
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
    get("resource-admin").hidden = true;
    try {
      const [list, me] = await Promise.all([
        backend.listResources(),
        backend.getMyTeamProfile(),
      ]);
      if (!active || version !== ticket) return;
      rows = list.map((row) => ({
        ...row,
        company: window.PortfolioCompanies.label(row.company),
      }));
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
  let companyScroll = 0,
    companyOpener = null;
  function navigateCompany(next) {
    const ticket = version;
    if (next) {
      companyScroll = window.scrollY;
      companyOpener = next;
    }
    const change = () => {
      if (!active || ticket !== version) return;
      company = next;
      product = null;
      render();
      if (next)
        get("resource-company-heading").scrollIntoView({
          block: "start",
          behavior: "instant",
        });
      else {
        window.scrollTo({ top: companyScroll, behavior: "instant" });
        [...document.querySelectorAll(".resource-company")]
          .find((n) => n.querySelector("strong")?.textContent === companyOpener)
          ?.focus({ preventScroll: true });
      }
    };
    if (
      document.startViewTransition &&
      !matchMedia("(prefers-reduced-motion: reduce)").matches
    )
      document.startViewTransition(change);
    else change();
  }
  function render() {
    document.querySelector(".resource-personal").hidden = !!company;
    const host = get("resources-browser");
    host.replaceChildren();
    selection.clear();
    get("resource-admin").hidden = account?.role !== "admin" || !company;
    if (!company) get("resource-admin").open = false;
    const companyInput = get("resource-form").elements.namedItem("company");
    companyInput.value = company || "";
    companyInput.readOnly = true;
    get("resource-delete-selected").disabled = true;
    get("resource-select-all").checked = false;
    const heading = get("resource-company-heading");
    heading.replaceChildren();
    heading.hidden = !company;
    document.querySelector("#resources-view .panel-section-heading").hidden = !!company;
    if (company) {
      heading.append(
        button("← Todas las compañías", () => navigateCompany(null), "panel-secondary"),
      );
      const identity = node("div", undefined, "resource-company-identity"),
        brand = window.PortfolioCompanies.find(company);
      if (brand) {
        const img = node("img");
        img.src = new URL(
          "assets/companies/" + (brand.resourceLogo || brand.logo),
          applicationRoot,
        ).href;
        img.alt = "";
        img.style.viewTransitionName = "company-logo-" + brand.id;
        identity.dataset.company = brand.id;
        identity.append(img);
      }
      identity.append(
        node("h2", company),
        node("p", "Documentos y enlaces de la compañía."),
      );
      heading.append(identity);
    }
    const list = rows.filter((r) => !company || r.company === company);
    get("resource-bulk").hidden = true;
    if (!company) {
      const grid = node("div", undefined, "resource-grid"),
        key = company ? "product" : "company";
      [
        ...new Set([
          ...(company ? [] : window.PortfolioCompanies.list.map((c) => c.name)),
          ...list.map((r) => r[key]),
        ]),
      ]
        .sort((a, b) => a.localeCompare(b, "es"))
        .forEach((name) => {
          const count = list.filter((r) => r[key] === name).length;
          const card = button(
            "",
            () => {
              navigateCompany(name);
            },
            company ? "resource-folder" : "resource-company",
          );
          const brand = !company && window.PortfolioCompanies.find(name);
          if (brand) {
            const img = node("img");
            img.src = new URL(
              "assets/companies/" + (brand.resourceLogo || brand.logo),
              applicationRoot,
            ).href;
            img.alt = "";
            img.style.viewTransitionName = "company-logo-" + brand.id;
            img.width = brand.id === "axa" ? 160 : 280;
            img.height = 80;
            card.append(img);
            card.dataset.company = brand.id;
          }
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
    if (!list.length)
      host.append(
        node("p", "Todavía no hay documentos en esta compañía.", "workspace-empty"),
      );
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
          const format = {
            file: ["PDF", "▤"],
            html: ["HTML", "〈/〉"],
            web: ["WEB", "↗"],
            link: ["ENLACE", "↗"],
          }[row.kind] || ["ENLACE", "↗"];
          card.dataset.format = row.kind;
          const icon = node("span", format[1], "resource-document-icon");
          icon.setAttribute("aria-hidden", "true");
          card.append(icon);
          const text = node("div", undefined, "resource-document-content");
          const meta = node("div", undefined, "resource-document-meta");
          meta.append(
            node("span", row.product, "resource-product"),
            node("small", format[0], "resource-format"),
          );
          text.append(meta, node("h4", row.title));
          const date = node(
            "time",
            "Subido el " + new Date(row.created_at).toLocaleDateString("es-ES"),
            "resource-document-date",
          );
          date.dateTime = row.created_at;
          text.append(date);
          card.append(text);
          const open = button(
            row.kind === "file"
              ? "Ver PDF ↗"
              : row.kind === "html" || row.kind === "web"
                ? "Ver presentación ↗"
                : "Abrir enlace ↗",
            () => openResource(row, open),
          );
          card.append(open);
          card.addEventListener("click", (event) => {
            if (!event.target.closest("button,input,label,a") && !open.disabled)
              openResource(row, open);
          });
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
    get("resource-bulk").hidden = account?.role !== "admin" || !selection.size;
    get("resource-delete-selected").disabled = !selection.size || busy;
    get("resource-delete-selected").textContent = selection.size
      ? `Eliminar seleccionados (${selection.size})`
      : "Eliminar seleccionados";
  }
  async function openResource(row, button) {
    if (["link", "web"].includes(row.kind)) {
      try {
        const url = new URL(row.url);
        if (url.protocol !== "https:") return;
        window.open(url.href, "_blank", "noopener,noreferrer");
      } catch {}
      return;
    }
    const tab = window.open("about:blank", "_blank");
    if (!tab) {
      say("Permite abrir una pestaña para ver el documento.");
      return;
    }
    tab.opener = null;
    const ticket = version;
    button.disabled = true;
    try {
      const blob = await backend.resourceFile(row.storage_path);
      if (!active || ticket !== version) {
        tab.close();
        return;
      }
      if (row.kind === "html") {
        const doc = tab.document;
        doc.title = row.title;
        const style = doc.createElement("style");
        style.textContent =
          "html,body{margin:0;width:100%;height:100%;background:#101e2d}iframe{display:block;width:100%;height:100%;border:0}";
        doc.head.append(style);
        const frame = doc.createElement("iframe");
        frame.title = row.title;
        frame.setAttribute("sandbox", "allow-scripts allow-presentation");
        frame.referrerPolicy = "no-referrer";
        frame.srcdoc = await blob.text();
        if (!active || ticket !== version) {
          tab.close();
          return;
        }
        doc.body.replaceChildren(frame);
      } else {
        const url = URL.createObjectURL(blob);
        blobs.add(url);
        tab.location.replace(url);
      }
    } catch {
      tab.close();
      if (active && ticket === version)
        say("No se ha podido abrir el documento. Comprueba tu sesión.");
    } finally {
      button.disabled = false;
    }
  }
  function syncKind() {
    const html = get("resource-kind").value === "html";
    const file = ["file", "html"].includes(get("resource-kind").value);
    get("resource-file-description").textContent = html
      ? "HTML · máximo 10 MB"
      : "PDF · máximo 10 MB";
    get("resource-file").accept = html ? "text/html,.html,.htm" : "application/pdf,.pdf";
    get("resource-file-label").hidden = !file;
    get("resource-url-label").hidden = file;
    get("resource-file").required = file;
    get("resource-url").required = !file;
  }
  get("resource-kind").addEventListener("change", () => {
    get("resource-file").value = "";
    syncKind();
  });
  get("resource-form").addEventListener("submit", async (event) => {
    event.preventDefault();
    if (busy || account?.role !== "admin" || !active || !company) return;
    const fields = Object.fromEntries(new FormData(event.currentTarget));
    fields.company = company;
    fields.product = fields.product.trim();
    fields.title = fields.title.trim();
    fields.url = fields.url.trim();
    if (["link", "web"].includes(fields.kind)) {
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
          "No se ha podido guardar. Comprueba los datos y utiliza un PDF o HTML válido de hasta 10 MB.",
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
      !(await window.SiteConfirm.ask(
        `¿Eliminar definitivamente ${selection.size} recursos seleccionados?`,
      ))
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
    if (await window.PortfolioClipboard.copy(text, get("resource-copy-link"))) {
      say("Tu enlace personal se ha copiado.");
    } else {
      get("resource-personal-link").select();
      say("Selecciona y copia tu enlace desde el campo.");
    }
  });
  window.ResourcesPanel = { load, hide, reset };
})();
