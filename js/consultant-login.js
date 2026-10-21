// Acceso desde el portfolio: la contraseña nunca se guarda ni se pasa en la URL.
(() => {
  const backend = window.PortfolioBackend;
  const dialog = document.getElementById("consultant-login-dialog");
  const form = document.getElementById("consultant-login-form");
  const open = document.getElementById("open-consultant-login");
  const submit = document.getElementById("consultant-login-submit");
  const notice = document.getElementById("consultant-login-notice");
  let pending = false;
  let generation = 0;

  function message(text) {
    notice.textContent = text;
    notice.hidden = !text;
  }

  function positionDialog() {
    const header = document.querySelector(".site-header").getBoundingClientRect();
    dialog.style.setProperty("--login-top", `${Math.max(12, header.bottom + 10)}px`);
    const width = Math.min(460, innerWidth - 30);
    const right = Math.max(
      15,
      Math.min(innerWidth - open.getBoundingClientRect().right, innerWidth - width - 15),
    );
    dialog.style.setProperty("--login-right", `${right}px`);
  }

  open.addEventListener("click", () => {
    message(backend?.ready ? "" : "El acceso no está disponible en este momento.");
    submit.disabled = !backend?.ready;
    positionDialog();
    dialog.showModal();
    open.setAttribute("aria-expanded", "true");
    document.body.classList.add("consultant-dialog-open");
  });
  document
    .getElementById("close-consultant-login")
    .addEventListener("click", () => dialog.close());
  dialog.addEventListener("close", () => {
    open.setAttribute("aria-expanded", "false");
    generation++;
    form.reset();
    document.body.classList.remove("consultant-dialog-open");
    open.focus({ preventScroll: true });
  });
  addEventListener("resize", () => {
    if (dialog.open) positionDialog();
  });

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (pending || !backend?.ready || !form.reportValidity()) return;
    const current = ++generation;
    pending = true;
    submit.disabled = true;
    form.setAttribute("aria-busy", "true");
    message("Comprobando acceso…");
    try {
      await backend.signIn(
        form.elements.email.value.trim(),
        form.elements.password.value,
      );
      form.elements.password.value = "";
      if (current !== generation || !dialog.open) {
        await backend.signOut();
        return;
      }
      await backend.preparePanelRedirect();
      if (current !== generation || !dialog.open) {
        await backend.signOut();
        return;
      }
      message("Acceso correcto. Abriendo tu panel…");
      window.location.assign(new URL("panel/", document.baseURI).href);
    } catch {
      form.elements.password.value = "";
      await backend.signOut();
      if (current === generation && dialog.open)
        message(
          "No se ha podido acceder. Comprueba el correo, la contraseña y los permisos de tu cuenta.",
        );
    } finally {
      pending = false;
      submit.disabled = !backend?.ready;
      form.removeAttribute("aria-busy");
    }
  });
  addEventListener("pageshow", (event) => {
    if (event.persisted) {
      form.reset();
      if (dialog.open) dialog.close();
      backend.signOut();
    }
  });
})();
