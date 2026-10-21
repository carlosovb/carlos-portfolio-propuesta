// Confirmación común: solo anuncia éxito cuando el navegador ha copiado el texto.
(() => {
  let toast, timer;
  const timers = new WeakMap();
  function announce(message, failed = false) {
    if (!toast) {
      toast = document.createElement("div");
      toast.className = "copy-feedback";
      toast.setAttribute("role", "status");
      toast.setAttribute("aria-live", "polite");
      toast.setAttribute("aria-atomic", "true");
      document.body.append(toast);
    }
    clearTimeout(timer);
    toast.textContent = message;
    toast.dataset.failed = String(failed);
    toast.hidden = false;
    timer = setTimeout(() => (toast.hidden = true), 4000);
  }
  async function copy(text, button) {
    if (typeof text !== "string" || !text.trim()) return false;
    try {
      await navigator.clipboard.writeText(text);
      announce("✓ Enlace copiado. Ya puedes pegarlo.");
      if (button) {
        const old = timers.get(button);
        if (old) clearTimeout(old.timer);
        const label = old?.label || button.textContent;
        button.textContent = "Copiado ✓";
        button.dataset.copied = "true";
        const timer = setTimeout(() => {
          button.textContent = label;
          delete button.dataset.copied;
          timers.delete(button);
        }, 3000);
        timers.set(button, { label, timer });
      }
      return true;
    } catch {
      announce(
        "No se ha podido copiar. Selecciona el enlace y cópialo manualmente.",
        true,
      );
      return false;
    }
  }
  window.PortfolioClipboard = { copy };
})();
