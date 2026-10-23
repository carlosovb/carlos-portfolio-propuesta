// Activación y recuperación mediante un enlace validado por Supabase.
(() => {
  const backend = window.PortfolioBackend;
  const link = window.PORTFOLIO_ACCOUNT_LINK || {};
  delete window.PORTFOLIO_ACCOUNT_LINK;
  const get = (id) => document.getElementById(id);
  const form = get("account-form");
  let details = null;
  let pending = false;
  let transferring = false;

  function message(text) {
    get("account-notice").textContent = text;
    get("account-notice").hidden = !text;
  }
  function configureForm() {
    const recovery = link.type === "recovery";
    get("account-step").textContent = recovery
      ? "Nueva contraseña"
      : "02 · Perfil y contraseña";
    get("account-title").textContent = recovery
      ? "Elige una contraseña nueva."
      : "Bienvenido a tu espacio.";
    get("account-description").textContent = recovery
      ? "Crea una nueva contraseña para volver a entrar en tu cuenta."
      : "Completa tus datos y crea tu contraseña personal para activar el acceso.";
    get("account-personal-fields").hidden = recovery;
    get("account-personal-fields").disabled = recovery;
    form.elements.first_name.value = details?.profile?.first_name || "";
    form.elements.last_name.value = details?.profile?.last_name || "";
    form.elements.phone.value = details?.profile?.phone || "";
    form.elements.consultant_since.value = details?.profile?.consultant_since || "";
    form.elements.consultant_since.readOnly = !!details?.profile?.consultant_since;
    form.elements.consultant_since.max = new Intl.DateTimeFormat("sv-SE", {
      timeZone: "Atlantic/Canary",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(new Date());
    form.elements.email.value = details?.email || "";
    form.hidden = false;
  }

  if (!backend.ready)
    message("El acceso todavía no está disponible. Contacta con el administrador.");
  else if (link.recovery_request) {
    get("account-step").textContent = "Recuperación de cuenta";
    get("account-title").textContent = "Recupera tu acceso.";
    get("account-description").textContent =
      "Introduce el correo con el que te dieron de alta.";
    get("recovery-form").hidden = false;
  } else if (["invite", "recovery"].includes(link.type) && !link.error) {
    get("account-title").textContent =
      link.type === "recovery" ? "Recupera tu acceso." : "Activa tu cuenta.";
    get("account-description").textContent =
      "Tu enlace está listo para comprobarse. Pulsa el botón para continuar de forma segura.";
    get("verify-account-link").hidden = false;
  } else {
    get("account-step").textContent = "Necesitas tu invitación";
    get("account-title").textContent = "Abre tu enlace personal.";
    get("account-description").textContent =
      "Utiliza el enlace completo que te ha enviado el administrador para preparar tu cuenta.";
    message(
      "Necesitas un enlace válido de invitación o recuperación. Si ha caducado, solicita uno nuevo al administrador.",
    );
  }

  get("verify-account-link").addEventListener("click", async () => {
    if (pending) return;
    pending = true;
    get("verify-account-link").disabled = true;
    message("Validando tu enlace…");
    try {
      details = await backend.acceptAccountLink(link);
      delete link.token_hash;
      delete link.access_token;
      delete link.refresh_token;
      if (link.type === "invite" && details.profile_complete) {
        message("Tu cuenta ya está activada. Entra con tu correo y contraseña.");
      } else if (!details.profile_enabled)
        message(
          "El administrador debe activar la configuración de perfiles antes de continuar.",
        );
      else {
        configureForm();
        message("");
      }
      get("verify-account-link").hidden = true;
    } catch {
      message(
        "No se ha podido validar el enlace. Puede haber caducado o haberse utilizado. Solicita uno nuevo.",
      );
    } finally {
      pending = false;
      get("verify-account-link").disabled = false;
    }
  });

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (pending || !details) return;
    if (form.elements.password.value !== form.elements.confirm_password.value) {
      message("Las contraseñas no coinciden.");
      return;
    }
    pending = true;
    get("complete-account").disabled = true;
    message("Preparando tu cuenta…");
    try {
      if (link.type === "invite") {
        details = await backend.saveProfile({
          first_name: form.elements.first_name.value.trim(),
          last_name: form.elements.last_name.value.trim(),
          phone: form.elements.phone.value.trim(),
          consultant_since: form.elements.consultant_since.value,
        });
      }
      // En una invitación siempre guardar la contraseña elegida, aunque Auth ya
      // haya actualizado internamente el indicador de contraseña al validar el enlace.
      details = await backend.setPasswordFromLink(form.elements.password.value);
      form.reset();
      await backend.preparePanelRedirect();
      transferring = true;
      location.assign(new URL("../panel/", document.baseURI).href);
    } catch {
      form.elements.password.value = "";
      form.elements.confirm_password.value = "";
      message(
        "No se ha podido completar la operación. Revisa los datos. Si el enlace ha caducado, solicita uno nuevo.",
      );
    } finally {
      pending = false;
      get("complete-account").disabled = false;
    }
  });

  get("recovery-form").addEventListener("submit", async (event) => {
    event.preventDefault();
    if (pending) return;
    pending = true;
    const recoveryForm = event.currentTarget;
    get("request-recovery").disabled = true;
    try {
      await backend.requestPasswordRecovery(recoveryForm.elements.email.value.trim());
      recoveryForm.reset();
      message(
        "Si existe una cuenta autorizada con ese correo, recibirás un enlace para recuperar el acceso.",
      );
    } catch {
      message(
        "No se ha podido solicitar el enlace. Inténtalo más tarde o contacta con el administrador.",
      );
    } finally {
      pending = false;
      get("request-recovery").disabled = false;
    }
  });
  addEventListener("pagehide", () => {
    form.reset();
    if (!transferring) backend.signOut();
  });
  addEventListener("pageshow", (event) => {
    if (event.persisted) location.reload();
  });
})();
