(() => {
  let opened = null;
  const el = (tag, text, cls) => {
    const n = document.createElement(tag);
    if (text != null) n.textContent = text;
    if (cls) n.className = cls;
    return n;
  };
  function close() {
    if (opened) {
      opened.popup.hidden = true;
      opened.trigger.setAttribute("aria-expanded", "false");
      opened = null;
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
        const t = opened.trigger;
        close();
        t.focus({ preventScroll: true });
      }
    },
    true,
  );
  function payment(select) {
    select.classList.add("contract-native-control");
    select.tabIndex = -1;
    select.setAttribute("aria-hidden", "true");
    const group = el("span", null, "contract-payment-choices");
    group.setAttribute("role", "group");
    group.setAttribute("aria-label", "Tipo de aportación");
    const buttons = [...select.options].map((option) => {
      const b = el("button", option.value === "monthly" ? "Mensual" : "Única");
      b.type = "button";
      b.dataset.payment = option.value;
      b.addEventListener("click", () => {
        select.value = option.value;
        select.dispatchEvent(new Event("change", { bubbles: true }));
      });
      group.append(b);
      return b;
    });
    const sync = () =>
      buttons.forEach((b) =>
        b.setAttribute("aria-pressed", String(b.dataset.payment === select.value)),
      );
    select.after(group);
    select.addEventListener("change", sync);
    sync();
  }
  function amount(input) {
    const wrap = el("span", null, "contract-amount-wrap");
    input.after(wrap);
    wrap.append(input);
    const trigger = el("button", "€ ⌄", "contract-amount-trigger");
    trigger.type = "button";
    trigger.setAttribute("aria-label", "Ver importes sugeridos");
    trigger.setAttribute("aria-expanded", "false");
    const popup = el("span", null, "contract-amount-options");
    popup.hidden = true;
    popup.setAttribute("role", "group");
    popup.setAttribute("aria-label", "Importes sugeridos");
    wrap.append(trigger, popup);
    function show() {
      close();
      const max = Math.min(Number(input.max) || 8000, 8000),
        min = Number(input.min) || 0.01;
      popup.replaceChildren();
      const values = [];
      for (let n = 50; n <= max; n += 50) if (n >= min) values.push(n);
      if (max >= min && !values.includes(max)) values.push(max);
      if (!values.length) {
        popup.append(el("small", "Escribe el importe exacto."));
      }
      for (const value of values) {
        const b = el(
          "button",
          new Intl.NumberFormat("es-ES", { maximumFractionDigits: 2 }).format(value) +
            " €",
        );
        b.type = "button";
        b.addEventListener("click", () => {
          input.value = String(value);
          input.dispatchEvent(new Event("input", { bubbles: true }));
          input.dispatchEvent(new Event("change", { bubbles: true }));
          close();
          input.focus({ preventScroll: true });
        });
        popup.append(b);
      }
      popup.hidden = false;
      trigger.setAttribute("aria-expanded", "true");
      opened = { wrap, popup, trigger };
    }
    trigger.addEventListener("click", () => (opened?.wrap === wrap ? close() : show()));
    input.addEventListener("focus", show);
    input.addEventListener("keydown", (e) => {
      if (e.key === "ArrowDown") {
        e.preventDefault();
        show();
        popup.querySelector("button")?.focus();
      }
    });
    input.addEventListener("input", () => {
      input.setCustomValidity("");
    });
    wrap.addEventListener("focusout", () =>
      setTimeout(() => {
        if (opened?.wrap === wrap && !wrap.contains(document.activeElement)) close();
      }, 0),
    );
    return {
      close,
      refresh: () => {
        if (opened?.wrap === wrap) show();
      },
    };
  }
  window.ContractControls = { payment, amount, close };
})();
