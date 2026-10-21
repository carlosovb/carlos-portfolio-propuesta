// Controles del formulario: iconos propios y selectores accesibles sin dependencias.
(() => {
  const paths = {
    shield: "M12 3 4 6v6c0 5 8 9 8 9s8-4 8-9V6l-8-3ZM8 12l3 3 5-6",
    savings: "M4 10h16v10H4zM7 10V6h10v4M9 15h6M12 12v6",
    chart: "M4 20V4M4 20h17M8 15l4-5 4 2 5-7M16 5h5v5",
    sun: "M12 3v2M12 19v2M3 12h2M19 12h2M5 5l2 2M17 17l2 2M19 5l-2 2M7 17l-2 2M16 12a4 4 0 1 1-8 0 4 4 0 0 1 8 0",
    home: "m3 11 9-8 9 8M5 10v11h14V10M9 21v-7h6v7",
    debt: "M4 5h16v14H4zM7 9h5M7 13h3M13 13l3 3 3-3M16 10v6",
    heart: "M20 5c-3-3-6-1-8 1-2-2-5-4-8-1s-1 7 8 15c9-8 11-12 8-15Z",
    children: "m2 9 10-5 10 5-10 5L2 9ZM6 12v5c4 3 8 3 12 0v-5M22 9v8",
    wallet: "M3 6h17v14H3zM3 6l14-3v3M15 11h6v5h-6zM17 13h1",
    person: "M16 7a4 4 0 1 1-8 0 4 4 0 0 1 8 0M4 21v-2a8 8 0 0 1 16 0v2",
    people:
      "M10 7a3 3 0 1 1-6 0 3 3 0 0 1 6 0M2 21v-3a6 6 0 0 1 12 0v3M17 4a3 3 0 0 1 0 6M17 13a5 5 0 0 1 5 5v3",
    check: "m5 12 4 4L19 6",
    arrow: "M4 12h16M14 6l6 6-6 6",
    clock: "M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0M12 6v6l4 2",
    plus: "M12 5v14M5 12h14",
  };
  function icon(name) {
    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    svg.setAttribute("viewBox", "0 0 24 24");
    svg.setAttribute("aria-hidden", "true");
    svg.setAttribute("focusable", "false");
    svg.classList.add("premeeting-icon");
    const path = document.createElementNS(svg.namespaceURI, "path");
    path.setAttribute("d", paths[name] || paths.wallet);
    svg.append(path);
    return svg;
  }
  let counter = 0;
  let closeCurrent = null;
  function selectControl(select, label) {
    const host = document.createElement("div");
    host.className = "premeeting-select";
    const trigger = document.createElement("button");
    trigger.type = "button";
    trigger.className = "premeeting-select-trigger";
    trigger.setAttribute("role", "combobox");
    trigger.setAttribute("aria-label", label);
    trigger.setAttribute("aria-haspopup", "listbox");
    trigger.setAttribute("aria-expanded", "false");
    trigger.setAttribute("aria-required", String(select.required));
    const menu = document.createElement("div");
    menu.id = `premeeting-options-${++counter}`;
    menu.className = "premeeting-select-menu";
    menu.setAttribute("role", "listbox");
    menu.setAttribute("aria-label", label);
    menu.hidden = true;
    trigger.setAttribute("aria-controls", menu.id);
    select.hidden = true;
    select.setAttribute("aria-hidden", "true");
    select.setAttribute("aria-label", `${label} · selector interno`);
    let active = Math.max(0, select.selectedIndex);
    const options = [...select.options].map((option, i) => {
      const item = document.createElement("button");
      item.type = "button";
      item.tabIndex = -1;
      item.id = `${menu.id}-${i}`;
      item.setAttribute("role", "option");
      item.textContent = option.textContent;
      item.addEventListener("click", () => choose(i));
      menu.append(item);
      return item;
    });
    function update() {
      trigger.textContent =
        select.selectedOptions[0]?.textContent || "Selecciona una opción";
      trigger.dataset.empty = String(!select.value);
      options.forEach((o, i) =>
        o.setAttribute("aria-selected", String(i === select.selectedIndex)),
      );
    }
    function highlight() {
      options.forEach((o, i) => o.classList.toggle("is-active", i === active));
      trigger.setAttribute("aria-activedescendant", options[active].id);
      options[active].scrollIntoView({ block: "nearest", behavior: "instant" });
    }
    function close() {
      menu.hidden = true;
      trigger.setAttribute("aria-expanded", "false");
      trigger.removeAttribute("aria-activedescendant");
      if (closeCurrent === close) closeCurrent = null;
    }
    function open() {
      closeCurrent?.();
      closeCurrent = close;
      active = Math.max(0, select.selectedIndex);
      menu.hidden = false;
      const rect = trigger.getBoundingClientRect();
      host.classList.toggle(
        "opens-up",
        rect.bottom + 260 > innerHeight && rect.top > 260,
      );
      trigger.setAttribute("aria-expanded", "true");
      highlight();
    }
    function choose(i) {
      select.selectedIndex = i;
      select.dispatchEvent(new Event("input", { bubbles: true }));
      select.dispatchEvent(new Event("change", { bubbles: true }));
      update();
      close();
      trigger.focus({ preventScroll: true });
    }
    trigger.addEventListener("click", () => (menu.hidden ? open() : close()));
    host.addEventListener("keydown", (event) => {
      if (["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) {
        event.preventDefault();
        if (menu.hidden) open();
        else {
          active =
            event.key === "Home"
              ? 0
              : event.key === "End"
                ? options.length - 1
                : (active + (event.key === "ArrowDown" ? 1 : -1) + options.length) %
                  options.length;
          highlight();
        }
      } else if (["Enter", " "].includes(event.key) && !menu.hidden) {
        event.preventDefault();
        choose(active);
      } else if (event.key === "Escape" && !menu.hidden) {
        event.preventDefault();
        event.stopPropagation();
        close();
        trigger.focus();
      } else if (event.key === "Tab") close();
    });
    host.addEventListener("focusout", (event) => {
      if (!host.contains(event.relatedTarget)) close();
    });
    select.addEventListener("change", update);
    host.append(select, trigger, menu);
    update();
    return host;
  }
  document.addEventListener("pointerdown", (event) => {
    if (!event.target.closest(".premeeting-select")) closeCurrent?.();
  });
  window.PremeetingControls = { icon, selectControl, close: () => closeCurrent?.() };
})();
