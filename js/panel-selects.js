// Selectores del perfil y administración: mismo valor nativo, presentación y teclado propios.
(() => {
  const controls = [];
  let opened = null,
    serial = 0;
  function enhance(select) {
    const wrap = document.createElement("span");
    wrap.className = "panel-select";
    select.after(wrap);
    wrap.append(select);
    select.classList.add("panel-select-native");
    select.tabIndex = -1;
    select.setAttribute("aria-hidden", "true");
    const trigger = document.createElement("button");
    trigger.type = "button";
    trigger.className = "panel-select-trigger";
    trigger.setAttribute("role", "combobox");
    trigger.setAttribute("aria-haspopup", "listbox");
    trigger.setAttribute("aria-expanded", "false");
    const label = [...select.closest("label").childNodes]
      .filter((n) => n.nodeType === 3)
      .map((n) => n.textContent.trim())
      .filter(Boolean)
      .join(" ");
    trigger.setAttribute("aria-label", label);
    const popup = document.createElement("div");
    popup.className = "panel-select-options";
    popup.id = "panel-select-" + ++serial;
    popup.setAttribute("role", "listbox");
    popup.setAttribute("aria-label", label);
    popup.hidden = true;
    trigger.setAttribute("aria-controls", popup.id);
    wrap.append(trigger, popup);
    let index = 0;
    function sync() {
      trigger.disabled = select.disabled;
      trigger.textContent =
        (select.selectedOptions[0]?.textContent || "Selecciona") + "  ⌄";
      if (select.disabled) close();
    }
    function close() {
      popup.hidden = true;
      trigger.setAttribute("aria-expanded", "false");
      trigger.removeAttribute("aria-activedescendant");
      if (opened === api) opened = null;
    }
    function highlight() {
      [...popup.children].forEach((option, i) => {
        option.dataset.highlighted = String(i === index);
      });
      const option = popup.children[index];
      if (option) {
        trigger.setAttribute("aria-activedescendant", option.id);
        if (option.offsetTop < popup.scrollTop) popup.scrollTop = option.offsetTop;
        else if (
          option.offsetTop + option.offsetHeight >
          popup.scrollTop + popup.clientHeight
        )
          popup.scrollTop = option.offsetTop + option.offsetHeight - popup.clientHeight;
      }
    }
    function choose(i) {
      const option = select.options[i];
      if (!option || option.disabled) return;
      select.value = option.value;
      select.dispatchEvent(new Event("change", { bubbles: true }));
      sync();
      close();
      trigger.focus({ preventScroll: true });
    }
    function open() {
      if (select.disabled) return;
      opened?.close();
      opened = api;
      popup.replaceChildren();
      [...select.options].forEach((option, i) => {
        const item = document.createElement("div");
        item.id = popup.id + "-" + i;
        item.setAttribute("role", "option");
        item.setAttribute("aria-selected", String(option.selected));
        item.className = "panel-select-option";
        const text = document.createElement("span");
        text.textContent = option.textContent;
        item.append(text);
        const level = window.CareerLevels.find((l) => l.code === option.value);
        if (level) {
          const factor = document.createElement("strong");
          factor.textContent = "×" + String(level.factor).replace(".", ",");
          item.append(factor);
          const group = document.createElement("small");
          group.textContent = level.path;
          item.append(group);
        }
        item.addEventListener("click", (e) => {
          e.preventDefault();
          e.stopPropagation();
          choose(i);
        });
        popup.append(item);
      });
      index = Math.max(0, select.selectedIndex);
      popup.hidden = false;
      trigger.setAttribute("aria-expanded", "true");
      const r = trigger.getBoundingClientRect(),
        below = innerHeight - r.bottom,
        above = r.top,
        up = below < 240 && above > below;
      popup.style.left = r.left + "px";
      popup.style.width = r.width + "px";
      popup.style.maxHeight =
        Math.max(110, Math.min(360, (up ? above : below) - 16)) + "px";
      popup.style.top = up ? "auto" : r.bottom + 7 + "px";
      popup.style.bottom = up ? innerHeight - r.top + 7 + "px" : "auto";
      highlight();
    }
    trigger.addEventListener("click", (e) => {
      e.preventDefault();
      popup.hidden ? open() : close();
    });
    trigger.addEventListener("keydown", (e) => {
      if (["ArrowDown", "ArrowUp", "Home", "End"].includes(e.key)) {
        e.preventDefault();
        if (popup.hidden) open();
        else {
          index =
            e.key === "Home"
              ? 0
              : e.key === "End"
                ? select.options.length - 1
                : Math.max(
                    0,
                    Math.min(
                      select.options.length - 1,
                      index + (e.key === "ArrowDown" ? 1 : -1),
                    ),
                  );
          highlight();
        }
      } else if (e.key === "Escape" && !popup.hidden) {
        e.preventDefault();
        e.stopPropagation();
        close();
      } else if (["Enter", " "].includes(e.key) && !popup.hidden) {
        e.preventDefault();
        choose(index);
      } else if (e.key === "Tab") close();
    });
    select.addEventListener("change", sync);
    new MutationObserver(sync).observe(select, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ["disabled", "selected"],
    });
    const api = { sync, close, wrap };
    controls.push(api);
    sync();
  }
  for (const select of document.querySelectorAll(
    "#my-team-position,#team-assignment-form select",
  ))
    enhance(select);
  document.addEventListener("pointerdown", (e) => {
    if (opened && !opened.wrap.contains(e.target)) opened.close();
  });
  for (const type of ["wheel", "touchmove"])
    document.addEventListener(
      type,
      (e) => {
        if (opened && !e.target.closest?.(".panel-select-options")) opened.close();
      },
      { capture: true, passive: true },
    );
  window.addEventListener("resize", () => opened?.close());
  window.PanelSelects = {
    sync: () => controls.forEach((c) => c.sync()),
    close: () => opened?.close(),
  };
})();
