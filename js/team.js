// Directorio profesional interno. Datos y fotos solo en memoria durante la sesión.
(() => {
  const backend = window.PortfolioBackend;
  const get = (id) => document.getElementById(id);
  let account = null,
    members = [],
    me = null,
    selected = null,
    revision = 0;
  let scale = 1,
    width = 0,
    height = 0,
    saving = false,
    anchor = null;
  let CARD_WIDTH = 460;
  let CARD_HEIGHT = 320;
  let LEVEL_GAP = 410;
  let clientCounts = null;
  const photos = new Map();
  const places = new Map();
  const fullName = (person) =>
    [person.first_name, person.last_name].filter(Boolean).join(" ");
  const multiplier = (value) =>
    value
      ? "×" + new Intl.NumberFormat("es-ES", { maximumFractionDigits: 1 }).format(value)
      : "Sin asignar";
  const notice = (id, message) => {
    get(id).textContent = message;
    get(id).hidden = !message;
  };
  function clearPhotos() {
    photos.forEach((url) => URL.revokeObjectURL(url));
    photos.clear();
  }
  function avatar(target, person, portrait = false) {
    target.replaceChildren();
    const initials = fullName(person)
      .split(" ")
      .filter(Boolean)
      .map((word) => word[0])
      .slice(0, 2)
      .join("");
    target.textContent = initials || "CC";
    // Retrato de portada facilitado por Carlos para su presentación en el árbol.
    const presentationPhoto =
      portrait && person.user_id === "ee1355b0-7a6c-4559-87a6-fa72a7d8f73b"
        ? "../assets/carlos.png"
        : null;
    const src = presentationPhoto || photos.get(person.user_id);
    if (src) {
      const img = document.createElement("img");
      img.src = src;
      img.alt = "";
      img.width = 96;
      img.height = 96;
      target.replaceChildren(img);
    }
  }
  async function fetchPhotos(rows, snapshot) {
    await Promise.all(
      rows
        .filter((row) => row.avatar_path)
        .map(async (row) => {
          try {
            const blob = await backend.readTeamPhoto(row.avatar_path);
            if (snapshot !== revision) return;
            photos.set(row.user_id, URL.createObjectURL(blob));
          } catch {
            /* Si la foto no está disponible, se mantienen las iniciales. */
          }
        }),
    );
  }
  function closeMember() {
    get("team-member-dialog").close();
    selected = null;
  }
  function reset() {
    revision++;
    account = null;
    me = null;
    members = [];
    clientCounts = null;
    get("team-clients-total").textContent = "—";
    get("team-clients-mine").textContent = "—";
    selected = null;
    clearPhotos();
    places.clear();
    get("team-member-dialog").close();
    window.PhotoCrop?.cancel();
    get("team-canvas").replaceChildren();
    get("team-assignment-form").reset();
    get("team-photo-input").value = "";
    get("team-photo-options").open = false;
    get("my-team-photo").replaceChildren();
    get("my-profile-name").textContent = "Tu perfil profesional.";
    get("team-member-photo").replaceChildren();
    ["my-team-multiplier", "my-team-manager"].forEach((id) => (get(id).value = ""));
    get("my-team-position").value = "";
    [
      "team-member-name",
      "team-member-position",
      "team-member-multiplier",
      "team-member-manager",
      "team-member-reports",
    ].forEach((id) => (get(id).textContent = ""));
    get("team-assignment-form").elements.manager.replaceChildren();
    get("team-assignment-form").hidden = true;
  }
  function locate() {
    const place = me && places.get(me.user_id);
    if (!place) return;
    const viewport = get("team-viewport");
    viewport.scrollTo({
      left: Math.max(0, (place.x + CARD_WIDTH / 2) * scale - viewport.clientWidth / 2),
      top: Math.max(0, (place.y + CARD_HEIGHT / 2) * scale - viewport.clientHeight / 2),
      behavior: "auto",
    });
  }
  function applyScale() {
    get("team-stage").style.width = width * scale + "px";
    get("team-stage").style.height = height * scale + "px";
    get("team-canvas").style.transform = "scale(" + scale + ")";
    get("team-zoom-label").textContent = Math.round(scale * 100) + " %";
    get("team-zoom-out").disabled = scale <= 0.6;
    get("team-zoom-in").disabled = scale >= 1.4;
  }
  function draw() {
    const canvas = get("team-canvas");
    canvas.replaceChildren();
    CARD_WIDTH = Math.min(460, Math.max(260, get("team-viewport").clientWidth - 40));
    CARD_HEIGHT = CARD_WIDTH < 360 ? 270 : 320;
    LEVEL_GAP = CARD_HEIGHT + 90;
    canvas.style.setProperty("--team-card-width", CARD_WIDTH + "px");
    canvas.style.setProperty("--team-card-height", CARD_HEIGHT + "px");
    places.clear();
    const byId = new Map(members.map((member) => [member.user_id, member]));
    const children = (id) => members.filter((member) => member.manager_id === id);
    const roots = members.filter(
      (member) => member.is_root || !byId.has(member.manager_id),
    );
    const viewport = get("team-viewport");
    const paddingX = Math.max(40, viewport.clientWidth / 2 - CARD_WIDTH / 2);
    const paddingY = Math.max(48, viewport.clientHeight / 2 - CARD_HEIGHT / 2);
    let cursor = paddingX,
      maxDepth = 0;
    const visited = new Set();
    function layout(member, depth) {
      if (visited.has(member.user_id)) return cursor;
      visited.add(member.user_id);
      maxDepth = Math.max(maxDepth, depth);
      const reports = children(member.user_id).filter(
        (child) => !visited.has(child.user_id),
      );
      let x;
      if (!reports.length) {
        x = cursor;
        cursor += CARD_WIDTH + 48;
      } else {
        const positions = reports.map((child) => layout(child, depth + 1));
        x = (positions[0] + positions[positions.length - 1]) / 2;
      }
      places.set(member.user_id, { x, y: paddingY + depth * LEVEL_GAP });
      return x;
    }
    roots.forEach((root) => {
      layout(root, 0);
      cursor += 40;
    });
    members
      .filter((member) => !visited.has(member.user_id))
      .forEach((member) => layout(member, 0));
    width = Math.max(600, cursor + paddingX);
    height = Math.max(
      500,
      paddingY + (maxDepth + 1) * LEVEL_GAP + viewport.clientHeight / 2,
    );
    canvas.style.width = width + "px";
    canvas.style.height = height + "px";
    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    svg.setAttribute("width", width);
    svg.setAttribute("height", height);
    svg.classList.add("team-connections");
    svg.setAttribute("aria-hidden", "true");
    members.forEach((member) => {
      const child = places.get(member.user_id),
        parent = places.get(member.manager_id);
      if (!child || !parent) return;
      const path = document.createElementNS(svg.namespaceURI, "path");
      const y = parent.y + CARD_HEIGHT;
      path.setAttribute(
        "d",
        "M " +
          (parent.x + CARD_WIDTH / 2) +
          " " +
          y +
          " V " +
          (y + 32) +
          " H " +
          (child.x + CARD_WIDTH / 2) +
          " V " +
          child.y,
      );
      svg.append(path);
    });
    canvas.append(svg);
    members.forEach((member) => {
      const place = places.get(member.user_id);
      const card = document.createElement("button");
      card.type = "button";
      card.className = "team-node";
      card.dataset.userId = member.user_id;
      card.dataset.position = member.position_code || "unassigned";
      card.style.left = place.x + "px";
      card.style.top = place.y + "px";
      const self = member.user_id === me?.user_id;
      card.classList.toggle("team-node-self", self);
      card.setAttribute(
        "aria-label",
        fullName(member) +
          ", " +
          (member.position || "Puesto pendiente") +
          (self ? ", tu puesto" : "") +
          ". Abrir ficha",
      );
      const face = document.createElement("span");
      face.className = "team-avatar team-node-portrait";
      avatar(face, member, true);
      const name = document.createElement("strong");
      name.textContent = fullName(member);
      const position = document.createElement("span");
      position.className = "team-node-position";
      position.textContent = member.position || "Puesto pendiente";
      const factor = document.createElement("span");
      factor.className = "team-node-factor";
      factor.textContent = multiplier(member.multiplier);
      const info = document.createElement("span");
      info.className = "team-node-info";
      const hint = document.createElement("span");
      hint.className = "team-node-hint";
      hint.textContent = "Ver perfil ↗";
      info.append(name, position, factor, hint);
      const count = clientCounts?.by_consultant.find(
        (row) => row.user_id === member.user_id,
      );
      if (count) {
        const clients = document.createElement("span");
        clients.className = "team-node-client-count";
        clients.textContent =
          count.clients + (count.clients === 1 ? " cliente" : " clientes");
        info.append(clients);
      }
      card.append(face, info);
      if (self) {
        const tag = document.createElement("span");
        tag.className = "team-self-label";
        tag.textContent = "Tú";
        card.append(tag);
      }
      card.addEventListener("click", () => openMember(member, card));
      canvas.append(card);
    });
    applyScale();
    get("team-locate").disabled = !places.has(me?.user_id);
    if (places.has(me?.user_id)) requestAnimationFrame(locate);
  }
  function openMember(member, source) {
    selected = member;
    anchor = source.getBoundingClientRect();
    get("team-member-name").textContent = fullName(member);
    get("team-member-position").textContent =
      member.position || "Puesto pendiente de asignar";
    get("team-member-multiplier").textContent = multiplier(member.multiplier);
    const manager = members.find((person) => person.user_id === member.manager_id);
    get("team-member-manager").textContent = member.is_root
      ? "Responsable principal · Raíz del equipo"
      : manager
        ? fullName(manager)
        : "Responsable principal";
    get("team-member-reports").textContent = childrenCount(member.user_id) + " personas";
    avatar(get("team-member-photo"), member, true);
    const form = get("team-assignment-form");
    form.hidden = account?.role !== "admin";
    form.elements.position.value = member.position_code || "";
    form.elements.manager.replaceChildren(
      new Option("Responsable principal (por defecto)", ""),
    );
    members
      .filter((person) => person.user_id !== member.user_id)
      .forEach((person) =>
        form.elements.manager.add(new Option(fullName(person), person.user_id)),
      );
    form.elements.manager.value = member.manager_id || "";
    form.elements.manager.disabled = !!member.is_root;
    if (member.is_root) {
      form.elements.manager.replaceChildren(
        new Option("Este perfil · Responsable principal", ""),
      );
    }
    notice("team-member-notice", "");
    const dialog = get("team-member-dialog");
    dialog.showModal();
    if (!matchMedia("(prefers-reduced-motion: reduce)").matches) {
      const rect = dialog.getBoundingClientRect();
      dialog.animate(
        [
          {
            transform:
              "translate(" +
              (anchor.x + anchor.width / 2 - rect.x - rect.width / 2) +
              "px," +
              (anchor.y + anchor.height / 2 - rect.y - rect.height / 2) +
              "px) scale(.55)",
            opacity: 0.3,
          },
          { transform: "none", opacity: 1 },
        ],
        { duration: 320, easing: "cubic-bezier(.2,.8,.2,1)" },
      );
    }
  }
  function childrenCount(id) {
    return members.filter((person) => person.manager_id === id).length;
  }
  async function load(details) {
    const snapshot = ++revision;
    account = details;
    clearPhotos();
    notice("team-notice", "Preparando el árbol del equipo…");
    get("team-canvas").replaceChildren();
    try {
      clientCounts = null;
      get("team-clients-total").textContent = "—";
      get("team-clients-mine").textContent = "—";
      const [directory, mine, counts] = await Promise.all([
        backend.listTeam(),
        backend.getMyTeamProfile(),
        backend.teamClientCounts().catch(() => null),
      ]);
      if (snapshot !== revision) return;
      clientCounts = counts;
      get("team-clients-total").textContent = counts?.total ?? "—";
      get("team-clients-mine").textContent =
        counts?.by_consultant.find((row) => row.user_id === mine?.user_id)?.clients ??
        "—";
      members = directory;
      me = mine;
      await fetchPhotos(members, snapshot);
      if (snapshot !== revision) return;
      scale = 1;
      draw();
      if (places.has(me?.user_id))
        requestAnimationFrame(() => {
          if (snapshot !== revision) return;
          get("team-viewport").scrollIntoView({
            block: "center",
            inline: "nearest",
            behavior: "auto",
          });
        });
      notice(
        "team-notice",
        members.length
          ? ""
          : "El árbol aparecerá cuando los consultores completen su perfil. Puedes asignar los puestos desde la ficha de cada persona.",
      );
    } catch {
      if (snapshot === revision)
        notice(
          "team-notice",
          "No se ha podido cargar el equipo. Vuelve a intentarlo con Actualizar.",
        );
    }
  }
  async function loadProfile(details) {
    const snapshot = ++revision;
    account = details;
    clearPhotos();
    try {
      const mine = await backend.getMyTeamProfile();
      if (snapshot !== revision) return;
      me = mine;
      get("my-team-position").value = mine?.position_code || "";
      get("my-team-position").disabled = details.role !== "admin";
      get("team-save-own-position").hidden = details.role !== "admin";
      get("my-team-multiplier").value = multiplier(mine?.multiplier);
      get("my-team-manager").value = mine?.is_root
        ? "Tú · Responsable principal"
        : mine?.manager_name || "Responsable principal";
      await fetchPhotos(mine ? [mine] : [], snapshot);
      if (snapshot !== revision) return;
      avatar(get("my-team-photo"), { ...details.profile, user_id: mine?.user_id }, true);
      get("team-photo-remove").hidden = !mine?.avatar_path;
      get("team-photo-adjust").hidden = !mine?.avatar_path;
      notice("team-profile-notice", "");
    } catch {
      if (snapshot === revision)
        notice(
          "team-profile-notice",
          "No se ha podido cargar tu puesto y tu foto. Puedes seguir editando tus datos personales.",
        );
    }
  }
  async function editPhoto(file) {
    if (saving || !account) return;
    const snapshot = revision;
    saving = true;
    get("team-photo-input").disabled = true;
    try {
      const blob = await window.PhotoCrop.open(file);
      if (!blob || snapshot !== revision || !account) return;
      notice("team-profile-notice", "Guardando el encuadre…");
      await backend.uploadTeamPhoto(blob);
      if (snapshot !== revision || !account) return;
      await loadProfile(account);
      notice("team-profile-notice", "Foto y encuadre actualizados.");
    } catch (error) {
      if (snapshot === revision)
        notice(
          "team-profile-notice",
          error.message || "No se ha podido guardar la foto.",
        );
    } finally {
      saving = false;
      get("team-photo-input").disabled = false;
      get("team-photo-input").value = "";
    }
  }
  get("team-photo-input").addEventListener("change", (event) => {
    const file = event.target.files[0];
    if (file) editPhoto(file);
  });
  get("team-photo-adjust").addEventListener("click", async () => {
    if (saving || !me?.avatar_path) return;
    const snapshot = revision;
    try {
      const blob = await backend.readTeamPhoto(me.avatar_path);
      if (snapshot === revision && account)
        await editPhoto(new File([blob], "perfil.webp", { type: "image/webp" }));
    } catch {
      if (snapshot === revision)
        notice("team-profile-notice", "No se ha podido abrir la foto.");
    }
  });
  const positionFactors = {
    financial_trainee: 2,
    financial_consultant: 2.5,
    team_manager: 3.5,
  };
  get("my-team-position").addEventListener("change", () => {
    get("my-team-multiplier").value = multiplier(
      positionFactors[get("my-team-position").value],
    );
  });
  get("team-save-own-position").addEventListener("click", async () => {
    if (saving || account?.role !== "admin" || !me?.user_id) return;
    const snapshot = revision;
    saving = true;
    get("team-save-own-position").disabled = true;
    try {
      await backend.saveTeamAssignment(
        me.user_id,
        get("my-team-position").value,
        me.is_root ? null : me.manager_id,
      );
      if (snapshot !== revision || !account) return;
      await loadProfile(account);
      notice("team-profile-notice", "Tu puesto y multiplicador están actualizados.");
    } catch {
      if (snapshot === revision)
        notice("team-profile-notice", "No se ha podido guardar tu puesto.");
    } finally {
      saving = false;
      get("team-save-own-position").disabled = false;
    }
  });
  get("team-photo-remove").addEventListener("click", async () => {
    if (saving || !account) return;
    const snapshot = revision;
    saving = true;
    try {
      await backend.removeTeamPhoto();
      if (snapshot === revision && account) await loadProfile(account);
    } catch {
      if (snapshot === revision)
        notice("team-profile-notice", "No se ha podido quitar la foto.");
    } finally {
      saving = false;
    }
  });
  get("team-assignment-form").addEventListener("submit", async (event) => {
    event.preventDefault();
    if (saving || account?.role !== "admin" || !selected) return;
    saving = true;
    get("team-save-assignment").disabled = true;
    const snapshot = revision;
    try {
      await backend.saveTeamAssignment(
        selected.user_id,
        event.target.elements.position.value,
        selected.is_root ? null : event.target.elements.manager.value,
      );
      if (snapshot !== revision || !account) return;
      closeMember();
      await load(account);
      notice("team-notice", "Puesto y responsable actualizados.");
    } catch {
      if (snapshot === revision)
        notice(
          "team-member-notice",
          "No se ha podido guardar. Revisa el responsable: nadie puede depender de sí mismo ni formar una cadena circular.",
        );
    } finally {
      saving = false;
      get("team-save-assignment").disabled = false;
    }
  });
  get("team-member-close").addEventListener("click", closeMember);
  get("team-member-dialog").addEventListener("click", (event) => {
    if (event.target === event.currentTarget) closeMember();
  });
  get("team-member-dialog").addEventListener("cancel", () => {
    selected = null;
  });
  const viewport = get("team-viewport");
  let viewportSize = "";
  new ResizeObserver(() => {
    const size = viewport.clientWidth + ":" + viewport.clientHeight;
    if (
      viewport.clientWidth &&
      viewport.clientHeight &&
      size !== viewportSize &&
      members.length &&
      account
    ) {
      viewportSize = size;
      requestAnimationFrame(draw);
    }
  }).observe(viewport);
  let drag = null;
  viewport.addEventListener("pointerdown", (event) => {
    if (
      event.pointerType !== "mouse" ||
      event.button !== 0 ||
      event.target.closest("button")
    )
      return;
    drag = {
      x: event.clientX,
      y: event.clientY,
      left: viewport.scrollLeft,
      top: viewport.scrollTop,
    };
    viewport.setPointerCapture(event.pointerId);
    viewport.classList.add("team-dragging");
  });
  viewport.addEventListener("pointermove", (event) => {
    if (!drag) return;
    viewport.scrollLeft = drag.left - event.clientX + drag.x;
    viewport.scrollTop = drag.top - event.clientY + drag.y;
  });
  const stopDrag = () => {
    drag = null;
    viewport.classList.remove("team-dragging");
  };
  viewport.addEventListener("pointerup", stopDrag);
  viewport.addEventListener("pointercancel", stopDrag);
  get("team-locate").addEventListener("click", locate);
  get("team-open-profile").addEventListener("click", () =>
    document.querySelector('#panel-navigation [data-view="profile"]').click(),
  );
  get("team-locate-mini").addEventListener("click", locate);
  get("team-zoom-in").addEventListener("click", () => {
    scale = Math.min(1.4, Math.round((scale + 0.1) * 10) / 10);
    applyScale();
    locate();
  });
  get("team-zoom-out").addEventListener("click", () => {
    scale = Math.max(0.6, Math.round((scale - 0.1) * 10) / 10);
    applyScale();
    locate();
  });
  window.TeamPanel = Object.freeze({ load, loadProfile, reset });
})();
