// Registro de solicitudes en el panel privado. Sin correos ni almacenamiento local.
(() => {
  const form = document.getElementById("contact-form");
  const button = document.getElementById("contact-submit");
  const feedback = document.getElementById("contact-feedback");
  const title = document.getElementById("contact-status-title");
  const message = document.getElementById("contact-status-message");
  const originalButton = button.innerHTML;
  let sending = false;
  let requestId = null;
  const backend = window.PortfolioBackend;
  button.disabled = !backend?.ready;
  if (!backend?.ready) {
    title.textContent = "Formulario temporalmente no disponible";
    message.textContent = "Puedes contactar conmigo llamando al +34 638 487 427.";
    feedback.hidden = false;
  }

  function showStatus(heading, text, state) {
    title.textContent = heading;
    message.textContent = text;
    feedback.dataset.state = state;
    feedback.hidden = false;
    feedback.focus({ preventScroll: true });
    feedback.scrollIntoView({ behavior: "auto", block: "nearest" });
  }

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (sending || !backend?.ready || !form.reportValidity()) return;
    if (form.elements._honey.value) return;

    const reasons = [...form.querySelectorAll(".checks input:checked")].map((input) =>
      input.closest("label").querySelector("span").textContent.trim(),
    );
    const payload = {
      full_name: form.elements.name.value.trim(),
      phone: form.elements.telefono.value.trim(),
      email: form.elements.email.value.trim(),
      reasons,
      call_time: form.elements.time.value || "indiferente",
      comment: form.elements.comentario.value.trim(),
    };
    sending = true;
    button.disabled = true;
    button.textContent = "Enviando…";
    form.setAttribute("aria-busy", "true");
    feedback.hidden = true;

    try {
      requestId ||= crypto.randomUUID();
      await backend.submitContact(payload, requestId);
      form.reset();
      requestId = null;
      showStatus(
        "Ya has dado el primer paso.",
        "He recibido tu solicitud. Me pondré en contacto contigo para conocernos y acordar nuestra primera reunión. Si prefieres hablar ahora, puedes llamarme directamente.",
        "success",
      );
    } catch {
      showStatus(
        "No hemos podido confirmar el envío",
        "Tus respuestas siguen aquí. Antes de volver a enviarlas, puedes llamarme al +34 638 487 427 para comprobar si he recibido la solicitud.",
        "error",
      );
    } finally {
      sending = false;
      button.disabled = false;
      button.innerHTML = originalButton;
      form.removeAttribute("aria-busy");
    }
  });
})();
