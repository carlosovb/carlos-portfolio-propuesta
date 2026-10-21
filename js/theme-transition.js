// Fundido entre temas; alternativa de transición de colores para otros navegadores.
(() => {
  let currentTransition = null;
  let cleanupTimer;

  window.transitionPortfolioTheme = (render) => {
    if (matchMedia("(prefers-reduced-motion: reduce)").matches) {
      render();
      return;
    }

    if (typeof document.startViewTransition === "function") {
      currentTransition?.skipTransition();
      try {
        const transition = document.startViewTransition(render);
        currentTransition = transition;
        transition.finished
          .catch(() => {})
          .finally(() => {
            if (currentTransition === transition) currentTransition = null;
          });
        return;
      } catch {
        // Continuar con colores interpolados si el navegador no puede crear el fundido.
      }
    }

    clearTimeout(cleanupTimer);
    document.documentElement.classList.add("theme-colors-changing");
    render();
    cleanupTimer = setTimeout(() => {
      document.documentElement.classList.remove("theme-colors-changing");
    }, 450);
  };
})();
