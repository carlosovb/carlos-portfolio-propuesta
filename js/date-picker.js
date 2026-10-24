(() => {
  let opened = null;
  const el = (tag, text, cls) => {
    const n = document.createElement(tag);
    if (text != null) n.textContent = text;
    if (cls) n.className = cls;
    return n;
  };
  const iso = (d) => d.toISOString().slice(0, 10);
  const parse = (s) => (s ? new Date(s + "T12:00:00Z") : null);
  const today = () =>
    new Intl.DateTimeFormat("sv-SE", {
      timeZone: "Atlantic/Canary",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(new Date());
  function close(focus = false) {
    if (opened) {
      const o = opened;
      opened = null;
      o.popup.hidden = true;
      o.trigger.setAttribute("aria-expanded", "false");
      if (focus && o.trigger.isConnected) o.trigger.focus({ preventScroll: true });
    }
  }
  document.addEventListener("pointerdown", (e) => {
    if (opened && !opened.wrap.contains(e.target)) close();
  });
  document.addEventListener(
    "keydown",
    (e) => {
      if (opened && e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        close(true);
      }
    },
    true,
  );
  new MutationObserver((records) => {
    if (opened && (!opened.wrap.isConnected || opened.wrap.closest("[hidden]"))) close();
    for (const record of records)
      for (const added of record.addedNodes || [])
        if (added instanceof Element) {
          if (added.matches('input[type="date"],input[type="month"]')) mount(added);
          added.querySelectorAll('input[type="date"],input[type="month"]').forEach(mount);
        }
  }).observe(document.body, {
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: ["hidden"],
  });
  window.addEventListener("resize", () => {
    if (opened)
      requestAnimationFrame(() =>
        opened?.popup.scrollIntoView({ block: "nearest", behavior: "instant" }),
      );
  });
  function mount(input) {
    if (input.closest(".contract-date-wrap")) return;
    const monthly = input.type === "month",
      baseMode = monthly ? "months" : "days";
    const fieldLabel =
      input.getAttribute("aria-label") ||
      input.closest("label")?.textContent.trim() ||
      (monthly ? "Mes" : "Fecha");
    const readValue = () =>
      parse(input.value ? (monthly ? input.value + "-01" : input.value) : today());
    const wrap = el("span", null, "contract-date-wrap");
    input.after(wrap);
    wrap.append(input);
    input.classList.add("contract-date-input");
    const trigger = el("button", null, "contract-date-trigger");
    const icon = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    icon.setAttribute("viewBox", "0 0 24 24");
    icon.setAttribute("aria-hidden", "true");
    icon.innerHTML =
      '<rect x="3" y="5" width="18" height="16" rx="3"/><path d="M7 3v4M17 3v4M3 11h18M7 15h2M12 15h2M7 18h2M12 18h2"/>';
    trigger.append(icon);
    trigger.type = "button";
    const syncState = () => {
      trigger.disabled = input.disabled || input.readOnly;
      trigger.hidden = input.readOnly;
      wrap.classList.toggle("contract-date-readonly", input.readOnly);
      if (trigger.disabled && opened?.wrap === wrap) close();
    };
    syncState();
    new MutationObserver(syncState).observe(input, {
      attributes: true,
      attributeFilter: ["disabled", "readonly"],
    });
    trigger.setAttribute("aria-label", "Abrir calendario: " + fieldLabel);
    trigger.setAttribute("aria-expanded", "false");
    const popup = el("span", null, "contract-calendar");
    popup.hidden = true;
    popup.setAttribute("role", "dialog");
    popup.setAttribute("aria-label", "Elegir " + fieldLabel.toLowerCase());
    wrap.append(trigger, popup);
    let view = readValue(),
      mode = baseMode,
      range = Math.floor(view.getUTCFullYear() / 12) * 12;
    const allowed = (s) =>
      (!input.min || s >= input.min) && (!input.max || s <= input.max);
    const choose = (s) => {
      if (input.disabled || input.readOnly) return;
      input.value = s;
      input.dispatchEvent(new Event("input", { bubbles: true }));
      input.dispatchEvent(new Event("change", { bubbles: true }));
      close(true);
    };
    const button = (text, fn, cls) => {
      const b = el("button", text, cls);
      b.type = "button";
      b.addEventListener("click", fn);
      return b;
    };
    function render() {
      popup.replaceChildren();
      const head = el("span", null, "contract-calendar-head");
      const label =
        mode === "days"
          ? new Intl.DateTimeFormat("es-ES", {
              month: "long",
              year: "numeric",
              timeZone: "UTC",
            }).format(view)
          : mode === "months"
            ? String(view.getUTCFullYear())
            : range + "–" + (range + 11);
      const shift = (delta) => {
        if (mode === "years") range += delta * 12;
        else if (mode === "months")
          view = new Date(Date.UTC(view.getUTCFullYear() + delta, 0, 1, 12));
        else
          view = new Date(
            Date.UTC(view.getUTCFullYear(), view.getUTCMonth() + delta, 1, 12),
          );
        render();
      };
      head.append(
        button("‹", () => shift(-1), "calendar-prev"),
        button(
          label,
          () => {
            mode = mode === "years" ? baseMode : "years";
            range = Math.floor(view.getUTCFullYear() / 12) * 12;
            render();
          },
          "calendar-period",
        ),
        button("›", () => shift(1), "calendar-next"),
      );
      head.firstChild.setAttribute(
        "aria-label",
        mode === "days"
          ? "Mes anterior"
          : mode === "months"
            ? "Año anterior"
            : "Años anteriores",
      );
      head.lastChild.setAttribute(
        "aria-label",
        mode === "days"
          ? "Mes siguiente"
          : mode === "months"
            ? "Año siguiente"
            : "Años siguientes",
      );
      popup.append(head);
      const grid = el(
        "span",
        null,
        mode === "days"
          ? "contract-calendar-days"
          : mode === "months"
            ? "contract-calendar-months"
            : "contract-calendar-years",
      );
      if (mode === "years") {
        for (let y = range; y < range + 12; y++) {
          const b = button(String(y), () => {
            view = new Date(Date.UTC(y, view.getUTCMonth(), 1, 12));
            mode = baseMode;
            render();
          });
          b.disabled =
            y < Number(input.min?.slice(0, 4) || 2000) ||
            y > Number(input.max?.slice(0, 4) || today().slice(0, 4));
          grid.append(b);
        }
      } else if (mode === "months") {
        for (let m = 0; m < 12; m++) {
          const date = new Date(Date.UTC(view.getUTCFullYear(), m, 1, 12)),
            value = iso(date).slice(0, 7);
          const b = button(
            new Intl.DateTimeFormat("es-ES", { month: "short", timeZone: "UTC" }).format(
              date,
            ),
            () => choose(value),
          );
          b.dataset.month = value;
          b.disabled = !allowed(value);
          b.setAttribute("aria-pressed", String(value === input.value));
          b.setAttribute(
            "aria-label",
            new Intl.DateTimeFormat("es-ES", {
              month: "long",
              year: "numeric",
              timeZone: "UTC",
            }).format(date),
          );
          if (value === today().slice(0, 7)) b.setAttribute("aria-current", "date");
          b.addEventListener("keydown", (e) => {
            const delta = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -3, ArrowDown: 3 }[
              e.key
            ];
            if (delta) {
              e.preventDefault();
              const next = new Date(Date.UTC(view.getUTCFullYear(), m + delta, 1, 12)),
                v = iso(next).slice(0, 7);
              if (!allowed(v)) return;
              view = next;
              render();
              popup.querySelector('[data-month="' + v + '"]')?.focus();
            }
          });
          grid.append(b);
        }
      } else {
        ["L", "M", "X", "J", "V", "S", "D"].forEach((day) =>
          grid.append(el("small", day)),
        );
        const first = new Date(
          Date.UTC(view.getUTCFullYear(), view.getUTCMonth(), 1, 12),
        );
        const offset = (first.getUTCDay() + 6) % 7;
        for (let n = 0; n < 42; n++) {
          const date = new Date(
              Date.UTC(view.getUTCFullYear(), view.getUTCMonth(), 1 - offset + n, 12),
            ),
            value = iso(date);
          const b = button(String(date.getUTCDate()), () => choose(value));
          b.dataset.date = value;
          b.disabled = !allowed(value);
          b.dataset.outside = String(date.getUTCMonth() !== view.getUTCMonth());
          b.setAttribute(
            "aria-label",
            new Intl.DateTimeFormat("es-ES", {
              dateStyle: "full",
              timeZone: "UTC",
            }).format(date),
          );
          b.setAttribute("aria-pressed", String(value === input.value));
          if (value === today()) b.setAttribute("aria-current", "date");
          b.addEventListener("keydown", (e) => {
            const deltas = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -7, ArrowDown: 7 };
            if (deltas[e.key]) {
              e.preventDefault();
              const next = new Date(date);
              next.setUTCDate(next.getUTCDate() + deltas[e.key]);
              const s = iso(next);
              if (!allowed(s)) return;
              view = new Date(Date.UTC(next.getUTCFullYear(), next.getUTCMonth(), 1, 12));
              render();
              popup.querySelector('[data-date="' + s + '"]')?.focus();
            }
          });
          grid.append(b);
        }
      }
      popup.append(grid);
      const foot = el("span", null, "contract-calendar-footer");
      foot.append(
        button(monthly ? "Este mes" : "Hoy", () =>
          choose(monthly ? today().slice(0, 7) : today()),
        ),
      );
      if (!input.required)
        foot.append(button(monthly ? "Sin mes" : "Sin fecha", () => choose("")));
      popup.append(foot);
    }
    trigger.addEventListener("click", () => {
      if (opened?.wrap === wrap) {
        close();
        return;
      }
      close();
      window.ContractControls?.close();
      view = readValue();
      mode = baseMode;
      render();
      popup.hidden = false;
      trigger.setAttribute("aria-expanded", "true");
      opened = { wrap, popup, trigger };
      popup.scrollIntoView({ block: "nearest", behavior: "instant" });
      (
        popup.querySelector('[aria-pressed="true"]') ||
        popup.querySelector('[aria-current="date"]') ||
        popup.querySelector("button:not(:disabled)")
      )?.focus({ preventScroll: true });
    });
  }
  document.querySelectorAll('input[type="date"],input[type="month"]').forEach(mount);
  window.DatePicker = { mount, close };
})();
