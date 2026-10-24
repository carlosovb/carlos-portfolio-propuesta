/* Confirmaciones de la web. Cancelar nunca modifica datos. */
(() => {
  let pending = null;
  const dialog = document.createElement("dialog");
  dialog.id = "site-confirm-dialog";
  dialog.setAttribute("aria-labelledby", "site-confirm-title");
  dialog.setAttribute("aria-describedby", "site-confirm-message");
  const icon = document.createElement("span");
  icon.className = "site-confirm-icon";
  icon.textContent = "?";
  icon.setAttribute("aria-hidden", "true");
  const title = document.createElement("h2");
  title.id = "site-confirm-title";
  const message = document.createElement("p");
  message.id = "site-confirm-message";
  const actions = document.createElement("div");
  actions.className = "site-confirm-actions";
  const cancel = document.createElement("button");
  cancel.type = "button";
  cancel.textContent = "Cancelar";
  cancel.className = "site-confirm-cancel";
  cancel.dataset.confirmNo = "";
  const yes = document.createElement("button");
  yes.type = "button";
  yes.className = "site-confirm-yes";
  yes.dataset.confirmYes = "";
  actions.append(cancel, yes);
  dialog.append(icon, title, message, actions);
  document.body.append(dialog);
  function valid(opener, parent) {
    return (
      (!opener || (opener.isConnected && !opener.closest("[hidden]"))) &&
      (!parent || parent.open)
    );
  }
  function finish(result) {
    if (!pending) return;
    const state = pending;
    pending = null;
    state.observer.disconnect();
    dialog.close();
    message.textContent = "";
    title.textContent = "";
    if (valid(state.opener, state.parent)) {
      state.opener?.focus({ preventScroll: true });
      window.scrollTo({ left: state.x, top: state.y, behavior: "instant" });
    }
    state.resolve(result);
  }
  cancel.addEventListener("click", () => finish(false));
  yes.addEventListener("click", () => finish(true));
  dialog.addEventListener("cancel", (event) => {
    event.preventDefault();
    finish(false);
  });
  dialog.addEventListener("close", () => {
    if (!dialog.open) finish(false);
  });
  let outside = false;
  const isOutside = (event) => {
    const r = dialog.getBoundingClientRect();
    return (
      event.clientX < r.left ||
      event.clientX > r.right ||
      event.clientY < r.top ||
      event.clientY > r.bottom
    );
  };
  dialog.addEventListener(
    "pointerdown",
    (event) => (outside = event.target === dialog && isOutside(event)),
  );
  dialog.addEventListener("click", (event) => {
    if (outside && event.target === dialog && isOutside(event)) finish(false);
    outside = false;
  });
  window.SiteConfirm = {
    ask(text, options = {}) {
      if (pending) return Promise.resolve(false);
      const opener =
        document.activeElement instanceof HTMLElement ? document.activeElement : null;
      const parent = opener?.closest("dialog");
      cancel.textContent = options.cancel || "Cancelar";
      const lower = String(text).toLowerCase();
      title.textContent =
        options.title ||
        (lower.includes("dar de baja")
          ? "Dar de baja"
          : lower.includes("elimin")
            ? "Confirmar eliminación"
            : lower.includes("historial")
              ? "Pasar al historial"
              : "Confirmar cambio");
      message.textContent = String(text);
      yes.textContent =
        options.accept ||
        (lower.includes("dar de baja")
          ? "Sí, dar de baja"
          : lower.includes("eliminados")
            ? "Mover a Eliminados"
            : lower.includes("elimin")
              ? "Sí, eliminar"
              : lower.includes("historial")
                ? "Pasar al historial"
                : "Continuar");
      dialog.dataset.danger = String(
        lower.includes("elimin") && !lower.includes("eliminados"),
      );
      return new Promise((resolve) => {
        const observer = new MutationObserver(() => {
          if (pending && !valid(opener, parent)) finish(false);
        });
        pending = {
          resolve,
          opener,
          parent,
          observer,
          x: window.scrollX,
          y: window.scrollY,
        };
        observer.observe(document.body, {
          subtree: true,
          childList: true,
          attributes: true,
          attributeFilter: ["hidden", "open"],
        });
        dialog.showModal();
        cancel.focus({ preventScroll: true });
        window.dispatchEvent(new Event("site-confirm-open"));
      });
    },
    cancel: () => finish(false),
  };
})();
