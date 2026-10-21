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
  function avatar(target, person) {
    target.replaceChildren();
    const initials = fullName(person)
      .split(" ")
      .filter(Boolean)
      .map((word) => word[0])
      .slice(0, 2)
      .join("");
    target.textContent = initials || "CC";
    const src = photos.get(person.user_id);
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
    selected = null;
    clearPhotos();
    places.clear();
    get("team-member-dialog").close();
    get("team-canvas").replaceChildren();
    get("team-assignment-form").reset();
    get("team-photo-input").value = "";
    get("my-team-photo").replaceChildren();
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
      left: Math.max(0, (place.x + 120) * scale - viewport.clientWidth / 2),
      top: Math.max(0, (place.y + 100) * scale - viewport.clientHeight / 2),
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
    places.clear();
    const byId = new Map(members.map((member) => [member.user_id, member]));
    const children = (id) => members.filter((member) => member.manager_id === id);
    const roots = members.filter((member) => !byId.has(member.manager_id));
    const viewport = get("team-viewport");
    const paddingX = Math.max(40, viewport.clientWidth / 2 - 120);
    const paddingY = Math.max(48, viewport.clientHeight / 2 - 103);
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
        cursor += 280;
      } else {
        const positions = reports.map((child) => layout(child, depth + 1));
        x = (positions[0] + positions[positions.length - 1]) / 2;
      }
      places.set(member.user_id, { x, y: paddingY + depth * 274 });
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
    height = Math.max(500, paddingY + (maxDepth + 1) * 274 + viewport.clientHeight / 2);
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
      const y = parent.y + 206;
      path.setAttribute(
        "d",
        "M " +
          (parent.x + 120) +
          " " +
          y +
          " V " +
          (y + 32) +
          " H " +
          (child.x + 120) +
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
      face.className = "team-avatar";
      avatar(face, member);
      const name = document.createElement("strong");
      name.textContent = fullName(member);
      const position = document.createElement("span");
      position.className = "team-node-position";
      position.textContent = member.position || "Puesto pendiente";
      const factor = document.createElement("span");
      factor.className = "team-node-factor";
      factor.textContent = multiplier(member.multiplier);
      card.append(face, name, position, factor);
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
    get("team-member-manager").textContent = manager
      ? fullName(manager)
      : "Sin responsable asignado";
    get("team-member-reports").textContent = childrenCount(member.user_id) + " personas";
    avatar(get("team-member-photo"), member);
    const form = get("team-assignment-form");
    form.hidden = account?.role !== "admin";
    form.elements.position.value = member.position_code || "";
    form.elements.manager.replaceChildren(new Option("Sin responsable asignado", ""));
    members
      .filter((person) => person.user_id !== member.user_id)
      .forEach((person) =>
        form.elements.manager.add(new Option(fullName(person), person.user_id)),
      );
    form.elements.manager.value = member.manager_id || "";
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
      const [directory, mine] = await Promise.all([
        backend.listTeam(),
        backend.getMyTeamProfile(),
      ]);
      if (snapshot !== revision) return;
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
      get("my-team-multiplier").value = multiplier(mine?.multiplier);
      get("my-team-manager").value = mine?.manager_name || "Sin responsable asignado";
      await fetchPhotos(mine ? [mine] : [], snapshot);
      if (snapshot !== revision) return;
      avatar(get("my-team-photo"), { ...details.profile, user_id: mine?.user_id });
      get("team-photo-remove").hidden = !mine?.avatar_path;
      notice("team-profile-notice", "");
    } catch {
      if (snapshot === revision)
        notice(
          "team-profile-notice",
          "No se ha podido cargar tu puesto y tu foto. Puedes seguir editando tus datos personales.",
        );
    }
  }
  async function croppedPhoto(file) {
    if (
      !["image/jpeg", "image/png", "image/webp"].includes(file.type) ||
      file.size > 5 * 1024 * 1024
    )
      throw new Error("Selecciona un JPG, PNG o WebP de hasta 5 MB.");
    const bitmap = await createImageBitmap(file);
    try {
      const canvas = document.createElement("canvas");
      canvas.width = 512;
      canvas.height = 512;
      const side = Math.min(bitmap.width, bitmap.height);
      canvas
        .getContext("2d")
        .drawImage(
          bitmap,
          (bitmap.width - side) / 2,
          (bitmap.height - side) / 2,
          side,
          side,
          0,
          0,
          512,
          512,
        );
      const blob = await new Promise((resolve) =>
        canvas.toBlob(resolve, "image/webp", 0.86),
      );
      if (!blob || blob.type !== "image/webp")
        throw new Error("No se ha podido preparar la foto.");
      return blob;
    } finally {
      bitmap.close();
    }
  }
  get("team-photo-input").addEventListener("change", async (event) => {
    const file = event.target.files[0];
    if (!file || saving || !account) return;
    const snapshot = revision;
    saving = true;
    event.target.disabled = true;
    notice("team-profile-notice", "Guardando tu foto…");
    try {
      const blob = await croppedPhoto(file);
      if (snapshot !== revision || !account) return;
      await backend.uploadTeamPhoto(blob);
      if (snapshot !== revision || !account) return;
      await loadProfile(account);
      notice("team-profile-notice", "Foto actualizada. Será visible para el equipo.");
    } catch (error) {
      if (snapshot === revision)
        notice(
          "team-profile-notice",
          error.message || "No se ha podido guardar la foto.",
        );
    } finally {
      saving = false;
      event.target.disabled = false;
      event.target.value = "";
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
        event.target.elements.manager.value,
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
